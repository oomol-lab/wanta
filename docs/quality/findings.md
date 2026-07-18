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

## Q-2026-004：初始登录快照会覆盖更新事件

- Category: bug | state
- Status: verified
- Area: auth
- User impact: renderer 启动时若登录状态在 `getAuthState` 与 `authStateChanged` 之间变化，旧快照可能短暂或持续覆盖新状态。
- Evidence: 可控 deferred 测试证明事件先返回、初始读取后返回时旧状态会获胜；同步事件重放测试在修复前稳定得到 `2 → 1`。
- Root cause: 初始 `getAuthState` 与 `authStateChanged` 分别直接写 React state，没有共享 generation；初始失败也会在成功事件后留下错误。
- Scope: `src/hooks/useAuth.ts`、`src/hooks/auth-state-observer.ts` 及其单元测试。
- Guardrails: 不改变 token 门控、登录回调或 AuthManager 边界。
- Before metric: 事件值 `2` 会被迟到初始值 `1` 覆盖。
- Target: 任意完成顺序都以最新服务端事件为准。
- Verification: 4 个事件顺序、错误和 dispose 单测，完整质量门、生产构建和开发版启动。
- Risk and rollback: 中；认证路径需要真实运行补验。
- Priority: P1
- Decision: fix

## Q-2026-005：知识库列表读取缺少请求版本隔离

- Category: bug | state
- Status: verified
- Area: knowledge
- User impact: 快速启停 beta 开关、刷新或收到连续变更事件时，旧列表响应可能覆盖新列表，卸载后也会继续执行状态更新路径。
- Evidence: 两个 deferred 列表请求按新请求先完成、旧请求后完成的顺序结算；旧实现没有任何条件阻止最后到达的旧列表写入。
- Root cause: `load()` 的每次调用都直接写 items/error/loading，effect cleanup 只取消事件订阅，没有使已开始请求失效。
- Scope: `src/hooks/useKnowledgeBases.ts`、`src/hooks/knowledge-base-list-observer.ts` 及其单元测试。
- Guardrails: 关闭 beta 时不得请求或注入知识库；错误时保留现有恢复语义。
- Before metric: 旧列表、旧错误和卸载后的结果都具备 state 写入路径。
- Target: 只有当前 enabled generation 的最后一次读取可以更新状态。
- Verification: 3 个乱序、错误和 dispose 单测，完整质量门、生产构建和开发版启动。
- Risk and rollback: 中低。
- Priority: P2
- Decision: fix

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

## Q-2026-011：冷启动技能清单扫描耗时超过两秒

- Category: performance
- Status: hypothesis
- Area: skills | shell
- User impact: 已登录启动时技能清单或依赖该清单的界面可能延迟就绪，主进程同时承担较长的文件扫描工作。
- Evidence: 第二轮开发版启动 diagnostics 记录首次 skill inventory scan 为 2154ms，扫描 3 个 agent root、63 个已安装 skill、101 个最终条目；紧随其后的同类扫描为 54ms。
- Root cause: 尚未确认是冷文件系统、重复全量扫描、hash 计算、CLI 探测还是 manifest 重建占主导。
- Scope: `electron/skills/node.ts`、`scan.ts`、`file-watcher.ts` 和 AppData 首次读取时序。
- Guardrails: 不得漏掉外部 agent skill、同名优先级、removed/default 状态或 watcher 后续更新。
- Before metric: 当前环境冷启动首次扫描 2154ms，后续扫描 54ms。
- Target: 先分段测量并确认是否阻塞主窗口或 Agent ready，再制定预算。
- Verification: diagnostics 分段计时、至少 5 次冷/热启动分布和技能清单一致性测试。
- Risk and rollback: 中；没有分段证据前不改变扫描语义或并发模型。
- Priority: P2
- Decision: defer
