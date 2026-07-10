# 决策日志：背景 → 决策 → 理由 → 后果

> 来源：开发会话记录 + 当前代码核验。只收录改变方向的重大决策，按主题组织——**这不是 changelog**：不写 commit hash（需要时用 `git log` 按主题检索），不要随新 commit 逐条追加。相关：[architecture.md](architecture.md) · [project-overview.md](project-overview.md)

## 1. 工程化整体镜像 oo-desktop

- **背景**：从零建 Electron 仓库，OOMOL 已有成熟的 oo-desktop。
- **决策**：新建独立仓库（不 fork），但 vite/electron/tsconfig/oxlint/oxfmt/打包/签名/CI/postinstall（download-electron）/IPC 服务划分（`@oomol/connection` + common.ts/node.ts）/前端栈（React 19 + shadcn + Tailwind 4）全部复刻 oo-desktop。
- **理由**：两 App UI 不割裂、维护成本共摊、CI secrets 名可直接照搬（`MACOS_CERTIFICATE` / `APPLEID` 等）。
- **后果**：架构高度可预测；但 oo-desktop 的坑会同步引入（如 `open-url` 冷启动 bug，见 §4），且有刻意不照抄的点：connector 鉴权头用 `Bearer`（不带 `x-oomol-user-uuid`）、i18n 自建轻量实现而非 `@embra/i18n`。

## 2. Agent 内核 = OpenCode 本地 sidecar

- **背景**：调研对比五种模式：云端 loop+薄客户端、本地 sidecar server（OpenCode）、Pi 进程内嵌、AI SDK 薄循环、stdio/ACP。云端 loop 评分最高但被用户否决（不想承担云端运维、要快出 POC）；Claude Agent SDK 被用户明确排除；Pi 落选主因是审批/权限层需全自建且 0.x 破坏性迭代。
- **决策**：spawn 已发布二进制 `opencode-ai@1.17.13` 作 sidecar，主进程经 `@opencode-ai/sdk@1.17.13` HTTP+SSE 驱动；纯配置定制（自定义 agent prompt 整段替换 + `.opencode/tools/` 自定义工具），零源码改动。**不用 SDK 的 `createOpencodeServer`** 而是自己 spawn：后者不允许控制二进制路径/env/cwd，且生产打包时 opencode-ai 不在 node_modules（二进制走 extraResources）。
- **理由**：OpenCode 内置权限模型 + 会话基建 + 公司化维护；import 库不可行（调研时 server 相关包全 private，`opencode-ai` 是纯 bin 包）；vendor monorepo 维护负担大（2026-05 调研时上游约 41 commits/天、无 API 兼容承诺）。
- **后果**：三包版本钉死 `1.17.13` 禁止浮动；sidecar 须隔离目录（`XDG_*` 指向 userData，否则读全局 `~/.config/opencode` 泄漏本机配置）；默认系统提示按模型 ID 选（编码人格），必须用 agent `prompt` 字段整段替换。

## 3. 连接器调用全经内置 oo 二进制

- **背景**：oo-cli 跑在 Bun 上、约 30 个源文件深耦合 Bun 专有 API，无法 import 进 Node/Electron。
- **决策**：electron-builder `extraResources` 内置平台二进制；只经 `OO_*` 环境变量控制（R3）；授权信号走结构化工具结果（R5）：`call_action` 解析 stderr 的 `errorCode: <code>` token，命中授权阻断码时返回 `{status:"authorization_required", authUrl}`，**不解析模型自由文本**。
- **理由（连接器暴露策略，调研结论）**：把约 600 个 provider 全量注册成工具是死路——工具数超过 30–50 个时模型选择准确率显著下降；故选"只注入已授权存在性提示（R4，默认不列具体 provider 名）+ list/search/inspect/call 元工具渐进披露"的混合方案，**不要重新提议按 provider 生成工具或全量注册**。
- **后果**：oo-cli 1.2.0 须先实现全套 `OO_*` 变量（曾是未声明硬前置，后上游发版补齐——此行为系 oo-cli 1.2.0 实测 + 上游发版记录，oo 是黑盒二进制、本仓库无法复核，升级 oo 时需重新验证）；`OO_SKILLS_SYNC_DISABLED=1` 必须设置否则 oo 每次运行写用户家目录（`~/.claude`、`~/.agents` 等，1.2.0 实测）。

