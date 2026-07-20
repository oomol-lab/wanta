# 架构：进程划分、Agent 内核、IPC、数据流

> 相关：[project-overview.md](project-overview.md)（是什么）· [key-decisions.md](key-decisions.md)（为什么）· [conventions.md](conventions.md)（怎么写代码）

## 1. 三进程划分

- **主进程** `electron/main.ts`：组装根。创建 `ConnectionServer(new ElectronServerAdapter())`，构造 `SettingsStore` / `AuthStore` / `KnowledgeStore` / `AttentionStore`（`app.getPath("userData")` 下的 `settings.json` / `auth.json` / `knowledge-bases/` / `attention.json`），实例化并注册 **10 个 service**（`chat` / `attention` / `session` / `skill` / `models` / `settings` / `auth` / `update` / `git` / `knowledge`）`server.registerService(...)`（**必须在 `server.start()` 之前**）。`attention` 只在正常完成且 turn output 收尾后记录未读任务，异步持久化并驱动系统通知与应用图标 badge（macOS/支持的 Linux launcher 显示数字，Windows 任务栏显示红点 overlay）；用户停止和错误路径不会伪装成完成。测试通知等待 Electron 原生 `show` / `failed` 事件（另有超时），并把 `show` 只解释为系统接受请求；macOS 随后短轮询 `Notification.getHistory()`，只有找到本次唯一 ID 才报告已送达通知中心，避免把底层调度成功冒充成用户已看到横幅。测试路径给 macOS 首次授权选择保留更长等待时间，后台任务仍快速收敛；提交、历史确认和任务通知条件决策均写入 diagnostics log。设置页把系统能力表述为“可测试”而非“已授权”：macOS 首次操作使用“开启并测试”触发系统授权，Windows 直接测试，失败或结果不明后才把系统设置提升为恢复入口。macOS 的设置入口从 `branding.appId` / `branding.devBundleId` 构造带应用 ID 的通知设置深链，明确打开失败时再回退通知总页面；macOS Electron 42 开发包未使用有效应用签名，明确标记为不可测试，真实验证必须使用签名后的 packaged app。Windows 没有公开的单应用通知设置 URI，使用官方通知总页面；主进程从 `branding.appId` 设置 AppUserModelID，与安装包身份一致。`whenReady` 里 `installOomolCorsShim(session.defaultSession)`，放行渲染层对 `*.<endpoint>` 的直连已鉴权请求（见 §4）。登录成功后经 `applyAuthAccount(account)` 动态拉起 `AgentManager`（rootDir = `userData/agent`）并注入 chat/session service；登出时置 null。deep-link（dev `wanta-local://` / 生产 `wanta://`）交给 `authManager.completeBrowserLoginCallback`。单实例锁仅打包态启用。外链统一走 `openExternalUrl` helper（协议白名单 http/https/mailto/tel → `shell.openExternal`），`setWindowOpenHandler` 与 `will-navigate` 两条路径共用。渲染层媒体权限同时经过 check/request handler，仅放行 Wanta 主窗口、可信 renderer URL、主 frame 的纯音频请求；摄像头及其他来源默认拒绝。**注意**：connector / teams 不再有主进程 service——这两域的请求已整体搬到渲染层直发（见 §4、§7）；agent 的团队作用域改经 `chatService.setAgentTeam` IPC 回调（`onSetAgentTeam` → `handleAgentTeamChanged`，更新 `activeAgentTeamName` + `agent.setTeamName`）。
- **preload** `electron/preload.ts`：极薄。`setupConnectionPreload()`（@oomol/connection RPC 桥）+ contextBridge 暴露 `window.electron` 与 `window.wanta = { appCommit, platform, version }`（来自 vite define `__APP_COMMIT__` / `__APP_VERSION__`）。**不暴露任何网络/凭证面**——渲染层直连请求靠会话 cookie 自动鉴权，不经 preload（见 §4）。
- **渲染进程** `src/main.tsx`：`ConnectionClient(new ElectronClientAdapter())` → `client.use()` 10 个 service 契约 → `AppContext.Provider`。渲染层通过 attention service 同步当前可见 session、消费持久化未读集合，并在点击系统通知时切回对应任务。渲染层**直接 import** `electron/*/common.ts` 的契约类型（跨目录共享类型，不复制）；自渲染请求层落地后，还**直接 import `electron/` 下的运行时纯模块**：`electron/domain.ts`（域名常量，经 `src/lib/domain.ts` 再导出）、`electron/connections/{summary,usage,executions,federated,domain,summary-model}.ts`、`electron/skills/actions.ts` 等——这些模块 electron-free，被打进渲染 bundle（billing 的纯 reshape 逻辑则已整体落在 `src/lib/billing-client.ts`，不再从 electron import；见 §4）。

