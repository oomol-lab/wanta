# 架构：进程划分、Agent 内核、IPC、数据流

> 相关：[project-overview.md](project-overview.md)（是什么）· [key-decisions.md](key-decisions.md)（为什么）· [conventions.md](conventions.md)（怎么写代码）

## 1. 三进程划分

- **主进程** `electron/main.ts`：组装根。创建 `ConnectionServer(new ElectronServerAdapter())`，构造 `SettingsStore` / `AuthStore`（`app.getPath("userData")` 下的 `settings.json` / `auth.json`），实例化 5 个 service 并 `server.registerService(...)`（**必须在 `server.start()` 之前**）。登录成功后经 `applyAuthAccount(account)` 动态拉起 `AgentManager`（rootDir = `userData/agent`）并注入 chat/session service；登出时置 null。deep-link（dev `lumo-local://` / 生产 `lumo://`）交给 `authManager.completeBrowserLoginCallback`。单实例锁仅打包态启用。外链统一走 `openExternalUrl` helper（协议白名单 http/https/mailto/tel → `shell.openExternal`），`setWindowOpenHandler` 与 `will-navigate` 两条路径共用。
- **preload** `electron/preload.ts`：极薄。`setupConnectionPreload()`（@oomol/connection RPC 桥）+ contextBridge 暴露 `window.electron` 与 `window.lumo = { appCommit, platform, version }`（来自 vite define `__APP_COMMIT__` / `__APP_VERSION__`）。
- **渲染进程** `src/main.tsx`：`ConnectionClient(new ElectronClientAdapter())` → `client.use()` 5 个 service 契约 → `AppContext.Provider`。渲染层**直接 import** `electron/*/common.ts` 的契约类型（跨目录共享类型，不复制）。

Vite（`vite.config.ts` 的 vite-plugin-electron/simple）把 `electron/main.ts` 与 `electron/preload.ts` 打成 `dist-electron/main.js` + `preload.js`；`@opencode-ai/sdk` 与 `electron-updater` 在主进程构建中**外部化**（CJS require 不能进 ESM bundle，故这两个是 package.json 仅有的 runtime dependencies）。边界规则：除这两个外，其余依赖（含 `@oomol/connection`）全部被 vite 打进 bundle，因此一律放 devDependencies——只有"无法进 ESM bundle 而必须运行时 require"的包才外部化为 dependency。

## 2. Agent 内核（electron/agent/，electron-free，可 headless 测试）