## 4. 登录流修正：OO_API_KEY env → 浏览器登录

- **背景（错在哪）**：原实现启动时直接读 `process.env["OO_API_KEY"]`，无该变量时 App 打开后什么都用不了，且无登录入口——对最终用户不可用。
- **决策**：改为浏览器登录流（console launcher → deep-link 回跳 → authID 换 `oomol-token` 会话 token → profile 落盘 `auth.json` → `applyAuthAccount` 动态装配 agent）。完整 5 步与凭证细节见 [architecture.md §6](architecture.md)（现行流程的唯一权威描述）。
- **后续修订（凭证统一为会话 token）**：原方案曾用会话 token 再换取**长期 default-api-key** 落盘并喂给 agent/连接器，仅账单用会话 token——导致会话过期时"聊天能用、用量看不了"的割裂，且长期 key 落盘不安全。现已改为**全程只用会话 token**（网关层统一接受 cookie/token/api-key），不再获取或落盘 api-key；token 失效即全局未登录、需重新登录（一致生命周期）。`auth.json` 只存 profile。
- **理由**：流程与 oo-desktop 完全一致（仅协议名不同），复用已验证的模式。
- **后果（多 agent 对抗审查确认 13 个问题并修复，要点）**：
  - macOS 冷启动丢登录回调：`open-url` 在 ready 前派发且无缓冲 → 监听提前到模块顶层注册（oo-desktop 上游同 bug 未修）。
  - 登录 CSRF：任意本地程序可推伪造 authID 的 deep link 静默换号 → 非本应用发起（无 pending）的回调须系统对话框确认。
  - RPC 凭证泄露：`@oomol/connection` 注册即全公开 → 凭证逻辑移入**未注册**的 `AuthManager`，只注册薄门面。
  - 装配竞态 → 统一走 `applyChain` 串行 + 同凭证幂等短路。
  - 已知限制（当时明确"不修、仅记录"的已接受取舍）：
    - 聊天记录存固定 `userData/agent`，多账号共用一份会话历史（换号时 AppShell 整树重挂载只重置 UI 状态，**不隔离会话存储**）。
    - agent 启动失败时 UI 停在「Agent 启动中…」无重试按钮（可重新登录恢复；失败已不留僵尸状态）。

## 5. 移除动态 endpoint 切换

- **背景**：阶段 5 实现了运行时切换 oomol.com/oomol.dev，但业务上不存在切换需求，且引入大量竞态处理代码；另有硬约束：**对外分发产物 grep 不到 `oomol.dev`**（防泄漏内部开发域名）。
- **决策**：endpoint 改为 vite `define` 编译期常量 `__OO_ENDPOINT__`，`electron/domain.ts` 折叠为单常量 + 模板字符串派生全部 base URL；App 层不可见不可切换。`resolveOoEndpoint` 优先级：显式 `WANTA_ENDPOINT` 环境变量（**任何模式都生效，含 build**）> 仅 dev/serve 读 `.env(.local)`（**build 刻意不读文件**——被忽略的只是 `.env` 文件，不是环境变量）> 缺省 `oomol.com`。测试同步从 `node --test` 迁到 vitest（原生套用 vite define，免运行时注入 hack）。
- **理由 / 教训**：第二轮改 loadEnv 时曾引入回归——本机 `.env.local=oomol.dev` 跑 build 会把 dev 域名打进产物（对抗审查抓到），最终修复是"build 不读文件"这一更根本的不变式，而非 CI grep 守卫。
- **后果**：删除约 15 个文件中的切换抽象（`setEndpoint` / `reconfigure` / `supportedEndpoints` 等）；`auth/store.ts` 加 `migrateLegacyAccounts()` 丢弃与当前构建 endpoint 不符的历史账号；`oomol.dev` 字面量在**代码与配置**中仅允许出现在不进包的三处（vite.config.ts 注释、.env.example、store.test.ts）；文档（docs/ 与根指南）不在此限，若加 grep 守卫应排除文档。

## 6. oo CLI 调用失败修复：node_modules 二进制 → `.oo-bin/` 自管理