知识库当前由 `SettingsStore` 中的 `knowledgeBaseBetaEnabled` 控制，缺失或非 `true` 一律视为关闭。渲染层通过 Settings service 读取和订阅开关；关闭时不显示知识库导航、不加载知识库清单、不向聊天注入既有知识库引用，并把直接进入知识库路由的请求退回聊天页。开关保存在本机 `userData/settings.json`，重启后保持。`KnowledgeStore` 只把 `ENOENT` 视为空库，损坏或不支持的 registry schema 会 fail-closed，禁止后续 mutation 从空状态覆盖；封面导入时收敛为最长边 320 px、编码后最多 512 KiB 的缩略图，旧版超限 Data URL 不跨 IPC。每轮发送前，主进程把本轮知识库 ID 写入 agent scope 的 session allowlist；`query_knowledge` 按 OpenCode `sessionID` 强制校验，task 子会话会临时继承父会话 allowlist 并在结束时清除，不能仅凭历史提示中的旧 ID 查询已取消钉住的知识库。

Vite（`vite.config.ts` 的 vite-plugin-electron/simple）把 `electron/main.ts` 与 `electron/preload.ts` 打成 `dist-electron/main.js` + `preload.js`；`@opencode-ai/sdk` 与 `electron-updater` 在主进程构建中**外部化**（CJS require 不能进 ESM bundle）。`wiki-graph` 也是 runtime dependency，但用途不同：Wanta 通过项目内 CLI 文件路径单独启动它，并从 asar 解包其 `sqlite3` 原生模块。边界规则：除这些明确的运行时依赖外，其余依赖（含 `@oomol/connection`）全部被 vite 打进 bundle，因此一律放 devDependencies。

## 2. Agent 内核（electron/agent/，electron-free，可 headless 测试）

