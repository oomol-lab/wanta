# 编码约定与安全基线

> 仓库根指南列的是铁律；本文是完整版。相关：[architecture.md](architecture.md) · [development.md](development.md)

## 1. 设计编号体系（注释中反复出现，沿自原始计划）

- **R1** 品牌单一来源：`electron/branding.ts`。`electron-builder.ts` 必须从该模块派生 appId / productName / protocol。`OO_` env 前缀、`x-oomol-*` 头是外部协议契约，不随品牌改。
- **R2** endpoint 单一来源：`electron/domain.ts` 派生一切域名，禁止散落硬编码（现为构建期常量，动态切换已移除）。
- **R3** oo 只经环境变量控制：`electron/agent/oo.ts` 的 `buildOoEnv` 是全集。
- **R4** 动态系统提示：稳定人格放 agent.prompt（prompt 缓存友好），每轮已授权 Link provider 存在性提示（来源 `/v1/apps`）经 `body.system` 注入末尾（实测追加非覆盖）；默认不列具体 provider 名，避免可用性上下文变成工具诱导。
- **R5** 发现/调用/授权信号全走结构化工具结果，不解析模型自由文本；未授权判定靠 stderr `errorCode: <code>` token（locale 无关锚点；zh 文案用全角括号，正则需排除 `)）`）。
- **R6** 系统提示契约：蓝本来自 oo-cli 内置 oo skill，剔除 CLI 特定条款。
- **R7 在代码中重载，grep 时注意区分**：原计划义 = **IPC 流式**（ClientInvokes 发起 + ServerEvents 推送，见 `electron/chat/common.ts` 注释与 [architecture.md §3](architecture.md)）；而 `electron/agent/system-prompt.ts` 头注释里的 "R7" 是**提示词修订号**（放开本地编码的那一版），与 IPC 无关。
- **R8** 安全：不持久化明文会话 token；settings.json 不存凭证（与 auth.json 分离）；密钥只走 env / CI secrets。
- 注释中的"阶段 0..6"对应最初 7 个 commit（见 [project-overview.md §4](project-overview.md)）。

## 2. 主进程 fs 纪律

- **禁止在 Electron 主进程使用同步 fs API**（`existsSync` / `readFileSync` 等会阻塞主进程进而拖慢渲染）。
  - dev 期存在性检查 → predev 守卫 `scripts/check-oo.ts`（独立 Node CLI，sync fs 无妨）。
  - 打包产物一定内置二进制，运行时无需任何存在性检查。
  - 运行时文件操作用 `node:fs/promises`（如 `electron/agent/workspace.ts`）。
  - 既存例外（小量、一次性，勿扩散）：`electron/auth/store.ts` 与 `electron/settings/store.ts` 的小型 JSON 读写。

## 3. 文件与模块布局

- 每个 service 域同目录共置：`common.ts`（契约 + 纯类型，main/renderer 共享 import）/ `node.ts`(主进程实现) / `store.ts`（持久化）/ `*.test.ts`。
- 可单测的逻辑拆成纯函数文件：`auth/browser-login.ts`、`connections/summary.ts`、`agent/event-translator.ts`、`auth/store.ts` 皆是此模式。新逻辑优先照此拆分。
- `electron/agent/` 保持 **electron-free**（不 import electron），保证 headless smoke 可直接构造 `AgentManager`。
- 相对导入带显式 `.ts` 扩展名（tsconfig `allowImportingTsExtensions`；`node --experimental-strip-types` 直跑 scripts 时也需要）。
- `node --experimental-strip-types` 不支持 TS 参数属性：类一律显式字段 + 构造函数赋值，不写 `constructor(private x)`。
- 渲染层路径别名 `@/` → `src/`（vite + tsconfig paths；components.json 同步）。

## 4. 语言与日志