- **背景（根因）**：agent 调连接器工具报 `spawn .../oo EACCES`。上游 `@oomol-lab/oo-cli-*` 平台包 tarball 内 `bin/oo` 本身就是 0644（发布时没带 +x）；dev 下 `which oo` 命中 `node_modules/.bin` 的 wrapper，wrapper spawn 无执行位的二进制 → EACCES。生产一直正常是因为 `prepare-binaries.ts` 复制时 chmod 0755——纯 dev 问题。
- **决策**：移除 `@oomol-lab/oo-cli` npm 依赖；`scripts/oo-cli.ts` 为单一来源（`OO_CLI_VERSION = "1.2.3"`、平台/libc 映射、自写 ustar 提取器替代系统 tar、npm packument `dist.integrity` sha512 校验、原子落位 + `chmod 0o755`），postinstall（`scripts/download-oo.ts`，best-effort）下载到 gitignore 的 `.oo-bin/`，dev 与打包共用。dev 解析顺序：`WANTA_OO_BIN` 覆盖 > `.oo-bin/oo`，删除 `which oo`。opencode 来源同步改为 `node_modules/opencode-ai/bin/opencode.exe`（修复既存的 Windows 包名错误：上游叫 `opencode-windows-x64` 而非 `win32`）。
- **理由（被否方案）**：主进程加 `existsSync` 预检被用户否决——**主进程禁用同步 fs（阻塞渲染）**，改为 `predev` 守卫 `scripts/check-oo.ts`（独立 CLI 脚本用 sync fs 无妨）。这条已成项目铁律。
- **后果**：升级 oo 只改 `OO_CLI_VERSION` 一处；缺 `.oo-bin/oo` 时 App 照常启动（错误只在首次工具调用时以 JSON 返回给模型），这正是 predev 守卫存在的原因。

## 7. Markdown 渲染 + 系统提示词 + 工具调用 UI

- **背景**：三个并行问题——assistant 消息纯文本不渲染 Markdown；工具调用 UI 太显眼；模型瞎猜 connector 参数（实例：hackernews `get_item` 传 `item_id`，schema 要求 `id` 且 `additionalProperties:false` 被拒）。
- **决策**：
  - 参数问题根因是工具集缺 schema 查询能力（`search_actions` 不返回 inputSchema），纯改提示词治标不治本 → 新增第三个工具 `inspect_action`（`oo connector schema "<service>.<action>" [...] --json`，oo 1.3.0 起用点号 id 寻址、可一次批量取多个契约；2+ 个 id 返回请求顺序的 JSON 数组），提示词强制 **search → inspect → call** 流程，inputSchema 是参数唯一事实来源。oo-cli 1.4.2 提供 `oo connector apps --json --org/--personal` 后，新增 `list_apps` 专门回答当前 workspace 已连接 provider/app 清单，避免把 catalog search 当作连接状态查询。
  - 提示词分层（R4）：稳定人格/工具/契约放 agent.prompt 利于 prompt 缓存；每轮变化的已授权存在性提示走 `body.system` 动态注入，默认不列具体 provider 名。
  - Markdown 用 react-markdown@10 + remark-gfm（不引 rehype-raw，保 HTML 转义防 XSS）；同时主进程新增外链处理（`setWindowOpenHandler` + `will-navigate` 共用 `openExternalUrl`，白名单 http/https/mailto/tel——mailto/tel 是对抗审查发现"可点击但无反应"后补的）。
  - 工具调用 UI 默认折叠一行摘要，点击展开参数/结果。
- **后果**：后端部分（inspect_action、提示词契约、外链处理）沿用至今；前端 Markdown/折叠 UI 后来在 ai-elements 迁移中被替换（react-markdown 已移除）。

## 8. UI 框架迁移至 ai-elements

- **背景**：用户目标"前端组件全部换成 ai-elements"（Vercel 经 shadcn registry 分发的 AI 聊天组件库）。
- **决策**：**vendoring 而非 CLI 整装**——registry canonical 源码手工落地 `src/components/ai-elements/` 并裁剪（CLI 假定 Next.js；原版 prompt-input 37KB 深耦合无用 Radix 原语）。Markdown 渲染换 streamdown（MessageResponse 内置）。**迁移边界（用户拍板）**：只迁聊天界面等有真实对应物的部分；侧边栏/登录/连接器列表/表单保留 shadcn 原语（ai-elements 没有这些组件，勿强行全化）。
- **理由**：控制依赖面（新增 Radix 收敛到 collapsible/input-group/slot）；保持源码 canonical 以便对照升级（`.claude/skills/ai-elements/references/` 是权威 API 参考，`skills-lock.json` 记录来源 hash）。
- **后果（13-agent 审查确认 9 个运行时问题，已修）**：streaming 时 Enter 只发送不停止（曾是 HIGH 回归）；工具调用 UI 迁移为 `Task` 折叠摘要后，未接入的独立 Tool/CodeBlock 组件已移除；`src/index.css` 须 `@source "../node_modules/streamdown/dist"`（Tailwind v4 不扫 node_modules）；vendored 目录享受 oxlint override（`react/only-export-components` off）。

