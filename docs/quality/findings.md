# 质量问题台账

> 状态含义：`hypothesis` 仅表示值得测量；`confirmed` 表示已有可复现证据；`verified` 表示修复已通过完整门禁。
> 调查方法和优先级规则见 [全项目质量优化计划](../quality-improvement-plan.md)。

## Q-2026-001：服务端推送的新数据会被旧读取覆盖

- Category: bug | state
- Status: verified
- Area: shell | skills | auth
- User impact: 后台读取尚未完成时，如果登录状态事件或技能 mutation 写入更新数据，旧读取随后完成会把界面退回旧状态。
- Evidence: `ResourceStore.setData()` 不推进 `requestId`，新增回归测试在旧实现上稳定得到 `stale` 而不是 `pushed`。
- Root cause: 共享资源层只让强制刷新和 reset 使旧请求失效，遗漏了权威推送和 mutation 结果。
- Scope: `src/lib/resource-store.ts` 及其单元测试。
- Guardrails: 保留普通读取的在途合并；旧 Promise 仍可向原调用者结算，但不得再写共享快照。
- Before metric: 1 个确定性竞态用例失败。
- Target: `setData()` 后完成的旧请求不能修改资源快照。
- Verification: 3 个回归测试、完整质量门、生产构建和开发版启动均通过。
- Risk and rollback: 低；变更只影响资源快照写入资格，可单独回退。
- Priority: P1
- Decision: fix

## Q-2026-002：资源失效仍会复用已过时的在途请求

- Category: bug | state
- Status: verified
- Area: shell | skills
- User impact: 技能安装、发布或认证变化后调用 `invalidate()` 时，变更前的读取仍可回填缓存；下一次 refresh 还会复用同一个旧 Promise。
- Evidence: 新增两个确定性测试；旧实现不会发起第二次读取，且无数据资源会永久保持 `loading` 直到旧请求完成。
- Root cause: `invalidate()` 只把已有数据的 `updatedAt` 设为 null，没有提升 generation、释放 `inFlight` 或处理首次加载。
- Scope: `src/lib/resource-store.ts` 及其单元测试。
- Guardrails: 不取消底层 Promise；只阻止失效前请求回写，并允许新的读取立即开始。
- Before metric: 2 个确定性竞态用例失败。
- Target: 失效后新 refresh 发起新请求；旧请求完成不污染快照；无数据资源回到 `idle`。
- Verification: 2 个回归测试、完整质量门、生产构建和开发版启动均通过。
- Risk and rollback: 中低；依赖旧 Promise 的直接调用者仍能收到结果，共享快照行为变得更严格。
- Priority: P1
- Decision: fix

## Q-2026-003：账单强制刷新会复用变更前的请求

- Category: bug | performance
- Status: verified
- Area: billing
- User impact: 充值、订阅变更、支付弹窗关闭或重新登录后强制刷新时，如果旧账单请求仍在途，界面可能继续显示变更前余额或计划。
- Evidence: `refresh({ force: true })` 绕过 TTL，却仍执行 `entry.promise ?? ...`；调用点明确在支付、登录和 mutation 后使用 force。
- Root cause: 缓存新鲜度和在途请求 generation 被混为同一个复用条件。
- Scope: `src/hooks/useBillingOverview.ts` 及其单元测试。
- Guardrails: 普通并发刷新继续合并；只有 force 创建新 generation；旧请求结算后不能覆盖新结果。
- Before metric: force 与普通刷新都返回同一个 Promise。
- Target: 普通刷新保持一次请求；force 返回新 Promise，并且旧响应不能回填 cache entry。
- Verification: 两个并发顺序单测、完整质量门、生产构建和开发版启动均通过。
- Risk and rollback: 低；只在显式 force 时可能多发一个账单聚合请求。
- Priority: P1
- Decision: fix

## Q-2026-004：初始登录快照可能覆盖更新事件

- Category: bug | state
- Status: hypothesis
- Area: auth
- User impact: renderer 启动时若登录状态在 `getAuthState` 与 `authStateChanged` 之间变化，旧快照可能短暂或持续覆盖新状态。
- Evidence: `useAuth` 的初始 invoke 没有事件版本保护，而同仓库 `useAttention` 已使用该保护模式。
- Root cause: 尚未确认。
- Scope: `src/hooks/useAuth.ts`。
- Guardrails: 不改变 token 门控、登录回调或 AuthManager 边界。
- Before metric: 待建立可控 RPC/event 顺序测试。
- Target: 任意完成顺序都以最新服务端事件为准。
- Verification: 先建立 hook/service harness，再决定是否修复。
- Risk and rollback: 中；认证路径需要真实运行补验。
- Priority: P1
- Decision: defer

## Q-2026-005：知识库列表读取缺少请求版本隔离