| 模块                  | 职责                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| --------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `manager.ts`          | `AgentManager`：编排 sidecar。`promptStreaming()`（`session.promptAsync` 非阻塞，agent 走 OpenCode 原生 `build` / `plan`；默认 Build，Planning 传 `agent:"plan"`；非 `default` 且被当前模型支持的 `reasoningLevel` 透传为 OpenCode `body.variant`；model 默认传 Auto，即 `{providerID:"oomol", modelID:"oopilot"}`；用户选择 GPT 5.5 时传 `{providerID:"openai", modelID:"gpt-5.5"}`），每轮把 `buildAuthorizedSystem()` 注入 `body.system`——R4 已授权 Link provider 存在性提示，实测为**追加**到 agent.prompt 之后而非覆盖；默认不列具体 provider 名，避免可用性上下文变成工具诱导）；`sendMessage()`（阻塞，headless 用）；`subscribe()`（OpenCode 全局 SSE 事件循环）；session CRUD；`listAuthorizedServices()` 直查 `${connectorBaseUrl}/v1/apps`。                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| `sidecar.ts`          | `OpencodeSidecar`：spawn `opencode serve --hostname=127.0.0.1 --port=0`，解析 stdout 中 "listening on URL" 拿地址。**禁止加 `--pure`**（会跳过自定义插件，`.opencode/tools` 连接器工具会静默失效）。配置经 `OPENCODE_CONFIG_CONTENT` 环境变量内联注入（凭证=会话 token，provider 的 `options.apiKey` 字段名保留但值为 token；只入内存 env，不落盘）；`OPENCODE_CONFIG_DIR` / `XDG_CONFIG_HOME` / `XDG_DATA_HOME` 指向 `userData/agent/isolation`（隔离全局 `~/.config/opencode`；目录须在启动前异步预建，缺失会 500）；`OPENCODE_DISABLE_EXTERNAL_SKILLS=1`，sidecar 不直接扫 `~/.agents` / `~/.claude` 等全局根，外部 agent skill 由 `SkillServiceImpl` 扫描后同步到 Wanta 私有 workspace，避免同名旧副本抢占；`PATH` 由 `command-path.ts` 按平台合并：macOS/Linux 读取用户登录 shell PATH，Windows 读取当前用户与系统注册表的最新 Path，并在两端都保留 Wanta 自带 bin、Electron 继承 PATH 与平台专属常见命令目录；只导入 PATH，不导入 shell/注册表中的其他环境变量；随机 `OPENCODE_SERVER_PASSWORD` Basic Auth；`dispose()` SIGTERM。                                                                                                                                                                                                                                                                              |
| `config.ts`           | `buildOpencodeConfig()`：provider `oomol`（默认 Auto/`oopilot`，npm `@ai-sdk/openai-compatible`，baseURL=`llmBaseUrl`，同时承载其他 OpenAI-compatible 内置模型）+ provider `openai`（GPT 5.5，OpenAI Responses runtime）。注意：网关 `/v1/models` **不会列出** `oopilot`，它是网关侧别名、由 chat/completions 路由到真实模型——勿据 models 列表"纠正"Auto 模型名。覆盖 OpenCode 原生 agent `build` / `plan`：Build 使用 `WANTA_SYSTEM_PROMPT`，Plan 使用 `WANTA_PLAN_SYSTEM_PROMPT`；`external_directory`、`edit` 与除直接 `oo` / `$WANTA_OO_BIN` / `${WANTA_OO_BIN}` 之外的本地 `bash` 都先走 ask，再由 ChatService 主进程本地访问策略处理（默认访问 / 完全访问；默认访问自动批准普通 bash、脚本、项目检查、数据处理、简单输出过滤、普通文件读写与具体非敏感路径，只在凭证/密钥路径、宽泛 home/system 根、破坏性删除、依赖安装、提权、推送、发布/部署、基础设施变更等基础安全边界暂停；Python 第三方依赖仅能在当轮 process 目录的私有 `.wanta-python` venv 中获得任务级窄授权，不能覆盖系统/用户 Python 或其他安装源；完全访问 = 会话级本地 YOLO 并自动批准本会话本地 ask）；直接 `oo` / `$WANTA_OO_BIN` / `${WANTA_OO_BIN}` 命令仍保留 OpenCode 快速放行，用于连接器 CLI 自身调用。Plan 的 `edit` 仅允许 `.opencode/plans/*.md`。根级 `WANTA_PERMISSION` 同步 Build 权限；不下发 tools 禁用表（内置工具全部启用）。 |
| `system-prompt.ts`    | `WANTA_SYSTEM_PROMPT`（英文）：Worker / task-first 定位——先判断用户要完成的工作结果，再在直接回答、Local tools、Link tools 之间选最短可靠路径；需要本机上下文时用 Local tools（bash、文件、脚本、具体 URL；cwd 是私有 scratch，访问真实文件用绝对路径或 `~`）；当前 workspace 连接清单用 `list_apps`，但禁止把它当普通 SaaS 执行前的健康检查；任务确实需要连接账号/SaaS 数据或动作时走 Link tools（search→inspect→call 流程）。provider skill 中的裸 oo CLI 优先作为能力参考；Link 工具无法完成而任务确需时仍可执行，但必须使用当前回合 selector。保留 inspect-before-call、authorization_required 阻断、最小访问/载荷、副作用确认等契约。                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| `tool-sources.ts`     | 5 个自定义工具的 **String.raw 内嵌源码**（`list_apps.ts` / `search_actions.ts` / `inspect_action.ts` / `call_action.ts` / `query_knowledge.ts`），导出 `AGENT_TOOL_FILES`。工具从 workspace 私有的 `../runtime/tool.js` 导入构建期合并好的 tool helper + Zod，工具加载不依赖 OpenCode 在用户机器上隐式安装 npm 包。运行于 OpenCode 的 Bun，不参与本项目 tsc/oxlint；经 `execFile` 调 oo（路径取 `process.env.WANTA_OO_BIN`，回退 `"oo"`——注意打包/Finder 启动的 GUI 进程**不继承 shell PATH**（PATH 为空），二进制一律走绝对路径（`WANTA_OO_BIN` env / `resolveBundledBin`），`"oo"` 字符串回退仅是 dev 兜底，生产不可用）。`list_apps`、`search_actions` 和 `call_action` 都按当前会话团队显式传 `--organization`；`search_actions` 用 `oo connector apps --json` 覆盖 search 结果的 active-workspace `authenticated`。`call_action` 把 stderr 中 `errorCode: <code>` 命中 AUTH_BLOCKING 集合的错误翻译为 `{status:"authorization_required", authUrl: <console>/app-connections?provider=...}`（authUrl base 只取 `WANTA_CONSOLE_URL` env，缺失时返回结构化 `config_missing` 错误，避免硬编码 endpoint）。                                                                                                                                                                                                          |
| `workspace.ts`        | `ensureAgentWorkspace(rootDir, bundledSkillsDir?, bundledToolRuntimePath?)`：每次启动幂等覆盖写 `<userData>/agent/workspace/.opencode/tools/*.ts`（用 `node:fs/promises`；目录名**复数 `tools`** 系 1.17.3 实证，上游文档说法不一，勿改单数），同步构建期合并的 `.opencode/runtime/tool.js`，并以打包内置 skill 为准重建 `.opencode/skill/<name>/`（源 = `resources/skills`，由 `scripts/skills.ts` 经 `oo skills install --out-dir` 导出的 4 个 oo skill；OpenCode 扫 cwd 的 `.opencode/{skill,skills}/**/SKILL.md`，故 Wanta 自己的 agent 直接读到这 4 个 skill——**不再把 skill 释放到其他 AI agent 家目录**）。`.opencode/skills/` 是 Wanta registry/runtime skill 的私有目标目录，由 `SkillServiceImpl` 写入，不被 bundled skill 同步清空；Wanta registry cache 和 Claude Code / Codex / Universal 等外部 agent skill 都先同步到这里，再交给 sidecar 加载。workspace 即 sidecar 的 cwd，**不可更改**（自定义工具依赖其下 `.opencode/tools/`）。                                                                                                                                                                                                                                                                                                                                                                  |
| `oo.ts`               | `buildOoEnv()`（R3）：`OO_API_KEY`（变量名保留，值为会话 token） / `OO_ENDPOINT` / `OO_CONFIG_DIR`、`DATA_DIR`、`LOG_DIR`（`userData/agent/oo-store` 下）/ `OO_SKILLS_SYNC_DISABLED=1` / `OO_NO_SELF_UPDATE=1` / `OO_TELEMETRY_DISABLED=1` / `OO_LOG_LEVEL=warn` + `WANTA_ENDPOINT` / `WANTA_CONSOLE_URL` / `WANTA_CONNECTOR_URL` / `WANTA_OO_BIN`。另导出 `AUTH_BLOCKING_ERROR_CODES`（connection_required 等 5 个）与 `parseConnectorErrorCode()`（与 tool-sources 内联实现保持一致）。                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| `binaries.ts`         | 二进制解析：dev 时 opencode = `node_modules/opencode-ai/bin/opencode.exe`（所有平台固定此文件名，上游 postinstall 已选好本机变体）、oo = `.oo-bin/oo[.exe]`；生产 `resolveBundledBin(process.resourcesPath, name)` = `Resources/bin`。                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| `event-translator.ts` | 无状态翻译 OpenCode SSE（`message.updated` / `message.part.updated` / `session.error` / `permission.asked` / `permission.v2.asked` 等）→ ChatService ServerEvents（每事件 0..n 个 emit）；`parseAuthorization()` 识别 call_action 的授权信号 JSON；permission 事件先进入 ChatService 主进程本地访问策略，可自动批准的请求直接经 OpenCode permission reply API 继续，仍需用户判断的请求才映射为聊天内权限状态。                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |

Link 批量可靠性由 Wanta 自定义 `call_action` 工具保证，不依赖模型或 OpenCode 自行收敛：同一聊天会话内对短时间出现的同 workspace/service/connection/action fan-out 先执行单个 canary，成功后最多并发 2 个；首个授权阻断会短期熔断同连接目标，排队调用返回结构化 `skipped`。canary、短期熔断和去重状态都按 session 隔离；同一 workspace 的不同聊天会话不会共享这些状态。显式 `connectionName` 在执行前通过当前 workspace 的 `connector apps` 结果校验，清单不可读或名称不匹配时返回普通结构化错误而不是授权提示。聊天渲染保留每条工具审计记录，但按本轮连接目标和错误聚合为单一 CTA；同一目标本轮先成功、后被阻断时展示连接状态不一致语义。

## 3. IPC 模式（R7，贯穿约定）

每个域 = `common.ts`（契约：`serviceName("x-service")` as `ServiceName<{ServerEvents, ClientInvokes}>`，main/renderer 共享 import）+ `node.ts`（实现：`class XServiceImpl extends ConnectionService<X>`，主进程→渲染推送用 `this.send(event, data)`）。渲染端 `client.use(XService)` 后 `service.invoke("method", args)` / `service.serverEvents.on("event", cb)`。ServiceName 实际字符串如 `wanta/chat-service`（前缀来自 `branding.servicePrefix`）。

十个 service：`chat` / `attention` / `session` / `skill` / `models` / `settings` / `auth` / `update` / `git` / `knowledge`（connector 与 teams 曾各有一个 service，请求搬到渲染层后**整个 service 已删除**，见 §4）。新增 service 时不要凭记忆推断 `@oomol/connection` API（私有包），照抄现有最小活例（如 `electron/settings/common.ts` + `node.ts`）。**安全注意**：`@oomol/connection` 按方法名动态派发、无白名单——注册对象的所有公开方法都可被渲染层 invoke，敏感逻辑必须放未注册对象（见 `AuthManager`）。涉及本地副作用的 service（如 `git`）要在主进程侧校验目标来自已登记的用户项目，不能只信任渲染层传入路径。

IPC 只承载"必须在主进程做"的事（agent 内核、deep-link 鉴权、fs、`shell.openExternal`、cookie）；**纯由渲染业务驱动的网络请求一律走渲染层直连**（见 §4），不再经 IPC 让主进程代发。

## 4. 渲染层直连 oomol 请求（cookie 鉴权 + 主进程 CORS shim）

**原则**：主进程做的事越少越好——主进程事件循环一旦卡住，渲染层经 IPC 的调用全部排队、UI 跟着卡。故**凡是由渲染业务驱动、本质只是"取数据/发动作"的网络请求，一律由渲染进程直发**，不再调 IPC 让主进程代发。

**机制（守 R4 / R2）**：