| 模块                  | 职责                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| --------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `manager.ts`          | `AgentManager`：编排 sidecar。`promptStreaming()`（`session.promptAsync` 非阻塞，agent=`lumo`、model 传 `{providerID:"oomol", modelID:"oopilot"}` 组合对象（下文 `oomol/oopilot` 即其简写），每轮把 `buildAuthorizedSystem()` 注入 `body.system`——R4 已授权 Link provider 存在性提示，实测为**追加**到 agent.prompt 之后而非覆盖；默认不列具体 provider 名，避免可用性上下文变成工具诱导）；`sendMessage()`（阻塞，headless 用）；`subscribe()`（OpenCode 全局 SSE 事件循环）；session CRUD；`listAuthorizedServices()` 直查 `${connectorBaseUrl}/v1/apps`。                                                                                                                                                                                                                                                                 |
| `sidecar.ts`          | `OpencodeSidecar`：spawn `opencode serve --hostname=127.0.0.1 --port=0`，解析 stdout 中 "listening on URL" 拿地址。**禁止加 `--pure`**（会跳过自定义插件，`.opencode/tools` 三个连接器工具会静默失效）。配置经 `OPENCODE_CONFIG_CONTENT` 环境变量内联注入（apiKey 只入内存 env，不落盘）；`OPENCODE_CONFIG_DIR` / `XDG_CONFIG_HOME` / `XDG_DATA_HOME` 指向 `userData/agent/isolation`（隔离全局 `~/.config/opencode`；目录须在启动前异步预建，缺失会 500）；随机 `OPENCODE_SERVER_PASSWORD` Basic Auth；`dispose()` SIGTERM。                                                                                                                                                                                                                                                                                                |
| `config.ts`           | `buildOpencodeConfig()`：provider `oomol`（npm `@ai-sdk/openai-compatible`，baseURL=`llmBaseUrl`）、model `oopilot`（注意：网关 `/v1/models` **不会列出** `oopilot`，它是网关侧别名、由 chat/completions 路由到真实模型——勿据 models 列表"纠正"模型名）、agent `lumo`（prompt 整段替换为 `LUMO_SYSTEM_PROMPT`）。`LUMO_PERMISSION` 全 allow（edit/bash/webfetch/external_directory），同时下发到 agent 级与根级；不下发 tools 禁用表（内置工具全部启用）。                                                                                                                                                                                                                                                                                                                                                                   |
| `system-prompt.ts`    | `LUMO_SYSTEM_PROMPT`（英文）：Worker / task-first 定位——先判断用户要完成的工作结果，再在直接回答、Local tools、Link tools 之间选最短可靠路径；需要本机上下文时用 Local tools（bash、文件、脚本、具体 URL；cwd 是私有 scratch，访问真实文件用绝对路径或 `~`）；只有任务确实需要连接账号/SaaS 数据或动作时才进 Link tools（search→inspect→call 流程）。保留 inspect-before-call、authorization_required 阻断、最小访问/载荷、副作用确认等契约。                                                                                                                                                                                                                                                                                                                                                                                |
| `tool-sources.ts`     | 3 个自定义工具的 **String.raw 内嵌源码**（`search_actions.ts` / `inspect_action.ts` / `call_action.ts`），导出 `AGENT_TOOL_FILES`。运行于 OpenCode 的 Bun，不参与本项目 tsc/oxlint；经 `execFile` 调 oo（路径取 `process.env.LUMO_OO_BIN`，回退 `"oo"`——注意打包/Finder 启动的 GUI 进程**不继承 shell PATH**（PATH 为空），二进制一律走绝对路径（`LUMO_OO_BIN` env / `resolveBundledBin`），`"oo"` 字符串回退仅是 dev 兜底，生产不可用）。`call_action` 把 stderr 中 `errorCode: <code>` 命中 AUTH_BLOCKING 集合的错误翻译为 `{status:"authorization_required", authUrl: <console>/app-connections?provider=...}`（authUrl base 取 `LUMO_CONSOLE_URL` env，源码内仍留 `https://console.oomol.com` 字面量 fallback——这是公开主域、非 `oomol.dev`，不触犯 R2 的发布 grep 不变式，属有意保留的最后兜底，运行时总被 env 覆盖）。 |
| `workspace.ts`        | `ensureAgentWorkspace()`：每次启动幂等覆盖写 `<userData>/agent/workspace/.opencode/tools/*.ts`（用 `node:fs/promises`；目录名**复数 `tools`** 系 1.17.3 实证，上游文档说法不一，勿改单数）。workspace 即 sidecar 的 cwd，**不可更改**（自定义工具依赖其下 `.opencode/tools/`）。                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| `oo.ts`               | `buildOoEnv()`（R3）：`OO_API_KEY` / `OO_ENDPOINT` / `OO_CONFIG_DIR                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          | DATA_DIR | LOG_DIR`（`userData/agent/oo-store`下）/`OO_SKILLS_SYNC_DISABLED=1`/`OO_NO_SELF_UPDATE=1`/`OO_TELEMETRY_DISABLED=1`/`OO_LOG_LEVEL=warn`+`LUMO_ENDPOINT`/`LUMO_CONSOLE_URL`/`LUMO_CONNECTOR_URL`/`LUMO_OO_BIN`。另导出 `AUTH_BLOCKING_ERROR_CODES`（connection_required 等 5 个）与 `parseConnectorErrorCode()`（与 tool-sources 内联实现保持一致）。 |
| `binaries.ts`         | 二进制解析：dev 时 opencode = `node_modules/opencode-ai/bin/opencode.exe`（所有平台固定此文件名，上游 postinstall 已选好本机变体）、oo = `.oo-bin/oo[.exe]`；生产 `resolveBundledBin(process.resourcesPath, name)` = `Resources/bin`。                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| `event-translator.ts` | 无状态翻译 OpenCode SSE（`message.updated` / `message.part.updated` / `session.error` 等）→ ChatService ServerEvents（每事件 0..n 个 emit）；`parseAuthorization()` 识别 call_action 的授权信号 JSON。**未处理 `permission.updated`**（这是 permission 不能设 "ask" 的原因）。                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |

## 3. IPC 模式（R7，贯穿约定）

每个域 = `common.ts`（契约：`serviceName("x-service")` as `ServiceName<{ServerEvents, ClientInvokes}>`，main/renderer 共享 import）+ `node.ts`（实现：`class XServiceImpl extends ConnectionService<X>`，主进程→渲染推送用 `this.send(event, data)`）。渲染端 `client.use(XService)` 后 `service.invoke("method", args)` / `service.serverEvents.on("event", cb)`。ServiceName 实际字符串如 `lumo/chat-service`（前缀来自 `branding.servicePrefix`）。

五个 service：`chat` / `session` / `connections` / `settings` / `auth`。新增 service 时不要凭记忆推断 `@oomol/connection` API（私有包），照抄现有最小活例（如 `electron/settings/common.ts` + `node.ts`）。**安全注意**：`@oomol/connection` 按方法名动态派发、无白名单——注册对象的所有公开方法都可被渲染层 invoke，敏感逻辑必须放未注册对象（见 `AuthManager`）。

## 4. 聊天流式数据流

```
src/routes/Chat (PromptInput)
  → useChat.send → chatService.invoke("sendMessage", {sessionId, text})
  → ChatServiceImpl.sendMessage → AgentManager.promptStreaming
      （body.system 尾部注入已授权 Link 存在性提示，默认不列 provider 名，R4）
  → OpenCode sidecar 跑 agent loop（LLM ↔ 工具）
  → 全局 SSE: AgentManager.subscribe → event-translator.translateOpencodeEvent
  → ChatServiceImpl this.send(...) 广播 ServerEvents
  → useChat 状态机（renderer）
```

