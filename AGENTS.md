# Wanta 仓库工作指南

> 本文件是 AI agent 的入口：项目一段话、命令、铁律、文档索引。
> 细节全部在 [docs/](docs/) 里，按需读取，不要凭记忆推断。

## 项目是什么

Wanta 是 OOMOL 出品的 Electron 桌面 AI Agent 聊天客户端：用户用自然语言提需求，
Agent 通过 OOMOL connector 云服务（约 600 个 SaaS provider、6000+ action，凭证云端托管）
和本地工具（bash / 文件 / 代码）完成分析与自动化任务。连接器调用经内置的 `oo` CLI
二进制（黑盒子进程，仅环境变量控制）；Agent 内核是本地 OpenCode sidecar
（spawn `opencode serve`，主进程经 `@opencode-ai/sdk` HTTP+SSE 驱动）；
工程化（构建/打包/CI/IPC 划分/UI 风格）整体镜像姊妹应用 oo-desktop（独立仓库，非 fork）。
详见 [docs/project-overview.md](docs/project-overview.md)。

**技术栈一行**：Electron 42 + Vite 8 + React 19 + Tailwind CSS 4 + vendored ai-elements/shadcn；
Agent = `opencode-ai@1.17.8` sidecar；IPC = 私有包 `@oomol/connection`；
工具链 = tsgo（类型检查）/ oxlint / oxfmt / vitest。

## 仓库布局

```
electron/        主进程 + preload（agent/ auth/ chat/ connections/ session/ settings/ update/）
src/             渲染进程（React；routes/ hooks/ components/ i18n/）
scripts/         构建与 postinstall 脚本（oo 下载、二进制准备、predev 守卫）
resources/       打包资源；resources/bin 是二进制中转目录（gitignore）
.wanta-dev/       手工 smoke 脚本（gitignore，不进 lint/tsc/打包）
.oo-bin/         postinstall 下载的 oo 二进制（gitignore）
.electron-dist/  dev 专用 Electron 副本，带 wanta-local scheme（gitignore）
.github/workflows/  pr.yml（质量门）+ release.yml（签名/公证/发布）
docs/            本仓库文档（见下方索引）
```

## 常用命令（精确脚本名，见 package.json）

```bash
npm install          # 需 @oomol 私有包 PAT（docs/development.md §1）；postinstall 自动下载 .electron-dist 与 .oo-bin/oo
npm run dev          # Vite dev（端口 5273）+ 主进程；predev 守卫检查 .oo-bin/oo
npm run build        # = build:app = ts-check + vite build
npm run ts-check     # tsgo -p tsconfig.json
npm run lint         # oxlint .（修复：npm run lint:fix）
npm run format       # oxfmt --check .（修复：npm run format:fix）
npm test             # vitest run
npm run build:mac    # build:app + prepare:binaries + electron-builder
                     # 另有 build:win / build:linux / build:electron / prepare:binaries
```

改动后必须全绿：`ts-check` + `lint` + `format` + `test`。UI/运行态改动另需
`npm run dev` 实机验证（见 [docs/conventions.md](docs/conventions.md) §9）。环境与打包细节见
[docs/development.md](docs/development.md)。

## 协作流程

所有代码改动都从最新 `main` 拉出一次性临时分支完成，不直接在 `main` 上提交；推送后开 PR
合入 `main`，PR 合并后再删除对应的本地和远端临时分支。细节见
[docs/development.md](docs/development.md) §3。

## 铁律（违反会出真实事故，均有出处）

> 条目中的 R1–R8 是原始计划的规则编号，定义见 [docs/conventions.md](docs/conventions.md) §1。

1. **主进程禁止同步 fs API**（`existsSync` 等会阻塞渲染进程）。
   dev 期存在性检查放 predev 守卫 `scripts/check-oo.ts`（独立 CLI 脚本可用 sync fs）；
   打包产物一定内置二进制，运行时无需检查。既存例外清单见
   [docs/conventions.md](docs/conventions.md) §2——不要新增例外。
2. **禁止硬编码域名**。endpoint 是构建期常量 `__OO_ENDPOINT__`（vite/vitest define 注入），
   一切 base URL 从 `electron/domain.ts` 派生；build 模式刻意不读 `.env` 文件，
   发布产物必须 grep 不到 `oomol.dev`。
3. **品牌标识只改一处**：`electron/branding.ts`（R1）。但 `OO_` 环境变量前缀、
   `x-oomol-*` 头是外部协议契约，不随品牌改。
4. **凭证永不进渲染进程**。`@oomol/connection` 注册即全公开（无方法白名单），
   持有会话 token 的 `AuthManager`（`currentSessionToken` / `activeRuntimeAccount`）刻意不注册为
   RPC service，只注册薄门面 `AuthServiceImpl`。auth.json 0600 + 原子写、**只存 profile 不存凭证**；
   deep-link 日志必须脱敏（query 含 authID）。