- 注释：中文。代码标识符 / 系统提示词 / 日志文本：英文。
- 所有 Git 操作中的人类可读文本必须用英文，包括但不限于 commit message、branch name、PR title、PR description、PR review/comment、tag/release note；不要为 Codex/agent 提交使用中文 Git 文案。
- 文档（docs/ 与根指南）：按主题组织，**不写 commit hash、不逐 commit 追加记录**（git log 才是历史的权威来源）；不硬编码根指南的文件名（它以两个互为 symlink 的名字存在）。
- 主进程业务日志统一 `console.*("[wanta] ...")` 前缀。既存例外（历史遗留，新代码勿仿）：`electron/protocol.ts` 用 `[protocol]` 前缀、`electron/preload.ts` 的 contextBridge 兜底 `console.error(error)` 无前缀。
- **deep-link 日志必须脱敏**（query 含可兑换凭证的 authID）：只记 scheme/host/path（见 `main.ts` 的 `redactDeepLink`）。

## 5. 安全基线（新代码不得弱化）

- 凭证永不进渲染进程：全应用唯一凭证是会话 token `oomol-token`；持有它的 `AuthManager`（`currentSessionToken`/`activeRuntimeAccount`）不注册为 RPC service（`@oomol/connection` 注册即全公开、无方法白名单）；只注册契约门面。**不再获取或落盘长期 api-key**——网关层统一接受 cookie/token/api-key，全程用会话 token。
- `auth.json`：0600 权限、tmp+rename 原子写；**只存账号 profile、不存任何凭证**。会话 token 只活在 Electron 会话 cookie 与运行态内存；启动 `AuthStore.purgeLegacy()` 抹除旧版残留的落盘 api-key。
- 非本应用发起的 signin deep link 须系统对话框确认（防 login-CSRF），勿绕过。
- sidecar HTTP server 带随机口令 Basic Auth（`OPENCODE_SERVER_PASSWORD`）。
- 外开 URL 协议白名单 `{http, https, mailto, tel}`，集中在 `main.ts` 的 `openExternalUrl`；`setWindowOpenHandler` 与 `will-navigate` 必须共用该 helper。新增协议要同时考虑两条路径。审查误报留档（已证伪，勿再报）："dev host 非 localhost 时 will-navigate 误拦渲染页"——窗口加载的就是同一 `viteDevServerUrl` 字符串（前缀自匹配恒成立），且 vite-plugin-electron 的 `resolveServerUrl` 把 `0.0.0.0`/`::` 都映射成 localhost。
- Markdown 渲染不引入 raw HTML（streamdown/原 react-markdown 均保持 HTML 转义防 XSS）；收紧链接协议应在渲染层做，而非只在 Electron 侧 deny（否则出现"可点击但无反应"）。
- OpenCode 配置经 `OPENCODE_CONFIG_CONTENT` 内联注入，凭证（会话 token）只入内存 env 不落盘；provider 的 `options.apiKey` 与 oo 的 `OO_API_KEY` 字段名保留（外部契约），值为会话 token。

## 6. 错误处理

- service 方法在 agent 缺失时：读类返回空集合/false，写类 throw（如 "Agent not configured (sign in first)"）。
- 后台广播失败静默：`.catch(() => undefined)`。
- agent 启动失败必须回滚引用，不留僵尸状态（见 `main.ts` 的 `applyAuthAccountNow`）。
- 凭证/agent 装配一律经 `applyAuthAccount` 串行链，不要旁路（曾有双路径竞态）。

## 7. Agent / 工具相关

- **能力三处同步**：`config.ts` 的 tools 配置（现状：无禁用表，内置工具全启用）、permission（agent 级 + 根级）、`system-prompt.ts` 提示词。改任何能力策略三处必须一起改。
- **permission 的 `"ask"` 必须有 UI 验证**：`permission.asked` / `permission.v2.asked`
  先经 ChatService 主进程本地访问策略处理；默认访问可自动批准纯 `oo` CLI、已信任项目内文件/目录、项目内只读检查命令、本会话 grant；项目测试 / lint / typecheck / build 等开发命令默认不自动批准，但用户允许"项目开发命令"后可作为本会话 grant 继续自动批准；剩余 ask 才进入两档访问 UI；完全访问 = 会话级本地 YOLO，确认后由主进程自动 reply 本会话本地 permission，不再逐次做本地风险判断。
  新增 ask 规则要验证 pending permission 查询、事件推送、自动审批去重与 reply。