- 渲染层 `src/lib/oomol-http.ts` 的 `oomolFetch(url, init)` 强制 `credentials:"include"`——唯一凭证 `oomol-token` 是 **httpOnly 会话 cookie**（见 §6），由 Chromium 网络栈自动附带，渲染层既读不到也写不了 token（守 R4）。**绝不**在渲染层设 `Authorization` / `Cookie` 头（浏览器 fetch 里 `Cookie` 还是禁止头）。`oomolFetchJson` 把 401 归一为 `auth_required` 哨兵（文案 "Sign in is required."），与 billing/登录的可恢复生命周期一致。
- 域名从 `electron/domain.ts` 派生（经 `src/lib/domain.ts` 再导出）。`__OO_ENDPOINT__` 是 vite **顶层 `define`** 注入的构建期常量，作用于渲染 bundle，故渲染层 import `electron/domain.ts` 能拿到与主进程同一套 `*.<endpoint>` base URL，**不硬编码域名**（守 R2）。
- 跨站 CORS 由主进程 `electron/net/oomol-cors.ts` 的 `installOomolCorsShim`（`main.ts` whenReady 调用）解决：渲染文档 origin 是 dev `http://localhost:5273` / 生产 `file://`，对 `*.<endpoint>` 是跨站，服务端从不为这些 origin 下发 CORS 头、且带凭证时 `ACAO` 不能用 `*`。shim 用 `webRequest.onBeforeSendHeaders` 捕获请求 `Origin`、`onHeadersReceived` 回显之 + `Allow-Credentials:true`，并答复预检 `OPTIONS`（改 200 + Methods/Headers/Max-Age）；作用域严格限 `https://*.${ooEndpoint}/*`（域名由 `ooEndpoint` 派生，守 R2）。纯头部改写、无 token 逻辑、无同步 fs（守 R1）。纯函数核心 `applyOomolCors` 带单测。**生产 `file://`（Origin `null`）实测可行**：CDP 在打包渲染进程实发，匿名（search）与认证（connector，cookie 自动附带）请求均 200。

**已搬到渲染层的域**（各有 `src/lib/*-client.ts`；billing 的聚合缓存由 hook 管理，connections / skills
在 client 内维护按请求键缓存，teams 的组合资源由 `team-details-resource.ts` 管理）：

| 域          | 渲染层落点                                                                                                                                                                                                                                                                 | 主进程残留                                                                                              |
| ----------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| billing     | `billing-client.ts`（团队 Team 订阅/席位、团队用量、创建者个人余额与个人用量优惠订阅的 insight/console-server 请求 + 结账 URL 解析）；团队用量带 workspace header，创建者余额/用量订阅不带团队 header，成员不得退化查询或订阅自己的个人账户；主进程 `chat/billing.ts` 已删 | open\* 改 `chatService.openExternalUrl` IPC（仅 `shell.openExternal` 校验外开）                         |
| voice ASR   | `routes/Chat/voice-asr.ts`（音频本就在渲染层录制，免去 base64 穿 IPC）                                                                                                                                                                                                     | 无                                                                                                      |
| teams       | `teams-client.ts` + `team-details-resource.ts`（成员、授权、provider options 的短时共享资源）；**整个 IPC service 已删**                                                                                                                                                   | 无                                                                                                      |
| skills 浏览 | `skills-catalog-client.ts`（registry/search 浏览 GET；搜索结果直接使用 search 响应，避免逐包详情扇出；“我发布的”仍并发补全详情）                                                                                                                                           | install/update 仍是 oo CLI spawn + 写盘 + 刷新 agent（本就不是 fetch）                                  |
| connections | `connections-client.ts`（连接器全量 HTTP + etag/30s GET 缓存 + summary merge）；`useConnections(workspace)` 持 summary 状态与 oauth 轮询；**整个 IPC service 已删**                                                                                                        | oauth 开浏览器走 `chatService.openExternalUrl`；workspace→agent 团队作用域走 `chatService.setAgentTeam` |

**仍留主进程的请求（正确，非渲染业务）**：`auth/node.ts` 的 deep-link 取 token（`POST /v1/auth/auth_id` + `GET /v1/users/profile`，cookie 必须在主进程设，见 §6）；`agent/manager.ts` 的 `listAuthorizedServices`（`GET /v1/apps`，短 TTL 缓存且提示词关键路径只等待有限预算）与标题生成 `chat/completions`——都是 agent 内核内部、sidecar 驱动，不是渲染业务。

## 5. 聊天流式数据流

```
src/routes/Chat (PromptInput)
  → useChat.send → chatService.invoke("sendMessage", {sessionId, text})
  → ChatServiceImpl.sendMessage → AgentManager.promptStreaming
      （body.system 尾部注入已授权 Link 存在性提示，默认不列 provider 名，R4）
  → OpenCode sidecar 跑 agent loop（LLM ↔ 工具）
  → 全局 SSE: AgentManager.subscribe → event-translator.translateOpencodeEvent
  → ChatServiceImpl 主进程按 32ms 窗口合并同一文本 part，再广播 ServerEvents
  → useChat 状态机（renderer）
```

ServerEvents（`electron/chat/common.ts`）：`messageStarted` / `messageDelta`（**累计全文非增量**，渲染层按 `partId` 替换）/ `toolCallStarted` / `toolCallResult` / `authorizationRequired` / `messageCompleted` / `agentError`。`ChatServiceImpl` 在主进程对同一 session/message/part 的 text/reasoning 事件做有界合并，控制事件到达时立即 flush；重复 `message.updated` 不再重复广播 `messageStarted`。`useChat.ts`：按 sessionId→messages map、`upsertPart` 按 partId 原地更新（稳定 React key，不重挂载无闪烁）、发送时插入乐观 user 气泡 `local-user-*`（真实 user 消息到达时清除）、`messageCompleted` 后 reload 全量校正。事件桥由 `ChatServiceImpl.startEventBridge()` 在 agent 装配后启动。