- Category: bug | state
- Status: hypothesis
- Area: knowledge
- User impact: 快速启停 beta 开关、刷新或收到连续变更事件时，旧列表响应可能覆盖新列表，卸载后也会继续执行状态更新路径。
- Evidence: `useKnowledgeBases.load()` 没有 generation 或 AbortSignal；effect 只取消订阅，不使已开始的读取失效。
- Root cause: 尚未确认。
- Scope: `src/hooks/useKnowledgeBases.ts`。
- Guardrails: 关闭 beta 时不得请求或注入知识库；错误时保留现有恢复语义。
- Before metric: 待建立乱序响应测试。
- Target: 只有当前 enabled generation 的最后一次读取可以更新状态。
- Verification: 可控 deferred response 测试和 beta 开关实机验证。
- Risk and rollback: 中低。
- Priority: P2
- Decision: defer

## Q-2026-006：账单缓存缺少认证切换清理

- Category: performance | maintainability
- Status: hypothesis
- Area: billing | auth
- User impact: 账单数据按账号和 workspace 正确隔离，但退出和换号后旧余额仍保留在 renderer 模块内存，长生命周期多账号使用会持续增长。
- Evidence: `overviewCache` 是无界模块级 Map；认证变化会清理 connector、skill、avatar 和 organization cache，没有账单清理入口。
- Root cause: 尚未确认是否达到可观察内存规模。
- Scope: `src/hooks/useBillingOverview.ts` 与认证缓存清理边界。
- Guardrails: 不得因清理触发重复支付或把个人余额解释为组织余额。
- Before metric: 待采集账号/组织切换后的 cache entry 数和 heap snapshot。
- Target: 登出或账号变化后不保留旧账号账单数据。
- Verification: 纯缓存测试和换号实机验证。
- Risk and rollback: 低。
- Priority: P2
- Decision: defer

## Q-2026-007：长会话流式更新的 renderer 成本未量化

- Category: performance
- Status: hypothesis
- Area: chat
- User impact: 可能表现为输入、滚动或流式输出卡顿。
- Evidence: 主进程已有 32ms 合并，renderer 也有事件 buffer；当前静态结构无法证明仍有无关组件提交。
- Root cause: 未确认，禁止据此盲目 memo。
- Scope: Chat SSE 到 `ChatTimeline` 的完整路径。
- Guardrails: 保留累计全文 part、稳定 partId、Enter 只发送和制成品层级。
- Before metric: 待采集固定长会话的 commit 次数、long task 和 heap 曲线。
- Target: 先建立预算，再选择优化。
- Verification: React Profiler、Chromium trace 和相同 fixture 的 before/after。
- Risk and rollback: 高，未测量前不实施。
- Priority: P2
- Decision: defer

## Q-2026-008：缩略图缓存只有条目上限，没有字节预算

- Category: performance
- Status: hypothesis
- Area: chat
- User impact: 128 个 data URL 缩略图可能在图片密集会话中占用较多 renderer heap。
- Evidence: `artifact-thumbnail-cache.ts` 限制 128 项，但未估算 data URL 字节；主预览缓存已有 64 MiB 双重预算。
- Root cause: 尚未证明实际缩略图大小达到问题阈值。
- Scope: artifact thumbnail cache。
- Guardrails: 不降低图片预览清晰度或移除图片 gallery。
- Before metric: 待记录 128 项实际总字符数与 heap 增量。
- Target: 若证实，增加可测试的字节预算且保持命中率。
- Verification: 缓存驱逐单测和图片密集会话 profile。
- Risk and rollback: 低。
- Priority: P3
- Decision: defer

## Q-2026-009：后台资源比较可能重复深序列化大型清单

- Category: performance | duplication
- Status: hypothesis
- Area: shell | skills
- User impact: 每分钟后台刷新时可能在 renderer 主线程产生不必要的 JSON 序列化和排序成本。
- Evidence: `isRefreshDataEqual` 对当前值和新值各执行递归 normalize + `JSON.stringify`，技能 inventory 可能较大。
- Root cause: 没有 profile，可能远低于可感知阈值。
- Scope: `src/components/AppDataProvider.tsx`。
- Guardrails: 不得因浅比较制造无效整树更新。
- Before metric: 待记录 inventory 规模、比较耗时和提交次数。
- Target: 只有 profile 超预算时才引入版本/hash 或域级比较。
- Verification: performance mark 和 React Profiler。
- Risk and rollback: 中，未测量前不实施。
- Priority: P3
- Decision: defer

## Q-2026-010：大型懒加载 chunk 的真实首开成本未知

- Category: performance
- Status: hypothesis
- Area: build | chat
- User impact: 首次打开 PDF、表格或部分语言资源时可能有解析和内存峰值。
- Evidence: production build 对 PDF、语言资源和 Univer chunk 给出大于 500 kB 的警告；这些资源已经按功能懒加载。
- Root cause: chunk 大不等于用户可感知问题，尚未测量加载和解析时机。
- Scope: Vite chunk 图与 artifact preview 动态 import。
- Guardrails: Univer 完整工作簿渲染和交互不可删除、降级或替换。
- Before metric: 待采集首次打开各预览的网络、parse/evaluate 和可交互时间。
- Target: 只有真实首开超预算时调整加载边界。
- Verification: production build trace，而不是仅比较 chunk 文件大小。
- Risk and rollback: 高，未测量前不实施。
- Priority: P3
- Decision: defer