- **oo CLI 单命令例外**：仅当首 token 是 `oo` / `$WANTA_OO_BIN` / `${WANTA_OO_BIN}` 时才放行；
  ChatService 还会用纯命令判定兜底自动 reply。不要放行 shell 串联、重定向、命令替换或 `sudo oo`。
- **permission 只闸内置工具**：`bash: deny` 等不约束 `.opencode` 自定义工具（权限闸写在各内置工具 execute 内）——重新收紧权限时，连接器元工具照常 spawn oo，不受影响。
- 内嵌工具源码（`tool-sources.ts`，String.raw）**不得含反引号与 `${}`**（破坏模板字符串）；这些代码跑在 OpenCode 的 Bun，不参与本项目 tsc/oxlint。工具描述本身也是提示词的一部分，保持 list/search/inspect/call 的职责边界与交叉引用。
- sidecar cwd = `userData/agent/workspace`，不可改（`.opencode/tools/` 在其下）；文件访问越界走 `external_directory: "ask"`，由 ChatService 本地访问策略处理。
- `parseConnectorErrorCode`（`oo.ts`）与 `call_action` 内联正则必须保持一致，改一处要同步另一处。`AUTH_BLOCKING_ERROR_CODES`（`connection_required` 等）来自 connector 上游而非 oo-cli，**权威定义**是 connector OpenAPI 错误 schema（`https://connector.<endpoint>/openapi.json`，需 `Authorization: Bearer <会话 token>`）——增删该集合先核对此处。
- 新增需要 endpoint 的代码：从 `domain.ts` import 派生常量；不要新增 `__OO_ENDPOINT__` 引用点（define 覆盖范围需与 vite/vitest 配置同步；当前三处 define：renderer/main/preload）。

## 8. 渲染层 / UI

- 无路由库：页面切换是 `AppShell.tsx` 内部 state，新增"页面"先考虑是否真的需要路由库。
- 流式渲染稳定性：文本 part 用稳定 React key（partId），`upsertPart` 原地替换——不重挂载、无闪烁；`messageDelta` 是累计全文非增量。
- streaming 时 Enter 必须只发送、不停止（停止仅响应按钮显式点击；曾是 HIGH 回归）。
- vendored 组件规则：新 vendored 文件放 `src/components/ui/` 或 `src/components/ai-elements/`（享受 `react/only-export-components` override）；`ui/badge.tsx` 是 shadcn 标准 + 项目自有 success/warning/muted 变体的合并版，升级勿直接覆盖；registry 源码自带的 `// @ts-expect-error ... v6` 注释 vendoring 时必须删除（本项目装的就是 ai v6，该指令变"未使用"会卡 ts-check）。
- `src/index.css` 的 `@source "../node_modules/streamdown/dist"` 不可删（Tailwind v4 不扫 node_modules，删了 streamdown 的类不生成）。
- i18n：自研轻量实现（`src/i18n/i18n.ts`），扁平 dot key + `{var}` 占位，zh-CN 基准 + en 镜像，新增文案两个 locale 都要加；`useT()` 取翻译函数。
- ai-elements 是聊天组件库，没有 sidebar/导航/表单/列表项——非聊天界面用 shadcn 原语，勿强行 ai-elements 化。

## 9. 验证纪律（会话记录沉淀）

- 每个改动的 DoD 必须真实运行验证（日志/截图证据），不能臆测；每完成一个阶段先 commit。
- UI/运行态改动光过编译不够：`npm run dev` 实机验证（需登录 + agent sidecar）。
- 改 vite 构建配置必须保持不变式：build 产物默认 oomol.com、不受 `.env.local` 影响、只有显式 `WANTA_ENDPOINT` 能覆盖（验证方法：带 `.env.local=oomol.dev` 跑 build 后 grep 产物）。