普通文件附件在选择时先冻结到 `userData/attachments/originals/<attachment-id>/` 的 0400 只读私有快照，后续预览、解析和
本地工具只使用快照，不修改或继续依赖用户源文件。模型兼容表示（当前包括 XLSX 提取文本和优化图片）与公开附件身份
严格分离：发送前由 `UserAttachmentStore` 按 OpenCode user message ID 原子持久化原始附件清单到
`userData/user-attachments.json`，`agentPath` 只作为内部输入。OpenCode 展开的 synthetic Read 文本和内部文件 part 不广播
给渲染层；历史加载也以 Wanta 附件清单覆盖 OpenCode 的模型表示，因此发送中、刷新和重启后始终展示用户选择的文件名、
MIME 和快照路径。若用户要求修改附件，agent 必须先复制到本轮 artifact 目录并把副本作为新输出；目录附件仍是显式
本地引用，不做递归快照。

渲染用 vendored ai-elements（`src/components/ai-elements/`）：Conversation/Message/PromptInput/Task 等；Markdown 走 streamdown（MessageResponse 内置）；工具 part 映射为聊天内的 `Task` 折叠摘要。

制成品不从回复文案或复制内容中猜测。每轮 Build 都有主进程分配的托管输出目录：请求携带的项目上下文仍在
`SessionProjectStore` 登记且路径匹配时，目录位于 `<project>/.wanta/artifacts/<session>/<turn>/`；无项目、项目登记不匹配
或 Plan 模式继续使用 `userData/agent/artifacts/<session>/<turn>/`。项目路径必须先通过登记校验，项目内
`.wanta/artifacts` 的既存路径段不得是符号链接，避免制成品越界写出项目。轮次结束后
`ChatServiceImpl` 只按真实文件建立 `ArtifactBundle`，并由 `ArtifactBundleStore` 原子持久化到
`userData/artifact-bundles.json`。已登记项目的 Build 任务还会把本轮最终制成品按托管目录中的相对布局发布为
项目根下的普通可见文件；根级同名文件和顶级目录均以 `-2`、`-3` 递增避让，绝不覆盖，发布后的文件由用户持有，
删除会话只清理 `.wanta` 托管目录而不删除可见文件。无项目和 Plan 模式不执行项目发布。本地 assistant attachment
会先复制进托管目录；主进程递归扫描目录里的非隐藏
普通文件，再对第三方 Skill 混写的运行状态 sidecar 做保守分类：只有文件名呈 session/resume/checkpoint/state 语义、
小型 JSON 同时具有任务标识和运行态字段、目录内另有明确成果且该文件并非 assistant 明确附件/预览时，才保留原文件
但不登记进 bundle；唯一输出、损坏/过大/结构不确定的 JSON 一律保留为成果。其余文件递归登记为 `ArtifactItem`，
`totalItems`、类型和展示方式只按用户可见成果及真实 MIME / 文件组合推导，不要求模型写 manifest。渲染层通过
`getArtifactBundles` + `artifactBundleUpdated` 读取结构化记录，`ChatTimeline` 再把 bundle 放到对应 assistant
消息下方。消息成果卡及右侧面板只携带该消息所在轮次的 bundle：单文件直接预览，多文件只浏览本轮集合，不把
整个会话的历史成果隐式合并进任意一张卡；顶部成果入口跟随最近一轮可用成果。复制按钮只复制消息文本，不参与
制成品生命周期。如果回复里已经显示生成图片、但轮次结束时仍没有
可重新打开的本地文件，则登记 `failed/generated_preview_not_persisted`；只有一部分图片成功落盘时登记 `partial`。
UI 分别明示“制成品保存失败”或“部分制成品未保存”，不得静默消失或把远程 URL 冒充已保存制成品。聊天正文
中的图片预览与制成品持久化彼此独立，但对最终生成图片两者都必须产出。轮次结束时，主进程会把 assistant 的本地
图片附件、Markdown data image 和公开 HTTPS 图片预览自动物化进本轮托管目录，再建立 bundle；因此预览来源不必
天然就是本地文件。远程物化只允许无账号信息的公开 HTTPS 地址，逐跳校验重定向与解析地址，拒绝本机/内网地址、
非图片响应和超过 32 MiB 的内容。无法物化时保留正文预览并登记 partial/failed，而不是让预览冒充已保存制成品。
为防止模型复用旧脚本时把新文件写进上一轮目录，`sendMessage` 会在轮次开始记录同一会话旧制成品目录的文件基线；
轮次结束时只把基线后新增或发生变化的旧目录文件复制进当前轮目录，再以当前消息独立登记 bundle，旧 bundle 不被改写。
扫描严格限制在本轮实际存储位置的当前会话制成品根目录内，忽略隐藏项和符号链接；基线不完整或越界时直接停用恢复，不做猜测。

