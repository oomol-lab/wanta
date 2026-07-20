# Wanta Repository Guide

> Entry point for AI agents and contributors: what this project is, the commands, the hard
> rules, and where the details live. Details live in [docs/](docs/) — read them on demand;
> do not work from memory.

## What this is

Wanta is OOMOL's open-source Electron desktop AI-agent chat client: users describe what they
want in natural language, and the agent does the work through OOMOL connector cloud services
(~600 SaaS providers, 6000+ actions, credentials hosted in the cloud) and local tools
(bash / files / code). Connector calls go through the bundled `oo` CLI binary (a black-box
subprocess controlled only via environment variables); the agent kernel is a local OpenCode
sidecar (`opencode serve`, driven from the main process via `@opencode-ai/sdk` over HTTP+SSE).
Engineering (build/packaging/CI/IPC layout/UI style) mirrors the sister app oo-desktop
(separate repo, not a fork). See [docs/project-overview.md](docs/project-overview.md).

**Stack**: Electron 42 + Vite 8 + React 19 + Tailwind CSS 4 + vendored ai-elements/shadcn;
agent = pinned `opencode-ai` sidecar; IPC = `@oomol/connection` (public npm);
toolchain = tsgo (type check) / oxlint / oxfmt / vitest.

## Layout

```text
electron/        Main process + preload. One directory per service/feature domain (agent/
                 auth/ chat/ knowledge/ skills/ ... — non-exhaustive; module map in
                 docs/architecture.md §8)
src/             Renderer (React; routes/ hooks/ components/ lib/ i18n/)
scripts/         Build & postinstall scripts (binary/skill downloads, tool-runtime build,
                 predev guard, release helpers)
resources/       Packaging resources; bin/ skills/ agent-tool-runtime/ are gitignored
                 staging dirs produced by scripts
.wanta-dev/      Manual smoke scripts (gitignored; outside lint/tsc/packaging)
.oo-bin/         oo + ripgrep binaries fetched by postinstall (gitignored)
.electron-dist/  Dev-only Electron copy with the wanta-local scheme (gitignored)
.github/workflows/  pr.yml (quality gates) + release.yml (sign/notarize/publish)
docs/            This repo's documentation (index below)
```

## Commands (exact script names — see package.json)

```bash
npm install          # all deps are public npm, no token/.npmrc needed. postinstall fetches
                     # the dev Electron copy (.electron-dist) and oo + ripgrep (.oo-bin),
                     # exports bundled skills via the oo binary (resources/skills), and
                     # builds the agent tool runtime (resources/agent-tool-runtime)
npm run dev          # Vite dev (port 5273) + main process; predev guard checks .oo-bin
npm run build        # = build:app = ts-check + vite build
npm run ts-check     # tsgo -p tsconfig.json --incremental false
npm run lint         # oxlint .        (fix: npm run lint:fix)
npm run format       # oxfmt --check . (fix: npm run format:fix)
npm test             # vitest run
npm run build:mac    # build:app + prepare:binaries + electron-builder
                     # also: build:win / build:linux / build:electron / prepare:binaries
```

Every change must go green on all four gates: `ts-check` + `lint` + `format` + `test`.
UI/runtime changes additionally need a live `npm run dev` verification
([docs/conventions.md](docs/conventions.md) §9). Environment and packaging details:
[docs/development.md](docs/development.md).

## Collaboration

All code changes are made on a throwaway branch cut from latest `main` — never commit to
`main` directly. Push, open a PR into `main`, and delete the branch (local + remote) after
merge. All human-readable Git text (commits, branches, PR titles/descriptions/comments,
tags/release notes) is English. Details: [docs/development.md](docs/development.md) §3.

## Hard rules (each one prevents a real incident; sources cited)

> R1–R8 are rule numbers from the original project plan, defined in
> [docs/conventions.md](docs/conventions.md) §1.

<<<<<<< HEAD
1. **主进程禁止同步 fs API**（`existsSync` 等会阻塞渲染进程）。
   dev 期存在性检查放 predev 守卫 `scripts/check-oo.ts`（独立 CLI 脚本可用 sync fs）；
   打包产物一定内置二进制，运行时无需检查。既存例外清单见
   [docs/conventions.md](docs/conventions.md) §2——不要新增例外。
2. **禁止硬编码域名**。endpoint 是构建期常量 `__OO_ENDPOINT__`（vite/vitest define 注入），
   一切 base URL 从 `electron/domain.ts` 派生；build 模式刻意不读 `.env` 文件，
   发布产物必须 grep 不到 `oomol.dev`。
3. **品牌标识只改一处**：`electron/branding.ts`（R1）。但 `OO_` 环境变量前缀、
   `x-oomol-*` 头是外部协议契约，不随品牌改。