ServerEvents（`electron/chat/common.ts`）：`messageStarted` / `messageDelta`（**累计全文非增量**，渲染层按 `partId` 替换）/ `toolCallStarted` / `toolCallResult` / `authorizationRequired` / `messageCompleted` / `agentError`。`useChat.ts`：按 sessionId→messages map、`upsertPart` 按 partId 原地更新（稳定 React key，不重挂载无闪烁）、发送时插入乐观 user 气泡 `local-user-*`（真实 user 消息到达时清除）、`messageCompleted` 后 reload 全量校正。事件桥由 `ChatServiceImpl.startEventBridge()` 在 agent 装配后启动。

渲染用 vendored ai-elements（`src/components/ai-elements/`）：Conversation/Message/PromptInput/Task 等；Markdown 走 streamdown（MessageResponse 内置）；工具 part 映射为聊天内的 `Task` 折叠摘要。

## 5. 登录与凭证流

1. 渲染层点「使用浏览器登录」→ 主进程开系统浏览器 `https://hub.<ep>/signin-app?protocol=<scheme>`
2. 网页登录后回跳 deep-link `<scheme>://signin?authID=...`（macOS `open-url` 监听**必须在模块顶层注册**，等 whenReady 会丢冷启动回调）
3. 主进程 `POST https://api.<ep>/v1/auth/auth_id` 换 `oomol-token` 会话 cookie（**仅内存**）
4. 用该 token 取 `GET /v1/users/default-api-key`（唯一落盘凭证，等价旧 `OO_API_KEY`）+ `/v1/users/profile`
5. 账号写 `userData/auth.json`（0600、tmp+rename 原子写）→ `applyAuthAccount` 拉起 agent

`applyAuthAccount`（main.ts）经 `applyChain` promise 串行化 + 同凭证幂等短路（冷启动 deep-link 与 whenReady 双路径会重复 apply）；agent 启动失败回滚不留僵尸引用。非本应用发起的登录回调（无 pending）须弹系统对话框确认（防 login-CSRF）；pending 有 10 分钟超时。纯函数部分在 `electron/auth/browser-login.ts`（带单测）。

渲染层 `src/App.tsx`：AuthGate——状态未知渲染空背景 → 未登录 `LoginRoute` → 已登录 `<AppShell key={account.id}/>`（换号整树重挂载）。

## 6. Connections 面板流

`electron/connections/node.ts` 直调 connector HTTP（与 agent 解耦），鉴权 `Authorization: Bearer <apiKey>`；`credentialEpoch` 计数器防登出后的迟到广播。`connect()` 支持 5 种 authType：`oauth2`（取 authorizationUrl 开系统浏览器，返回 `"opened"`，前端 `useConnections` 以 2s 间隔/5min 超时轮询 summary 直到出现连接）/ `api_key` / `custom_credential` / `federated` / `no_auth`。`summary.ts` 纯函数 merge `/v1/apps`（已连接）+ `/v1/providers`（目录）→ `ConnectionSummary`。聊天内 `authorizationRequired` 事件 → 渲染"去授权"按钮 → 打开右侧面板定位 provider。

## 7. 模块地图

```
electron/
  main.ts preload.ts          组装根 / RPC 桥
  branding.ts domain.ts       R1 品牌单一来源 / R2 endpoint 派生（唯一域名来源）
  protocol.ts                 deep-link 注册/单实例锁/URL 监听
  service-events.ts           进程内 ServiceEvent<T>（非 RPC）
  agent/                      见 §2
  auth/    common,node,store,browser-login(+test)   登录与凭证（见 §5）
  chat/    common,node        聊天契约 + SSE 事件桥
  connections/ common,node,summary(+test)           连接器面板（见 §6）
  session/ common,node        会话 CRUD（代理 AgentManager，sessionsChanged 广播）
  settings/ common,node,store(+test)                themeSource + updateChannel；原子写；不存凭证（R8）
  update/  common,node,channel(+test)               UpdateService：检查/下载/安装/渠道切换 + appUpdateStateChanged；
                              generic feed = static.<ep>/release/apps/lumo/<plat>/<arch>；仅打包态；autoDownload=false
                              （设置页 UI 显式触发）；渠道经 setFeedURL channel 字段（勿用 channel setter——
                              会静默置 allowDowngrade）+ 显式 allowDowngrade=false；404 容忍限次重试；
                              ESM 下须 updaterPkg.autoUpdater 静态 default import
src/
  main.tsx App.tsx            入口 / AuthGate
  components/app-shell/       AppShell 三栏 + 内部 Route state（"chat"|"settings"）
  components/ai-elements/     vendored 裁剪版（conversation loader message message-image prompt-input shimmer task）
  components/ui/              shadcn 基件（button badge input textarea dialog collapsible input-group split-view）
  routes/  Chat/ Connections/ Login/ Settings/
  hooks/   useChat useSessions useConnections useAuth useAppUpdate
  i18n/    自研轻量 i18n（zh-CN 基准 + en，localStorage key lumo.locale）
  index.css                   Tailwind v4 单文件主题（CSS variables；含 @source streamdown）
```