## 9. 放开 tools 权限并接入两档访问模式

- **背景**：早期 agent 定位"非编码连接器助手"，内置工具全封禁。后果：答不了"我电脑上有哪些文件"，也无法写脚本组合多个 action 的 JSON 结果。
- **决策（现在的权限模型）**：解除"三层封锁"（缺一不可）——① 删除 `DENIED_BUILTIN_TOOLS` 表（所有内置工具默认启用）；② Build agent、Plan agent 与根级 `WANTA_PERMISSION` 对本地 shell 和 `external_directory` 统一设为 `ask`，`edit` 在 Build 为 `ask`、Plan 仅允许 `.opencode/plans/*.md`；③ `event-translator.ts` 翻译 `permission.asked` / `permission.v2.asked` 与 replied 事件，ChatService 暴露 pending permission 查询和 reply；④ ChatService 主进程持有本地访问策略：默认访问把 bash 作为正常工作通道，自动批准普通 shell 命令、脚本、项目检查、数据处理、简单输出过滤、普通文件读写与具体非敏感路径；只把基础安全边界推给渲染层确认，如凭证/密钥路径、宽泛或递归的 home/system 扫描、破坏性删除、依赖安装、提权、`git push/reset/clean`、发布/部署、基础设施变更等。敏感资源检查优先于通用目录 session grant，通用 grant 也不能放行高风险请求；完全访问仍可经一次确认后接管本会话权限。渲染层只展示 pending UI、同步访问模式、回传用户选择；⑤ 系统提示词整段重写为双能力（connector 元工具 + 本地工具）并按访问模式动态追加——只放开工具不改提示词，模型仍会自我拒绝。
- **理由（关键约束）**：OpenCode permission 取值 `ask | allow | deny`。Wanta 产品层不暴露细粒度权限，避免用户理解每个内置工具规则；但底层仍用 OpenCode ask 闸住高风险本地动作。**不改 sidecar cwd**（连接器工具依赖 `userData/agent/workspace/.opencode/tools/`），访问真实文件仍用绝对路径/`~` 并由 `external_directory: "ask"` 触发权限边界。
- **后果**：当前安全姿态从"任意 shell / 文件读写 / 网络访问全无确认"收敛为"默认访问下 bash 和普通文件能力顺滑可用，只在真实风险边界暂停确认"。用户不需要为 `oo ... | head`、`npm test`、`rg`、数据处理脚本、普通桌面/下载目录文件等常规工作逐次批准；具体非敏感文件读取保持顺滑，只有整个 home/system 根等宽泛扫描才提示。`npm install`、读取凭证/密钥、浏览器登录态、邮件/消息/通讯录/日历数据、删除、提权、推送、部署等仍需确认；这类敏感读取优先于通用目录 session grant，不能因用户曾允许一个父文件夹而被静默放行。为避免编码任务因依赖处理连续审批，用户可对当前选定项目中、显式定位到项目目录的标准 npm/pnpm/yarn/bun 依赖操作授予一次任务级 grant；它仅在当前 generation 内有效，且不覆盖全局安装、自定义 registry、user config 或项目外命令。Python 仍在当轮 process 目录的私有 `.wanta-python` venv 中获得更窄的纯 PyPI 包名授权；`--user`、`--break-system-packages`、额外索引、URL/本地路径/requirements 文件和任意系统 Python 安装仍逐次确认。若将来继续细化敏感路径（如浏览器 profile、邮件数据库、更多凭证目录）或外部副作用分类，需要同步 `config.ts`、ChatService 本地访问策略、访问模式 UI、事件测试和 [conventions.md §7](conventions.md)。若将来重新收紧权限：OpenCode permission **只闸内置工具**，`bash: deny` 不会切断 `.opencode` 自定义工具（连接器元工具照常 spawn oo，见 [conventions.md §7](conventions.md)。