4. **OOMOL 凭证永不进渲染进程**。`@oomol/connection` 注册即全公开（无方法白名单），
   持有会话 token 的 `AuthManager`（`currentSessionToken` / `activeRuntimeAccount`）刻意不注册为
   RPC service，只注册薄门面 `AuthServiceImpl`。auth.json 0600 + 原子写、**只存 profile 不存凭证**；
   deep-link 日志必须脱敏（query 含 authID）。custom model Key 仅允许用户在 Renderer 表单中新输入时经
   `saveCustomModel` 单向提交，任何读取/事件只能返回 `apiKeyConfigured`；主进程使用 Electron
   `safeStorage` 独立保存，`models.json` 禁止出现 Key，Linux 弱存储后端禁止明文降级。
5. **版本钉死，禁止浮动**：`opencode-ai` / `@opencode-ai/sdk` / `@opencode-ai/plugin`
   三包同为 `1.17.13`（上游无 API 稳定承诺）；oo CLI 版本由 `scripts/oo-cli.ts` 的
   `OO_CLI_VERSION = "1.5.1"` 单一锁定。
6. **OpenCode permission 的 `"ask"` 必须接 Wanta 两档权限 UI**。当前已处理
   `permission.asked` / `permission.v2.asked` 与 reply；高风险本地能力走 ask。
   默认权限逐次批准/拒绝当前本地 ask，完全访问确认后自动 reply；新增 ask 类权限时必须验证该闭环
   （见 [docs/key-decisions.md](docs/key-decisions.md) §9）。
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
11. **Univer 表格预览是明确业务需求，禁止删除、降级或替换。**
    `ArtifactUniverSpreadsheetPreview.tsx`、`artifact-univer-snapshot.ts` 及
    `@univerjs/core` / `@univerjs/preset-sheets-core` / `rxjs` 是有意保留的产品能力；
    不得以只读、bundle size、原生 table 可替代等理由移除。任何替换或删除必须先取得产品方明确同意；
    性能优化必须保留 Univer 的完整工作簿渲染和交互。
=======
1. **No synchronous fs APIs in the Electron main process** (`existsSync` etc. block the
   renderer). Dev-time existence checks belong in the predev guard `scripts/check-oo.ts`
   (standalone CLI scripts may use sync fs). Existing exceptions are listed in
   [docs/conventions.md](docs/conventions.md) §2 — do not add new ones.
2. **No hardcoded domains.** The endpoint is the build-time constant `__OO_ENDPOINT__`
   (injected by vite/vitest define); every base URL derives from `electron/domain.ts`.
   Build mode deliberately ignores `.env` files; release artifacts must not grep `oomol.dev`.
3. **Branding changes in one place only**: `electron/branding.ts` (R1). The `OO_` env-var
   prefix and `x-oomol-*` headers are external protocol contracts — they never follow branding.
4. **Credentials never enter the renderer.** `@oomol/connection` exposes every public method
   of a registered service (no allowlist), so the token-holding `AuthManager`
   (`currentSessionToken` / `activeRuntimeAccount`) is deliberately NOT registered — only the
   thin `AuthServiceImpl` facade is. `auth.json` is 0600 + atomic writes and stores
   **profile only, never credentials**; deep-link logs must be redacted (query carries authID).
5. **Versions are pinned, never floating**: `opencode-ai` / `@opencode-ai/sdk` /
   `@opencode-ai/plugin` share one exact version (upstream has no API-stability promise);
   the oo CLI version is locked solely by `OO_CLI_VERSION` in `scripts/oo-cli.ts`.
6. **OpenCode `"ask"` permissions must round-trip Wanta's two-tier access UI.**
   `permission.asked` / `permission.v2.asked` + reply are handled today; high-risk local
   actions go through ask. Verify the full loop whenever adding an ask-class permission
   ([docs/key-decisions.md](docs/key-decisions.md) §9).
7. **Agent capability is decided in three places that move together**: the tools config
   (currently no deny table — all built-in tools enabled) and permissions (agent-level +
   root-level) in `electron/agent/config.ts`, plus the `electron/agent/system-prompt.ts`
   prompt. Changing one without the others makes the model refuse itself or contradict the UI.
8. **Spawning oo requires the full `OO_*` env set** (`electron/agent/oo.ts`, R3) — especially
   `OO_SKILLS_SYNC_DISABLED=1`, otherwise oo writes into the user's home directory
   (`~/.claude` etc.) on every run.
9. **Relative imports carry explicit `.ts` extensions**; scripts run under
   `node --experimental-strip-types`, so TS parameter properties
   (`constructor(private x)`) are not allowed.
10. **English everywhere**: code comments, identifiers, logs, system prompts, docs, and all
    human-readable Git text. Legacy Chinese comments are being migrated separately — write
    new/edited comments in English, and do not mass-translate unrelated comments in feature
    PRs. Main-process logs use the `[wanta]` prefix.