内置 `/bug-report` 斜杠命令仍发送到当前 OpenCode session，由 `ChatServiceImpl` 为该轮追加专用 system prompt，
仅基于命令前已有的会话证据生成 `wanta-bug-report.md`。命令在分配制成品目录前即把有效模式强制为 Build，使
`createArtifactDir`、`artifactSessionDir` 与 `promptStreaming` 使用同一模式，并把这一份 UTF-8 Markdown 报告写入
Build 托管输出目录；不得调查、重试或修复原问题，也不得调用连接器、网络、shell 或读取额外文件。报告经上述
`ArtifactBundle` 链路展示为单文件制成品，assistant 正文只给简短完成状态，不重复报告内容。

聊天中的多文件 bundle 只显示一个集合卡片，使用真实文件数量作为标题，不展示内部轮次目录名，也不再追加行为相同的
“查看全部”入口。中间脚本、临时数据和日志写入独立的 process 目录，以 `TurnOutputRecord.process` 记录并通过次级
“执行详情”入口按需查看；它们不是制成品。项目内原位修改则以 `project_change` 展示审查/Diff，同样不冒充导出制成品。
`process` 与 `project_change` 共用 `TurnOutputShelf` 和 `TurnOutputsPanel`；同一轮两类文件并存时，右侧面板提供
“变更 / 过程文件”角色切换，并按用户点击的入口选择初始角色。切到过程文件时默认折叠并保留非制成品提示。
右侧制成品预览继续经 `resolveLocalArtifacts` 浏览已登记的受信任目录。

## 6. 登录与凭证流

**全应用唯一凭证是会话 token `oomol-token`**（Electron 会话 cookie，持久但短命会过期）。网关层统一鉴权——无论
收到 cookie、token 还是 api-key 都能认证——故聊天/连接器/团队/技能/账单一律用这枚 token。**不再获取或落盘
长期 default-api-key**（长期凭证落盘不安全，且会造成"聊天能用但用量看不了"的割裂生命周期）。

1. 渲染层点「使用浏览器登录」→ 主进程开系统浏览器 `https://console.<ep>/launcher?protocol=<scheme>`
2. 网页登录后回跳 deep-link `<scheme>://signin?authID=...`（macOS `open-url` 监听**必须在模块顶层注册**，等 whenReady 会丢冷启动回调）
3. 主进程 `POST https://api.<ep>/v1/auth/auth_id` 换 `oomol-token` 会话 cookie（持久化为 Electron cookie，过期时间 = JWT exp）
4. 用该 token 取 `GET /v1/users/profile` 拿账号画像（**不再取 default-api-key**）
5. profile 写 `userData/auth.json`（0600、tmp+rename 原子写、**只存 profile 不存凭证**）→ `applyAuthAccount` 用会话 token 拉起 agent

凭证唯一性带来一致生命周期：`AuthManager.currentState()` 异步、**token 门控**——profile 仍在但 cookie 过期/被驱逐
即判为未登录 → 渲染层落到 `LoginRoute`，聊天/连接器/用量随之全部不可用（不再有割裂）。`activeRuntimeAccount()`
= profile + 会话 token（无 token 返回 null）；`currentSessionToken()` 供 connector/team/skills 取凭证。启动时
`AuthStore.purgeLegacy()` 一次性抹除磁盘上残留的旧长期 api-key。

`applyAuthAccount`（main.ts）经 `applyChain` promise 串行化 + 同凭证（id+sessionToken）幂等短路（冷启动 deep-link 与 whenReady 双路径会重复 apply）；agent 启动失败回滚不留僵尸引用。非本应用发起的登录回调（无 pending）须弹系统对话框确认（防 login-CSRF）；pending 有 10 分钟超时。纯函数部分在 `electron/auth/browser-login.ts`（带单测）。

渲染层 `src/App.tsx`：AuthGate——状态未知渲染空背景 → 未登录 `LoginRoute` → 已登录 `<AppShell key={account.id}/>`（换号整树重挂载）。

## 7. Connections 面板流

连接器请求**已整体搬到渲染层**（`src/lib/connections-client.ts`，见 §4）——这正是"主进程做太多"的典型：summary 四路扇出在 oauth 期每 2s 轮询里高频触发。客户端用 `oomolFetch`（会话 cookie 自动鉴权，**不再设 `Authorization: Bearer`**）；Apps、用量和详情等团队资源按 workspace 附 `x-oo-organization-name` 头，全局 `/v1/providers` 公共目录不附团队头。两类读取分别保留 etag/`if-none-match` + 30s GET 缓存（省去轮询重拉 ~600 provider 目录），且团队 Apps 的权限拒绝或临时故障不会清空公共 Provider 目录；`summary.ts`/`usage.ts`/`executions.ts`/`federated.ts`/`domain.ts` 等纯函数被渲染层直接 import（merge `/v1/apps` 已连接 + `/v1/providers` 目录 → `ConnectionSummary`）。