5. **版本钉死，禁止浮动**：`opencode-ai` / `@opencode-ai/sdk` / `@opencode-ai/plugin`
   三包同为 `1.17.8`（上游无 API 稳定承诺）；oo CLI 版本由 `scripts/oo-cli.ts` 的
   `OO_CLI_VERSION = "1.2.3"` 单一锁定。
6. **OpenCode permission 永远不要设 `"ask"`**——本应用未接 `permission.updated`
   确认 UI，会话会静默挂死。只能 allow / deny
   （现状全 allow，见 [docs/key-decisions.md](docs/key-decisions.md) §9）。
7. **Agent 能力由三处共同决定**：`electron/agent/config.ts` 的 tools 配置
   （现状：无禁用表，内置工具全启用）与 permission（agent 级 + 根级）、
   `electron/agent/system-prompt.ts` 提示词。改能力策略时三处必须同步，
   否则模型自我拒绝或行为矛盾。
8. **spawn oo 必须注入全套 `OO_*` 环境变量**（`electron/agent/oo.ts`，R3）——
   尤其 `OO_SKILLS_SYNC_DISABLED=1`，否则 oo 每次运行会写用户家目录（`~/.claude` 等）。
9. **相对导入带显式 `.ts` 扩展名**；scripts 用 `node --experimental-strip-types` 直跑，
   故不能用 TS 参数属性（`constructor(private x)`）。
10. 注释中文；代码标识符/日志/系统提示英文；所有 Git 操作中的人类可读文本必须英文
    （commit message、branch name、PR title/description/comment、tag/release note 等）；
    主进程业务日志统一 `[wanta]` 前缀（既存例外见 [docs/conventions.md](docs/conventions.md) §4）。

完整编码约定（文件命名、纯函数拆分、内嵌工具源码限制、vendored UI 规则等）见
[docs/conventions.md](docs/conventions.md)。

## 文档索引

| 文档                                                 | 何时读                                                                                                     |
| ---------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| [docs/project-overview.md](docs/project-overview.md) | 想知道 Wanta 是什么、为谁做、与 OOMOL 云 / oo CLI / oo-desktop 的关系、原计划 vs 实际交付                  |
| [docs/architecture.md](docs/architecture.md)         | 改任何主/渲染进程代码前：进程划分、Agent 内核、IPC 模式、聊天流式数据流、登录与连接面板流程、模块地图      |
| [docs/key-decisions.md](docs/key-decisions.md)       | 想知道"为什么是现在这样"：9 个重大决策的背景 → 决策 → 理由 → 后果（含被否方案；个别条目理由并入背景/决策） |
| [docs/development.md](docs/development.md)           | 搭环境、.env、跑 dev、测试、lint/format、打包签名发布、CI、各特殊目录的角色                                |
| [docs/conventions.md](docs/conventions.md)           | 写代码前：命名/布局/安全/错误处理/UI 与 i18n 约定、R1–R8 编号体系、验证纪律                                |

## 快速事实

- 入口：主进程 `electron/main.ts`，preload `electron/preload.ts`，渲染 `src/main.tsx`；
  无路由库，`src/components/app-shell/AppShell.tsx` 内部 state 切换 `"chat" | "settings"`。
- LLM：OOMOL LLM 网关 `llm.<endpoint>/v1`，内置模型清单见 `electron/models/builtin.ts`；
  默认模型是 `openai/gpt-5.5`，Auto 选项是 `oomol/oopilot`，agent 名 `wanta`
  （`electron/agent/config.ts`）。网关 `/v1/models` **不会列出** `oopilot`
  （网关侧别名），勿据此"纠正"Auto 模型名。
- 登录：浏览器登录 + deep-link（生产 `wanta://signin`，dev `wanta-local://signin`）。
  **全应用唯一凭证是会话 token `oomol-token`**（Electron 会话 cookie，短命会过期；网关层统一接受
  cookie/token/api-key，故聊天/连接器/组织/技能/账单一律用它）；`userData/auth.json` 只存账号 profile
  **不存任何凭证**，也不再获取长期 api-key。token 失效即全局判为未登录（`AuthManager.currentState` 门控）。
- 连接器三工具：`search_actions` → `inspect_action` → `call_action`
  （源码内嵌在 `electron/agent/tool-sources.ts`，运行于 OpenCode 的 Bun，
  不参与本项目 lint/tsc）。
- IPC：每个服务域 = `common.ts` 契约 + `node.ts` 实现，ServiceName 形如 `wanta/chat-service`；
  `registerService()` 必须在 `server.start()` 之前。
- 测试均为纯函数单测（vitest，include `electron/**` `src/**` `scripts/**` 的 `*.test.ts`）；
  真实运行验证用 `.wanta-dev/` 的手工 smoke 脚本（gitignore，fresh clone 无；
  跑法与缺失时如何重建见 [docs/development.md](docs/development.md) §4）。
- 本指南在仓库根以两个文件名存在（互为 symlink 的同一文件），不要另建副本或第二份根指南。