11. **The Univer spreadsheet preview is an explicit product requirement — never remove,
    downgrade, or replace it.** `ArtifactUniverSpreadsheetPreview.tsx`,
    `artifact-univer-snapshot.ts`, and `@univerjs/core` / `@univerjs/preset-sheets-core` /
    `rxjs` are deliberately kept. Do not remove them on read-only/bundle-size/"a native
    table would do" grounds; any replacement or removal needs explicit product-owner
    approval, and performance work must preserve full Univer workbook rendering and
    interaction.
>>>>>>> origin/main

Full coding conventions (naming, pure-function extraction, embedded tool-source limits,
vendored-UI rules, ...) live in [docs/conventions.md](docs/conventions.md).

## Docs index

| Doc                                                                | Read it when                                                                                                                            |
| ------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------- |
| [docs/project-overview.md](docs/project-overview.md)               | You want to know what Wanta is, who it serves, and how it relates to OOMOL cloud / oo CLI / oo-desktop; original plan vs shipped        |
| [docs/architecture.md](docs/architecture.md)                       | Before touching any main/renderer code: process split, agent kernel, IPC patterns, chat streaming, auth & connections flows, module map |
| [docs/key-decisions.md](docs/key-decisions.md)                     | You want to know "why is it like this": 11 major decisions as context → decision → rationale → consequences (incl. rejected paths)      |
| [docs/development.md](docs/development.md)                         | Environment setup, .env, dev loop, tests, lint/format, packaging/signing/release, CI, roles of the special directories                  |
| [docs/conventions.md](docs/conventions.md)                         | Before writing code: naming/layout/security/error-handling/UI & i18n conventions, the R1–R8 numbering, verification discipline          |
| [docs/network-request-caching.md](docs/network-request-caching.md) | Before changing renderer read paths: cache boundaries, TTLs, in-flight merging, targeted invalidation after mutations                   |
| [docs/skill-catalog-caching.md](docs/skill-catalog-caching.md)     | Before touching Skill catalog/registry reads: catalog cache keys, TTLs, and generation-based invalidation                               |

Working documents — point-in-time plans, analyses, and ledgers; on conflict, the code and the
reference docs above win: [docs/open-source-plan.md](docs/open-source-plan.md),
[docs/team-skills-plan.md](docs/team-skills-plan.md),
[docs/bug-report-command-optimization.md](docs/bug-report-command-optimization.md),
[docs/quality-improvement-plan.md](docs/quality-improvement-plan.md),
[docs/quality/](docs/quality/) (baseline, findings ledger, runbooks).

## Quick facts

- Entry points: main `electron/main.ts`, preload `electron/preload.ts`, renderer
  `src/main.tsx`. No routing library — `src/components/app-shell/AppShell.tsx` switches an
  internal route state (8 pages; type in `src/components/app-shell/app-shell-types.ts`).
- LLM: OOMOL gateway `llm.<endpoint>/v1`; built-in model list in `electron/models/builtin.ts`
  (default is Auto = `oomol/oopilot`; GPT 5.5 is `openai/gpt-5.5`; plus DeepSeek/Qwen options),
  and users can add custom OpenAI-compatible providers. Wanta overrides OpenCode's native
  `build` / `plan` agents with same-named agents carrying Wanta prompts and permissions
  (default Build; plan may only edit `.opencode/plans/*.md`). The gateway's `/v1/models`
  does **not** list `oopilot` (gateway-side alias) — never "correct" the Auto model id
  based on that listing.
- Sign-in: browser login + deep-link (production `wanta://signin`, dev `wanta-local://signin`).
  **The app's only OOMOL credential is the session token `oomol-token`** (Electron session
  cookie, short-lived; the gateway accepts cookie/token/api-key alike, so chat, connectors,
  teams, skills, and billing all use it). `userData/auth.json` stores the account profile
  only — **no credentials** — and no long-lived api-key is ever fetched. A dead token means
  signed-out everywhere (`AuthManager.currentState` gates it).
- Connector tools: `list_apps` lists connected apps of the current workspace;
  `search_actions` → `inspect_action` → `call_action` for discovery/invocation; plus
  `query_knowledge` for knowledge bases. Sources are embedded in
  `electron/agent/tool-sources.ts` and run in OpenCode's Bun — outside this repo's lint/tsc.
- IPC: each service domain = `common.ts` contract + `node.ts` implementation; ServiceName
  looks like `wanta/chat-service`; `registerService()` must precede `server.start()`.
- Tests are vitest unit tests colocated as `*.test.ts` across `electron/` `src/` `scripts/`.
  Real-run verification uses the manual smoke scripts in `.wanta-dev/` (gitignored; absent in
  fresh clones — how to run/rebuild them: [docs/development.md](docs/development.md) §4).
- This guide exists at the repo root under two filenames (one file, symlinked). Do not create
  another copy or a second root guide.