`useConnections(workspace)`（唯一消费者，AppShell 实例化）持 summary 状态：workspace 由 `useTeamWorkspace` 传入（`null` 表示团队名未就绪则沿用上一个），变化时**重拉 summary + 经 `chatService.setAgentTeam` IPC 同步 agent 团队作用域**（agent 仍由主进程持有）。`connect()` 5 种 authType：`oauth2` 渲染层 `startOAuthConnect` 取 authorizationUrl → `chatService.openExternalUrl` IPC 开系统浏览器（主进程仅 https 校验 + `shell.openExternal`）→ 以 2s 间隔/5min 超时轮询 summary 直到出现连接；`api_key` / `custom_credential` / `federated` / `no_auth` 直接 POST 后本地刷新。变更（connect/disconnect/alias）成功后本地 `clearConnectorCache()` + 重拉，**不再有跨进程 `connectionSummaryChanged` 广播**（单消费者，本地 state 即同步）。聊天内 `authorizationRequired` 事件 → 渲染"去授权"按钮 → 打开右侧面板定位 provider。

## 8. 模块地图

```
electron/
  main.ts preload.ts          组装根 / RPC 桥
  branding.ts domain.ts       R1 品牌单一来源 / R2 endpoint 派生（唯一域名来源；domain.ts 也被渲染层 import，见 §4）
  protocol.ts                 deep-link 注册/单实例锁/URL 监听
  service-events.ts           进程内 ServiceEvent<T>（非 RPC）
  net/oomol-cors.ts(+test)    渲染层直连 *.<endpoint> 的 CORS shim（见 §4）；纯函数 applyOomolCors + webRequest 薄壳
  agent/                      见 §2
  attention/ common,node,store,policy(+test)          未读任务状态、持久化、系统通知与应用图标 badge 策略
  auth/    common,node,store,browser-login(+test)   登录与凭证（见 §6）
  chat/    common,node,artifact-bundles(+test)       聊天契约 + SSE 事件桥 + 结构化制成品登记/持久化；另含薄主进程门面 openExternalUrl（shell 外开）/ setAgentTeam（agent 团队作用域）供渲染请求层调用（见 §4、§5）
  connections/ common,summary,usage,executions,federated,domain,summary-model(+test)
                              **纯函数 + 类型，无 node.ts**——连接器请求已搬渲染层（src/lib/connections-client.ts，见 §4、§7）；这些模块 electron-free，被渲染 bundle 直接 import
  knowledge/ common,node,store,runner,uri(+test)      WikiGraph 知识库导入、登记、查询运行时与 RPC service
  teams/ common       **仅剩类型，无 node.ts**——团队请求已搬渲染层（src/lib/teams-client.ts，见 §4）
  skills/  common,node,actions,scan,inventory,…      技能 service（安装/扫描/清单）；浏览 GET 已搬渲染层（src/lib/skills-catalog-client.ts），actions.ts 的 normalize* 被渲染层复用（见 §4）
  session/ common,node        会话 CRUD（代理 AgentManager，sessionsChanged 广播）
  models/  common,node,store,builtin(+test)          内置 + 自定义模型清单；改自定义模型重启 agent
  settings/ common,node,store(+test)                themeSource + updateChannel；原子写；不存凭证（R8）
  update/  common,node,channel,policy(+test)        UpdateService：检查/下载/安装/渠道切换、周期/前台/唤醒调度 + appUpdateStateChanged；
                              generic feed = static.<ep>/release/apps/wanta/<plat>/<arch>；仅打包态；autoDownload=false
                              （设置页 UI 显式触发）；渠道经 setFeedURL channel 字段（勿用 channel setter——
                              会静默置 allowDowngrade）+ 显式 allowDowngrade=false；404 容忍限次重试；
                              ESM 下须 updaterPkg.autoUpdater 静态 default import
src/
  main.tsx App.tsx            入口 / AuthGate
  lib/     oomol-http domain  渲染层直连请求底座（见 §4）：oomolFetch（credentials:include）/ domain 再导出
           billing-client connections-client teams-client skills-catalog-client   各域请求客户端（connections / skills 自带按键缓存）
           team-details-resource                          团队成员/授权/provider options 共享资源与定向失效
  components/app-shell/       AppShell 三栏 + 内部 Route state（"chat"|"settings"）
  components/ai-elements/     vendored 裁剪版（conversation loader message message-image prompt-input shimmer task）
  components/ui/              shadcn 基件（button badge input textarea dialog collapsible input-group split-view）
  routes/  Chat/ Connections/ Login/ Settings/ Skills/   （Chat/voice-asr.ts 渲染层语音转写，见 §4）
  hooks/   useChat useSessions useConnections useAuth useAppUpdate useBillingOverview useTeamWorkspace
  i18n/    自研轻量 i18n（zh-CN 基准 + en，localStorage key wanta.locale）
  index.css                   Tailwind v4 单文件主题（CSS variables；含 @source streamdown）
```