## 10. 反问 = 运行时 pending request，不做前端恢复状态机

- **背景**：OpenCode `question.asked` 接入后，渲染层曾为停止后继续、刷新恢复、取消后 dismiss、防重复恢复等异常流程维护 stopped/recoverable/dismissed/localStorage 状态，并从后端 pending、消息历史、本地缓存三处 reconciliation。结果是状态事实源过多：一个历史 question tool 可能被前端恢复成可交互问题，而 sidecar 实际未必还在等待同一个 request。
- **决策**：反问只认主进程/sidecar 当前 pending question。`getPendingQuestions()` 与 `question.asked` 事件是唯一交互事实源；历史 question tool 只展示历史。用户提交走 `answerQuestion`；用户取消走 `rejectQuestion`，只拒绝当前 request，不隐式停止 generation；用户显式停止 generation 时才清空当前 pending question UI。草稿只保留当前内存态，不跨重启恢复。`rejectQuestion` 有短超时保护以免 UI 卡死，但超时也不自动 abort run。
- **理由**：反问本质是 agent runtime interrupt，不是普通聊天消息，也不是权限提示。没有后端 checkpoint/run-state 支撑时，前端用历史消息和 localStorage 伪造"继续上一轮"会制造不可解释的中间态。若将来要支持刷新后继续回答，必须先有主进程/sidecar 可恢复同一 `requestId` 的 durable pending request；否则只能显示 expired/resolved 历史。
- **后果**：删除反问恢复状态机与 resume message 拼接逻辑，状态边界收敛为"后端还在等就展示，否则只当历史"。系统提示词同步约束模型：只有缺失信息会实质影响结果、阻塞必要动作或带来风险时才窄问；用户拒绝/取消后不要原样重问，而应做安全假设、跳过可选动作、选择低风险路径或说明 blocker。

## 11. Beta/Stable 双发行渠道

- **背景**：需要每日构建走 beta 渠道、正式发布走 stable，用户可在设置里双向切换（默认 stable）。oo-desktop 是单渠道（仅 latest\*.yml），无先例可抄——这是相对 §1 镜像策略的 deliberate divergence（比照 Bearer 头 / i18n 先例）。
- **决策**：用 electron-updater generic provider 的原生渠道机制——beta 版本号 `X.Y.Z-beta.N`（基线 = max(最新 stable 的 patch+1, 既存 beta 最高基线)，由 `scripts/release-version.ts` 计算并带防回退校验），electron-builder 自动产出 `beta*.yml` 与 `latest*.yml` 同目录并存；客户端渠道 = `用户设置 ?? 自身版本推导`，经 `setFeedURL` 的 `channel` 字段选择指针文件。开 `generateUpdatesFilesForAllChannels`：stable 构建同步刷新 `beta*.yml`，beta 用户在正式版发布后立即收敛（唯一例外：stable 低于既存 beta 基线时 CI 跳过 beta 指针，防倒退）。
- **理由（三个关键约束）**：① patch+1 是唯一安全基线——它是下一个正式版的最小可能值，保证任何未来 stable 都大于在售 beta，收敛不依赖预测下个版本号；② **不用 `autoUpdater.channel` setter**——它会静默把 `allowDowngrade` 置 true（electron-updater AppUpdater 源码），与"beta 切回 stable 默认等下一个正式版、绝不自动降级"冲突，故渠道走 `setFeedURL` 配置并显式 `allowDowngrade=false`；③ 立即降级被否——electron-updater 对降级后的数据兼容（opencode sidecar 会话/存储 schema 由新版写入）无任何保护，等待收敛是官方对齐（roll-forward）的安全路径。
- **后果**：发布纪律变重——rclone include 白名单按渠道收紧（beta 绝不触碰 `latest*.yml`）、CDN 刷新清单按渠道计算、mac/win 各有渠道 yml 硬校验；generic provider 缺渠道 yml 是硬错（无回退），`beta*.yml` 在两个平台目录必须常在；stable 自动 bump 必须过滤 beta tag（bash 算术遇 `-beta` 即爆，已固化为 release-version.ts 回归用例）；`electron-builder`/`electron-updater` 因渠道行为版本敏感而精确钉死。
