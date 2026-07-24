# Architecture: process split, agent kernel, IPC, data flow

> Related: [project-overview.md](project-overview.md) (what it is) · [key-decisions.md](key-decisions.md) (why) · [conventions.md](conventions.md) (how to write code)

## 1. Three-process split

- **Main process** `electron/main.ts`: the assembly root. It creates
  `ConnectionServer(new ElectronServerAdapter())`; constructs the disk-backed stores under
  `app.getPath("userData")` — `SettingsStore` / `AuthStore` / `KnowledgeStore` / `AttentionStore`
  (`settings.json` / `auth.json` / `knowledge-bases/` / `attention.json`), plus the private
  `LinkRuntimeManager` (`link-runtime.json`) and `ModelsStore`
  (`models.json`, which backs the `models` service, feeds `AgentManager` custom models, and
  restarts the agent on change — exactly parallel to the four named stores) and the
  session/chat store family (`SessionActivityStore`, `SessionMetadataStore`, `SessionProjectStore`,
  `ArtifactBundleStore`, `AuthorizationOverlayStore`, `StoppedGenerationStore`, `TurnOutputStore`,
  `UserAttachmentStore`); then instantiates and registers the **eleven services** (`chat` / `attention`
  / `session` / `skill` / `models` / `settings` / `auth` / `update` / `git` / `knowledge` /
  `link-runtime`) with
  `server.registerService(...)` (**must run before `server.start()`**). `attention` records unread
  tasks only on a clean completion after the turn output has settled, persists them asynchronously,
  and drives system notifications plus the app-icon badge (macOS / a supporting Linux launcher
  shows a count, Windows shows a red-dot taskbar overlay); user-stop and error paths never
  masquerade as completion. The notification self-test waits on Electron's native `show` / `failed`
  events (with a timeout) and interprets `show` only as "the system accepted the request"; macOS
  then short-polls `Notification.getHistory()` and reports "delivered to Notification Center" only
  when it finds this run's unique ID, so scheduler success is never passed off as "the user saw the
  banner". The test path reserves a longer wait for the macOS first-time authorization prompt while
  background tasks still converge quickly; submission, history confirmation, and task-notification
  condition decisions are all written to the diagnostics log. The settings page describes the system
  capability as "testable" rather than "authorized": macOS uses "enable and test" to trigger the
  first authorization, Windows tests directly, and only after a failure or an unclear result is the
  system-settings deep link promoted to a recovery entry. The macOS settings entry builds an
  app-ID-scoped deep link to the notification settings from `branding.appId` / `branding.devBundleId`
  and falls back to the general notification page on an explicit open failure; the macOS Electron 42
  dev package carries no valid app signature and is explicitly marked untestable — real verification
  requires the signed packaged app. Windows exposes no public per-app notification-settings URI, so
  it uses the official general page; the main process sets the AppUserModelID from `branding.appId`
  to match the installer identity. In `whenReady` it calls `installOomolCorsShim(session.defaultSession)`
  to permit already-authenticated renderer requests straight to `*.<endpoint>` (see §4). The custom
  `wanta-resource` artifact protocol is wired in two steps: `registerArtifactResourceScheme()` runs
  at module top level before app ready, and `installArtifactResourceProtocol(artifactResourceLeaseStore)`
  runs in `whenReady`; ChatService then hands the renderer leased `wanta-resource` URLs to stream
  local artifact files, and the lease store is cleared on shutdown. `applyAuthAccount(account)`
  independently resolves model access and the selected Link runtime, then brings up `AgentManager`
  whenever an OOMOL model or a configured custom model is available (rootDir = `userData/agent`).
  Signing out removes OOMOL model/Link access but does not stop a signed-out custom-model Agent or
  rewrite an explicit OpenConnector selection. The agent lifecycle is
  also owned here: an `AgentRetirementPool` serializes teardown of the old sidecar before a new one
  starts (and drives shutdown reaping across the before-quit / signal / update-install paths,
  memoized so it runs once), and an `AgentRefreshScheduler` restarts the agent runtime when custom
  models or runtime skills change while idle (gated on `canRefresh` / `isBusy` against any active
  generation). Deep-links (dev `wanta-local://` / prod `wanta://`) now serve two flows: `handleDeepLink`
  first checks `parseConnectionOAuthCallback`; a connection OAuth callback is routed to the
  Connections panel via the `openConnections` app command, and only URLs not matching that shape
  fall through to `authManager.completeBrowserLoginCallback`. The single-instance lock is enabled in
  packaged builds only. External links all go through the `openExternalUrl` helper (protocol
  allowlist http/https/mailto/tel → `shell.openExternal`), shared by both the `setWindowOpenHandler`
  and `will-navigate` paths. Renderer media permission runs through the check/request handler and
  only allows audio-only requests from the Wanta main window, a trusted renderer URL, and the main
  frame; camera and other sources are denied by default. **Note**: connector / teams no longer have
  a main-process service — both domains' requests moved wholesale to renderer-direct (see §4, §7);
  the agent's team scope is now driven by the `chatService.setAgentTeam` IPC callback
  (`onSetAgentTeam` → `handleAgentTeamChanged`, updating `activeAgentTeamName` + `agent.setTeamName`).
- **preload** `electron/preload.ts`: paper-thin. `setupConnectionPreload()` (the @oomol/connection
  RPC bridge) + a contextBridge that exposes a **single** bridge, `window.wanta` (name from
  `branding.windowBridge`) — there is no `window.electron` anymore. Beyond `{ appCommit, platform,
version }` (from the vite defines `__APP_COMMIT__` / `__APP_VERSION__`), the `WantaBridge`
  interface also carries `onAppCommand`, `reportRendererError`, `releaseAttachmentPaths`,
  `saveClipboardAttachment`, `selectedAttachmentPathForFile`, `selectAttachmentPaths`,
  `selectProjectDirectory`, and `setAppLocale` (thin ipcRenderer wrappers for the attachment picker,
  locale, and app commands). It **exposes no network/credential surface** — renderer-direct requests
  authenticate automatically via the session cookie and never pass through preload (see §4).
- **Renderer process** `src/main.tsx`: `ConnectionClient(new ElectronClientAdapter())` →
  `client.use()` the eleven service contracts → `AppContext.Provider`. The renderer syncs the currently
  visible session through the attention service, consumes the persisted unread set, and switches back
  to the matching task when a system notification is clicked. The renderer **directly imports** the
  contract types from `electron/*/common.ts` (cross-directory shared types, never copied); since the
  renderer-direct request layer landed it also **directly imports the electron-free runtime modules
  under `electron/`**: `electron/domain.ts` (the domain constants, re-exported via `src/lib/domain.ts`),
  `electron/connections/{summary,usage,executions,federated,domain,summary-model}.ts`,
  `electron/skills/actions.ts`, and so on — these modules are electron-free and get bundled into the
  renderer (billing's pure reshape logic, by contrast, now lives entirely in `src/lib/billing-client.ts`
  and is no longer imported from electron; see §4).

The knowledge base is currently gated by `knowledgeBaseBetaEnabled` in `SettingsStore`; anything
missing or not exactly `true` counts as off. The renderer reads and subscribes to the flag via the
Settings service; when off it hides the knowledge-base navigation, loads no knowledge-base list,
injects no existing knowledge-base references into chat, and bounces any direct navigation to a
knowledge-base route back to chat. The flag is saved to the local `userData/settings.json` and
survives restart. `KnowledgeStore` treats only `ENOENT` as an empty store; a corrupt or unsupported
registry schema fails closed, forbidding any subsequent mutation from overwriting the store from an
empty state. Cover imports are converged to a thumbnail with a longest edge of 320 px and at most
512 KiB encoded; oversized legacy Data URLs never cross IPC. Before each turn is sent, the main
process writes that turn's knowledge-base IDs into the agent-scope session allowlist; `query_knowledge`
is enforced strictly by the OpenCode `sessionID`, task sub-sessions temporarily inherit the parent
allowlist and clear it on exit, and a stale ID from earlier prompt history cannot be used to query a
knowledge base whose pin has been cancelled.

### Link runtime boundary

Model access and Link access are separate runtime axes. `electron/runtime/agent-runtime.ts` resolves
`ModelAccess` (`local` or `oomol`) and the model choice; `electron/link-runtime/node.ts` resolves one
active `LinkRuntime` (`oomol`, `openconnector`, or none). `RuntimeCapabilities.connectors` becomes
true only when an Agent can run and the selected Link runtime is available. An offline saved
OpenConnector remains selected and available; reachability is a separate status value.

`LinkRuntimeManager` is deliberately not registered. The renderer receives only the thin
`LinkRuntimeServiceImpl` facade and redacted state: selected/active runtime, endpoint origins,
availability, status, sanitized app inventory, and `tokenConfigured`. A newly entered runtime token
crosses IPC once, is encrypted in the versioned origin-bound `link-runtime.json` payload with
Electron `safeStorage`, and is decrypted only for same-origin health/inventory calls and sidecar
assembly. Linux weak or unknown storage backends are rejected. Health and inventory requests use
manual redirects and never forward a token across origins.

The Agent workspace mounts the four typed Link tools for either Link backend. OOMOL adds team
identity (`--organization`) and the bundled oo Skills; OpenConnector adds neither. OOMOL direct `oo`
commands keep the existing fast permission path. Under OpenConnector, direct `oo` commands require
approval, while credential expansion, environment dumps, login/logout, and endpoint/store mutation
are rejected even in Full Access. OOMOL Skill registry maintenance remains tied to the OOMOL account
and does not follow the selected Link runtime.

Vite (`vite-plugin-electron/simple` in `vite.config.ts`) bundles `electron/main.ts` and
`electron/preload.ts` into `dist-electron/main.js` + `preload.js`; the main-process build has a
**third** rollup input, `electron/chat/spreadsheet-preview-worker.ts` → `dist-electron/spreadsheet-preview-worker.js`,
loaded at runtime as a `node:worker_threads` Worker by `SpreadsheetPreviewWorkerClient` (deliberately
resolved via `new URL("./spreadsheet-preview-worker.js", import.meta.url)` so Vite does not rewrite
it as a renderer asset). In the main-process build, `@opencode-ai/sdk` and `electron-updater` are
**externalized** (their CJS `require` cannot enter an ESM bundle). The `dependencies` list currently
holds five packages — `@opencode-ai/sdk`, `diff` (9.0.0), `electron-updater`, `react-diff-view`
(3.3.3), `wiki-graph` — but only `@opencode-ai/sdk` and `electron-updater` are externalized. `wiki-graph` is a genuine
runtime dependency, used differently: Wanta launches it separately via an in-project CLI file path
and unpacks its native `sqlite3` module out of the asar. `diff` (imported at `electron/git/turn-diff.ts`)
is **inlined** into the main bundle and `react-diff-view` (a renderer import at
`src/routes/Chat/TurnOutputs.tsx`) is bundled into the renderer — so these two sit in `dependencies`
yet are fully vite-bundled anomalies (candidates to move back to devDependencies). The boundary rule
is therefore an intent, not an invariant that currently holds: apart from the deliberate runtime
dependencies, everything else (including `@oomol/connection`) is bundled by vite and belongs in
devDependencies.

## 2. Agent kernel (electron/agent/, electron-free, headless-testable)

| Module                | Responsibility                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `manager.ts`          | `AgentManager`: orchestrates the sidecar. `promptStreaming()` (`session.promptAsync`, non-blocking; the agent runs OpenCode's native `build` / `plan` — Build by default, Planning passes `agent:"plan"`; a non-`default` `reasoningLevel` supported by the current model is forwarded as OpenCode `body.variant`; model defaults to Auto, i.e. `{providerID:"oomol", modelID:"oopilot"}`, and GPT 5.5 passes `{providerID:"openai", modelID:"gpt-5.5"}`). `body.system` is a runtime-dependent merge of up to five segments (`mergeSystemPrompts`): ① for the OOMOL Link runtime, a mandatory per-turn workspace-identity line (team name + raw `oo` selector — if the team is unresolved `promptStreaming` throws and the turn cannot start); OpenConnector does not add this segment; ② the authorized-Link availability hint (fixed text, **never** lists provider names, so the availability context cannot become tool bait); ③ the caller's context system; ④ the per-turn artifact output contract (`buildArtifactSystem`, incl. the project-publish rules); ⑤ the process intermediate-file contract (`buildProcessSystem`, incl. the `.wanta-python` venv instructions). It also has `sendMessage()` (blocking, for headless use); `subscribe()` (the OpenCode global SSE event loop, with independent reconnect); session CRUD; the interactive-question APIs (`getPendingQuestions` / `getPendingQuestionsForSessions` / `answerQuestion` / `rejectQuestion`); custom-model resolution (`resolveModel` / `resolveReasoningVariant` / `resolveAttachmentCapabilities` handle the custom branch); and `listAuthorizedServices()`, which queries `${connectorBaseUrl}/v1/apps` directly.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| `sidecar.ts`          | `OpencodeSidecar`: spawns `opencode serve --hostname=127.0.0.1 --port=0` and parses the "listening on URL" line from stdout for the address. **Never add `--pure`** (it skips custom plugins, silently disabling the `.opencode/tools` connector tools). Config is injected inline via the `OPENCODE_CONFIG_CONTENT` env var (credential = the session token; the provider `options.apiKey` field name is kept but the value is the token; env only, never persisted to disk); `OPENCODE_CONFIG_DIR` / `XDG_CONFIG_HOME` / `XDG_DATA_HOME` point at `userData/agent/isolation` (isolating the global `~/.config/opencode`; the directory must be pre-created asynchronously before launch or startup 500s); `OPENCODE_DISABLE_EXTERNAL_SKILLS=1` so the sidecar does not scan global roots like `~/.agents` / `~/.claude` directly — external agent skills are scanned by `SkillServiceImpl` and synced into Wanta's private workspace, so a same-named stale copy cannot pre-empt them; `PATH` is merged per-platform by `command-path.ts` (macOS/Linux read the login-shell PATH; Windows reads the freshest Path from the current-user and system registries), keeping Wanta's bundled bin, the inherited Electron PATH, and platform-specific common command dirs on both ends — it imports PATH only, not other shell/registry env vars; a random `OPENCODE_SERVER_PASSWORD` provides Basic Auth. `dispose()` is a two-tier process-tree reap: first `POST /global/dispose` so opencode authoritatively reaps the tool subprocesses it spawned (each `setsid`-escaped, so a single SIGTERM cannot reach them), then an OS process-tree fallback (unix: snapshot the tree with `ps`, then SIGTERM by process group and per-pid, a ~2s grace poll, then SIGKILL; win32: `taskkill /PID /T /F`) — a lone SIGTERM has not been the actual behavior for some time.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| `config.ts`           | `buildOpencodeConfig()`: provider `oomol` (default Auto/`oopilot`, npm `@ai-sdk/openai-compatible`, baseURL=`llmBaseUrl`, also carrying the other OpenAI-compatible built-in models) + provider `openai` (GPT 5.5, OpenAI Responses runtime). Note: the gateway `/v1/models` **does not list** `oopilot` — it is a gateway-side alias routed to the real model by chat/completions, so do not "correct" the Auto model name from the models list. It overrides OpenCode's native `build` / `plan` agents: Build uses `WANTA_SYSTEM_PROMPT`, Plan uses `WANTA_PLAN_SYSTEM_PROMPT`. `external_directory`, `edit`, and any local `bash` other than a direct `oo` / `$WANTA_OO_BIN` / `${WANTA_OO_BIN}` all go through ask first, then the ChatService main-process local-access policy (Default Access / Full Access; Default Access auto-approves ordinary bash, scripts, project checks, data processing, simple output filtering, ordinary file read/write and specific non-sensitive paths, pausing only at basic safety boundaries — credential/secret paths, broad home/system roots, destructive deletes, global/system or alternate-source dependency changes, privilege escalation, pushes, publish/deploy, and infrastructure changes. Direct Python requirements are auto-approved through an exact turn-private `.wanta-python` or selected-project `.venv` / `venv` interpreter, directly or through `uv pip --python`; direct Node.js packages are auto-approved only when npm/pnpm/yarn/bun explicitly targets the turn process directory or selected project. Both require no explicit source override, while package name, size, runtime, package runners, and unfamiliar ordinary flags are not confirmation boundaries. No-argument project dependency operations retain the narrow task-grant flow; global installs and alternate sources never enter the bounded fast path. Full Access = session-level local YOLO after OpenConnector credential and injected-runtime hard-deny checks). A direct `oo` / `$WANTA_OO_BIN` / `${WANTA_OO_BIN}` command keeps OpenCode's fast allow only for the OOMOL Link runtime. OpenConnector retains `bash: "ask"` so ChatService can apply its runtime-specific hard-deny and local-access policy. Plan's `edit` is limited to `.opencode/plans/*.md`. The root-level `WANTA_PERMISSION` mirrors the Build permission; no tools disable table is emitted (all built-in tools stay enabled). Each custom OpenAI-compatible model additionally gets its own provider `wanta-custom-<id>` (npm `@ai-sdk/openai-compatible`, the user's own baseURL/apiKey, env-only). |
| `system-prompt.ts`    | `WANTA_SYSTEM_PROMPT` (English): a Worker / task-first stance — first decide the work result the user wants, then pick the shortest reliable path among a direct answer, Local tools, and Link tools; use Local tools when local context is needed (bash, files, scripts, specific URLs; cwd is a private scratch, use absolute paths or `~` for real files); use `list_apps` for the current workspace's connection list, but never as a health check before an ordinary SaaS action; go to Link tools (the search→inspect→call flow) only when the task genuinely needs a connected account / SaaS data or action. A bare `oo` CLI inside a provider skill is preferred as a capability reference; when a Link tool cannot do it and the task genuinely needs it, it may still run, but must use the current turn's selector. It keeps the inspect-before-call, authorization-required blocking, minimal-access/payload, and side-effect-confirmation contracts, plus an "Asking the user" structured-question contract (header spec, no re-asking after a rejection, etc.).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| `tool-sources.ts`     | The **String.raw inline source** of five custom tools (`list_apps.ts` / `search_actions.ts` / `inspect_action.ts` / `call_action.ts` / `query_knowledge.ts`), exported as `AGENT_TOOL_FILES`. The tools import the build-time-merged tool helper + Zod from the workspace-private `../runtime/tool.js`, so tool loading does not depend on OpenCode implicitly installing npm packages on the user's machine. They run in OpenCode's Bun and take no part in this project's tsc/oxlint. The four Link tools (`list_apps` / `search_actions` / `inspect_action` / `call_action`) call `oo` via `execFile` (path from `process.env.WANTA_OO_BIN`, falling back to `"oo"` — note that a packaged / Finder-launched GUI process **does not inherit the shell PATH** (PATH is empty), so binaries always use an absolute path (`WANTA_OO_BIN` env / `resolveBundledBin`) and the `"oo"` string fallback is a dev-only crutch, unusable in production). `query_knowledge` calls no `oo` at all: it `execFile`s the WikiGraph CLI (`WANTA_WIKIGRAPH_EXECUTABLE` runs Electron with `ELECTRON_RUN_AS_NODE=1` + the `WANTA_WIKIGRAPH_CLI` entry, registry path from `WANTA_KNOWLEDGE_REGISTRY`; all three injected by `manager.startSidecar`). Only `list_apps` and `call_action` pass `--organization` on the main `oo` call; `search_actions`' own `oo connector search` carries no workspace selector (catalog search is identity-independent) — the team identity applies only to its internal `connector apps` list call (which overrides the active-workspace `authenticated` field) and its `/v1/providers` request. `call_action` translates a stderr `errorCode: <code>` that hits the AUTH_BLOCKING set into `{status:"authorization_required", authUrl: <console>/app-connections?provider=...}` (the authUrl base is taken only from the `WANTA_CONSOLE_URL` env; when missing it returns a structured `config_missing` error rather than hardcoding an endpoint).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `workspace.ts`        | `ensureAgentWorkspace(rootDir, bundledSkillsDir?, bundledToolRuntimePath?)`: on every startup it idempotently overwrites `<userData>/agent/workspace/.opencode/tools/*.ts` (using `node:fs/promises`; the directory name is the **plural `tools`**, verified against 1.17.13 — upstream docs disagree, do not change to singular), syncs the build-time-merged `.opencode/runtime/tool.js`, and rebuilds `.opencode/skill/<name>/` from the bundled built-in skills as source of truth (source = `resources/skills`, the four oo skills exported by `scripts/skills.ts` via `oo skills install --out-dir`; OpenCode scans the cwd's `.opencode/{skill,skills}/**/SKILL.md`, so Wanta's own agent reads those four skills directly — it **no longer releases skills into other AI agents' home dirs**). `.opencode/skills/` is the private target dir for Wanta registry/runtime skills, written by `SkillServiceImpl` and not wiped by the bundled-skill sync; the Wanta registry cache and external agent skills (Claude Code / Codex / Universal, etc.) are all synced here first, then handed to the sidecar to load. The workspace is the sidecar's cwd and is **immutable** (the custom tools depend on the `.opencode/tools/` beneath it).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `oo.ts`               | `buildAgentLinkEnv()` (R3) builds the complete isolated oo environment for one Link runtime. OOMOL receives `OO_API_KEY`, the build-time endpoint, Console/Connector URLs, and team scope; OpenConnector receives `OO_CONNECTOR_URL`, optional `OO_CONNECTOR_TOKEN`, and its configured Console URL. Both receive private config/data/log dirs plus disabled skill sync, self-update, and telemetry. `buildOomolMaintenanceEnv()` is separate and is used only for OOMOL account-owned Skill registry operations. The module also owns the shared authorization-blocking error codes.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `binaries.ts`         | Binary resolution: in dev, opencode = `node_modules/opencode-ai/bin/opencode.exe` (this fixed filename on every platform — upstream's postinstall already picked the local variant), oo = `.oo-bin/oo[.exe]`; in production, `resolveBundledBin(process.resourcesPath, name)` = `Resources/bin`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `event-translator.ts` | Statelessly translates OpenCode SSE (`message.updated` / `message.part.updated` / `session.error` / `permission.asked` / `permission.v2.asked` / `question.asked` / `question.v2.asked` / `question.replied` / `question.rejected`, etc.) → ChatService ServerEvents (0..n emits per event); `parseAuthorization()` recognizes the call_action authorization-signal JSON; permission events first enter the ChatService main-process local-access policy — auto-approvable requests continue straight through the OpenCode permission reply API, and only requests still needing a human decision are mapped to an in-chat permission state.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |

Runtime-specific qualifications to the table above: `AgentManager` receives independent
`ModelAccess` and `LinkRuntime` values. The workspace identity prompt, team-scope requirement, and
`--organization` arguments apply only to the OOMOL Link runtime. OpenConnector uses endpoint-only
identity and endpoint-qualified caches. `buildAgentLinkEnv()` assembles either the OOMOL variables
(`OO_API_KEY`, endpoint, team scope) or OpenConnector variables (`OO_CONNECTOR_URL`, optional
`OO_CONNECTOR_TOKEN`) on top of the same isolated `OO_CONFIG_DIR` / `OO_DATA_DIR` / `OO_LOG_DIR` and
sync/update/telemetry restrictions; `buildOomolMaintenanceEnv()` remains dedicated to account-owned
Skill registry work. `ensureAgentWorkspace()` receives separate `connectors` and `bundledOoSkills`
inputs, so OpenConnector gets typed Link tools without the OOMOL-specific bundled Skills. Direct oo
fast-allow in `config.ts` is likewise OOMOL-only. OpenConnector shell requests still reach
ChatService, which automatically approves built-in oo business operations after rejecting
credential reads, environment dumps, authentication/configuration mutations, and runtime
overrides.

Link batch reliability is guaranteed by Wanta's custom `call_action` tool, not left to the model or
OpenCode to converge on its own: within one chat session, a same workspace/service/connection/action
fan-out that appears in a short window runs a single canary first, then at most 2 concurrent on
success; the first authorization block short-circuits (circuit-breaks) that connection target for a
while, and queued calls return a structured `skipped`. Canary, short-term circuit-breaker, and
dedup state are all isolated per session; different chat sessions in the same workspace never share
them. An explicit `connectionName` is validated before execution against the current workspace's
`connector apps` result; when the list is unreadable or the name does not match, it returns an
ordinary structured error rather than an authorization prompt. Chat rendering keeps every per-call
tool audit record but aggregates them into a single CTA by that turn's connection target and error;
when the same target succeeds first and is blocked later in the same turn, it shows an
inconsistent-connection-state semantic.

Beyond the CLI, `search_actions` also fetches `${WANTA_CONNECTOR_URL}/v1/providers` directly to
attach an `authenticatedReliable` and `noAuthReady` field to each search result (a no_auth-only
provider counts as ready). OOMOL uses `OO_API_KEY` plus the organization header; OpenConnector uses
an optional `OO_CONNECTOR_TOKEN` and no organization. Both caches include backend and endpoint
identity. When the list is unavailable, `authenticatedReliable=false` and `call_action` remains the
authorization authority.

The sidecar self-recovers from crashes: on an unexpected sidecar exit `AgentManager` rebuilds the
workspace and restarts (up to 5 times, exponential backoff 1s→10s, pushing `runtime_restarting` /
`runtime_recovered` / `runtime_failed` connection states); the SSE event loop reconnects
independently (up to 5 times, 500ms→5s). `retirement.ts`'s `AgentRetirementPool` tracks the
background process-tree reaping of already-retired sidecars and drains it on shutdown.

Team / knowledge-base scoping is persisted rather than baked into the sidecar: the manager
atomically writes `teamName`, `sessionTeams` (the team per OpenCode session), and
`sessionKnowledgeBaseIds` to `userData/agent/team-scope.json` (the tools read it by `sessionID` via
`WANTA_TEAM_SCOPE_PATH`, which is how the team can switch without a sidecar restart), and via
`oo-identity.ts` mirrors the team name for the OOMOL Link runtime into
`oo-store/config/settings.toml`'s `[identity]
organization` (with rollback on failure). This is the implementation basis for the tool-sources
"per current session team" behavior.

## 3. IPC pattern (R7, throughout the conventions)

Each domain = `common.ts` (the contract: `serviceName("x-service")` as `ServiceName<{ServerEvents,
ClientInvokes}>`, shared-imported by main/renderer) + `node.ts` (the impl: `class XServiceImpl
extends ConnectionService<X>`, main → renderer push via `this.send(event, data)`). On the renderer,
after `client.use(XService)`, use `service.invoke("method", args)` / `service.serverEvents.on("event",
cb)`. The actual ServiceName string looks like `wanta/chat-service` (prefix from
`branding.servicePrefix`).

Eleven services: `chat` / `attention` / `session` / `skill` / `models` / `settings` / `auth` / `update`
/ `git` / `knowledge` / `link-runtime` (connector and teams each once had a service; after their requests moved to the
renderer the **whole service was deleted**, see §4). When adding a service, do not guess the
`@oomol/connection` API from memory (it is a private package) — copy the smallest live example
(e.g. `electron/settings/common.ts` + `node.ts`). **Security note**: `@oomol/connection` dispatches
dynamically by method name with no allowlist — every public method of a registered object is
invocable from the renderer, so sensitive logic must live on an unregistered object (see
`AuthManager` and `LinkRuntimeManager`). A service with local side effects (e.g. `git`) must validate on the main side that
the target comes from a registered user project, never trusting a path passed from the renderer.

IPC only carries what "must be done in the main process" (the agent kernel, deep-link auth, fs,
`shell.openExternal`, cookies, and OpenConnector calls requiring its stored runtime token);
**network requests driven purely by renderer business otherwise go renderer-direct** (see §4)
rather than back through IPC for the main process to relay.

## 4. Renderer-direct oomol requests (cookie auth + a main-process CORS shim)

**Principle**: the less the main process does, the better — once its event loop stalls, every
renderer call over IPC queues and the UI stalls with it. So **any network request driven by renderer
business that is essentially just "fetch data / fire an action" is sent from the renderer directly**,
never via IPC for the main process to relay.

**Mechanism (upholding R4 / R2)**:

- The renderer's `oomolFetch(url, init)` in `src/lib/oomol-http.ts` forces `credentials:"include"` —
  the sole credential `oomol-token` is an **httpOnly session cookie** (see §6), attached automatically
  by the Chromium network stack, which the renderer can neither read nor write (upholding R4).
  **Never** set an `Authorization` / `Cookie` header in the renderer (`Cookie` is a forbidden header
  in browser fetch anyway). `oomolFetchJson` normalizes 401 into an `auth_required` sentinel (copy:
  "Sign in is required."), consistent with the recoverable billing/login lifecycle. Separately,
  `oomolFetch` dispatches a window `CustomEvent` `wanta:auth-required` (`oomolAuthRequiredEventName`,
  detail carrying `requestedAt`/`status`) on **any** 401; `useAuth` listens for it and expires the
  session globally (ignoring stale 401s that predate a re-login, via `requestedAt`). This is how the
  whole app learns the session cookie died from any renderer-direct request — the per-call
  `auth_required` sentinel and the global event are two distinct paths (see §6).
- The domain is derived from `electron/domain.ts` (re-exported via `src/lib/domain.ts`). `__OO_ENDPOINT__`
  is a build-time constant injected by vite's **top-level `define`**, applied to the renderer bundle,
  so a renderer import of `electron/domain.ts` gets the same `*.<endpoint>` base URLs as the main
  process — **no hardcoded domain** (upholding R2).
- Cross-site CORS is solved by the main process's `installOomolCorsShim` in `electron/net/oomol-cors.ts`
  (called from `main.ts` whenReady): the renderer document origin is dev `http://localhost:5273` /
  prod `file://`, which is cross-site to `*.<endpoint>`, and the server never emits CORS headers for
  those origins, nor may `ACAO` be `*` when credentials are sent. The shim uses
  `webRequest.onBeforeSendHeaders` to capture the request `Origin` and `onHeadersReceived` to echo it
  - `Allow-Credentials:true`, and answers preflight `OPTIONS` (rewritten to 200 + Methods/Headers/Max-Age).
    It does **not** echo every captured Origin: it echoes only origins that pass an explicit
    renderer-origin allowlist — production `file://` / `null`, and dev `http(s)://localhost|127.0.0.1`
    on any port. Any other Origin hitting `*.<endpoint>` gets no CORS injection at all (a deliberate
    guard so a webview or a navigated document cannot borrow the session cookie's credentialed CORS).
    The URL scope is strictly limited to `https://*.${ooEndpoint}/*` (the domain derived from
    `ooEndpoint`, upholding R2). It is pure header rewriting — no token logic, no synchronous fs
    (upholding R1). The pure core `applyOomolCors` has unit tests. **Production `file://` (Origin `null`)
    is verified to work**: CDP against the packaged renderer confirms both anonymous (search) and
    authenticated (connector, cookie auto-attached) requests return 200.

**Renderer-direct domains** (each with a `src/lib/*-client.ts`; billing's aggregate cache is managed
by a hook, connections / skills keep a per-request-key cache inside the client, teams' composite
resource is managed by `team-details-resource.ts`). Most rows below are true migrations off a former
main-process/IPC service; `team-skills` is the exception — it was born renderer-direct and never had
a main-process service:

| Domain        | Renderer landing                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | Main-process remnant                                                                                                          |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------- |
| billing       | `billing-client.ts` (team subscription/seats, team usage, and the creator's personal balance requests plus team-plan and top-up checkout URL resolution); team usage is scoped by the team-id path segment of insight's `/v2/stats/team/:teamId/*` route (no team header), admins may read team subscription state but only the creator may change plans/seats or access funding, and non-creators must not degrade into querying their own personal account; the main-process `chat/billing.ts` is deleted                          | `open*` now uses the `chatService.openExternalUrl` IPC (only `shell.openExternal` validates the external open)                |
| voice ASR     | `routes/Chat/voice-asr.ts` (audio is already recorded in the renderer, avoiding a base64 trip through IPC)                                                                                                                                                                                                                                                                                                                                                                                                                           | none                                                                                                                          |
| teams         | `teams-client.ts` + `team-details-resource.ts` (team lists preserve `system_created`, members, authorizations, and provider options as a short-lived shared resource, plus member/admin role changes); the workspace hook merges duplicate list entries without dropping metadata and prefers the system-created team when no valid stored selection exists; creators and admins may change any non-creator member between member and admin, except that an admin cannot change their own role; **the whole IPC service is deleted** | none                                                                                                                          |
| team skills   | `team-skills-client.ts` — team skill configuration against the registry (`registryBaseUrl = https://registry.<endpoint>`, inside the CORS shim scope) via `oomolFetchJson`: `listTeamSkills` GET `/-/oomol/orgs/<teamId>/package-infos`, `addTeamSkill` PUT and `removeTeamSkill` DELETE `/-/oomol/packages/<pkg>/orgs/<teamId>` (i.e. it mutates via PUT/DELETE, not just reads); consumers are `useTeamSkills` and the Skills team-management routes                                                                               | none (renderer-direct from the start — born as `organization-skills-client.ts` in #55, never a main-process/IPC domain)       |
| skills browse | `skills-catalog-client.ts` (registry/search browse GETs; search results are used as-is to avoid a per-package detail fan-out; "my published" still fills detail concurrently)                                                                                                                                                                                                                                                                                                                                                        | install/update is still an oo CLI spawn + disk write + agent refresh (never a fetch to begin with)                            |
| connections   | `connections-client.ts` (the full connector HTTP + etag/30s GET cache + summary merge); `useConnections(workspace)` holds the summary state and the OAuth polling; **the whole IPC service is deleted**                                                                                                                                                                                                                                                                                                                              | OAuth opens the browser via `chatService.openExternalUrl`; the workspace→agent team scope goes via `chatService.setAgentTeam` |

**Requests that correctly stay in the main process (not renderer business)**: `auth/node.ts`'s
deep-link token exchange (`POST /v1/auth/auth_id` + `GET /v1/users/profile`, the cookie must be set
in the main process, see §6); `agent/manager.ts`'s `listAuthorizedServices` (`GET /v1/apps`,
short-TTL cache, and only waits a bounded budget on the prompt critical path) and the title-generation
`chat/completions` — all internal to the agent kernel, sidecar-driven, not renderer business.

## 5. Chat streaming data flow

```text
src/routes/Chat (PromptInput)
  → useChat.send → chatService.invoke("sendMessage", {sessionId, text, …})
  → ChatServiceImpl.sendMessage → AgentManager.promptStreaming
      (body.system merges six per-turn segments incl. the authorized-Link availability hint,
       which never lists provider names, R4)
  → OpenCode sidecar runs the agent loop (LLM ↔ tools)
  → global SSE: AgentManager.subscribe → event-translator.translateOpencodeEvent
  → ChatServiceImpl (main) coalesces same-text parts in a 32ms window, then broadcasts ServerEvents
  → useChat state machine (renderer)
```

Although the flow diagram shows `{sessionId, text}`, `SendMessageRequest` actually carries
`appLocale` / `attachments` / `contextMentions` / `teamSkills` / `projectContext` / `scope` /
`model` / `permissionMode` / `permissionModeVersion` / `reasoningLevel` / `mode`. Before `promptStreaming`,
`ChatServiceImpl.sendMessage` merges several per-turn system prompts of its own (`mergeSystemPrompts`
over `buildTeamSkillsSystem`, `buildContextMentionsSystemPrompt`, `buildProjectContextSystem`,
`buildPermissionModeSystem`, the bug-report system, and `buildResponseLanguageSystem`). The response
language follows the latest substantive user request across progress, questions, errors, and the
final response; the application locale is only the fallback when neither the request nor conversation
establishes a language. The R4 Link-availability injection in the diagram is only the `AgentManager`
side.

ServerEvents (`electron/chat/common.ts`) now span roughly two dozen events; grouped by family:
lifecycle (`messageStarted`, `messageCompleted`, `messagePartRemoved`); text/reasoning deltas
(`messageDelta` — **cumulative full text, not incremental**, the renderer replaces by `partId` —
and `messageReasoningDelta`); attachments (`messageAttachment`); artifact & turn-output updates
(`artifactBundleUpdated`, `turnOutputUpdated`); activity (`assistantActivity`); tools
(`toolCallStarted`, `toolCallResult` — an authorization block rides in the result's `authorization`
field, `AuthorizationInfo`); question & permission pairs (`questionAsked` / `questionReplied` /
`questionRejected`, `permissionAsked` / `permissionReplied`); errors & interrupts (`messageError`,
`agentError`, `generationStopped` / `generationInterrupted` / `generationNotice`); run tracking
(`activeRunUpdated`); and connection & runtime status (`agentConnectionChanged`, `agentStatusChanged`).
There is no `authorizationRequired` event anymore — authorization blocking is delivered as the
`authorization` field on `toolCallResult` (and on the tool part when history loads). In the main
process `ChatServiceImpl` does a bounded merge of text/reasoning events for the same
session/message/part, flushing immediately when a control event arrives; a repeated `message.updated`
no longer re-broadcasts `messageStarted`. In `useChat.ts`: a sessionId→messages map, `upsertPart`
updates in place by `partId` (stable React keys, no remount, no flicker), an optimistic user bubble
`local-user-*` is inserted on send (cleared when the real user message arrives), and a full reload
corrects state after `messageCompleted`. The event bridge is started by
`ChatServiceImpl.startEventBridge()` after the agent is assembled.

The run has a first-class lifecycle beyond the happy path above. `ChatActiveRun` carries a `phase`
(`sending` / `submitted` / `thinking` / `tool_running` / `answering` / `awaiting_permission` /
`awaiting_question`) broadcast via `activeRunUpdated`; `stopGeneration` / `getActiveRuns` /
`getSessionSnapshot` are IPC; user-stop tracking plus submit/start/inactivity watchdogs guard a
stuck run; `generationStopped` / `generationInterrupted` / `generationNotice` report stop/interrupt
outcomes; and `agentConnectionChanged` reports the SSE reconnect and runtime-restart states from §2.
When a run is active the renderer puts new messages into a per-session queue (reorderable, removable,
holdable), shown by `QueuedMessagePanel` and sent in order after the turn ends.

An OpenCode question interrupt is a closed loop: the question tool maps to a `ChatQuestionRequest`
carried by `questionAsked` / `questionReplied` / `questionRejected` events plus the `answerQuestion`
/ `rejectQuestion` invokes, forming a main-process-pending → renderer-answer loop rendered by
`QuestionPromptCard`.

Sub-agent (task) sessions get an event-folding layer on top of the SSE→ServerEvents chain.
`SubagentSessions` registers the parent↔child session mapping and copies the parent's
permission/local-access state to the child (`remember`/`forget`). In the event bridge, `forDisplay`
rewrites **only** the child's five interaction events (`permissionAsked` / `permissionReplied` /
`questionAsked` / `questionReplied` / `questionRejected`) onto the parent session's `sessionId` for
the renderer; the child's other events (text/reasoning/tools, etc.) are returned unchanged and are
then dropped — a source session that is not the current generation session and was not rewritten is
folded away and never reaches the renderer — while the parent generation still gets an inactivity
watchdog scheduled (parent ownership resolved via `generationWatchdogSessionId` →
`subagentSessions.parentSessionId`).

Ordinary file attachments are frozen at selection time into a 0400 read-only private snapshot at
`userData/attachments/originals/<random UUID>/<sanitized filename>` (the directory name is a fresh
`randomUUID()`, unrelated to the attachment id; the snapshot file is chmod 0400 and its directory
0500); previews, parsing, and local tools thereafter use only the snapshot and never modify or keep
depending on the user's source file. The model-compatibility representation (currently including
XLSX-extracted text and optimized images) is kept strictly separate from the public attachment
identity: before sending, `UserAttachmentStore` atomically persists the original attachment manifest
and user-authored text to `userData/user-attachments.json` keyed by the OpenCode user message ID,
with `agentPath` as internal input only. OpenCode's expanded synthetic Read text, Wanta's model-only
attachment compatibility text, and internal file parts are not
broadcast to the renderer; history loading likewise overrides OpenCode's model representation with
the Wanta attachment manifest, so mid-send, on refresh, and after restart it always shows the file
name, MIME, snapshot path, and exact text the user chose. If the user asks to modify an attachment, the agent
must first copy it into the turn's artifact directory and treat the copy as a new output; a directory
attachment stays an explicit local reference and is not snapshotted recursively.

Rendering uses vendored ai-elements (`src/components/ai-elements/`): Conversation/Message/PromptInput/Task,
etc.; Markdown goes through streamdown (built into MessageResponse); a tool part maps to an in-chat
`Task` collapsible summary.

Artifacts are never guessed from the reply text or from copied content. Every Build turn has a
managed output directory assigned by the main process: when the project context sent with the request
is still registered in `SessionProjectStore` and the path matches, it lives at
`<project>/.wanta/artifacts/<session>/<turn>/`; with no project, a mismatched project registration,
or Plan mode it stays at `userData/agent/artifacts/<session>/<turn>/`. The project path must pass the
registration check first, and no existing path segment of the project's `.wanta/artifacts` may be a
symlink, to keep artifacts from escaping out of the project. After the turn, `ChatServiceImpl` builds
an `ArtifactBundle` from real files only, atomically persisted by `ArtifactBundleStore` to
`userData/artifact-bundles.json`. A Build task in a registered project also publishes that turn's
final artifacts as ordinary visible files under the project root, mirroring the relative layout in
the managed directory; a same-named root file and any top-level directory step aside with `-2`, `-3`
increments, never overwriting; published files are owned by the user, and deleting the session only
cleans the `.wanta` managed directory, not the visible files. No-project and Plan mode do not
publish. A local assistant attachment is first copied into the managed directory; the main process
recursively scans the non-hidden ordinary files there and then applies a conservative classification
to the run-state sidecars that a third-party skill may have interleaved: only when a file name has
session/resume/checkpoint/state semantics, a small JSON has both a task identifier and runtime-state
fields, the directory holds another clear result, and the file is not an explicit assistant
attachment/preview does it keep the file but not register it into the bundle; a sole output, or a
corrupt/oversized/uncertain-shape JSON, is always kept as a result. The rest are recursively
registered as `ArtifactItem`, with `totalItems`, type, and display derived purely from the
user-visible result and the real MIME / file combination — no manifest is required of the model. The
renderer reads the structured record via `getArtifactBundles` + `artifactBundleUpdated`, and
`ChatTimeline` places the bundle under the matching assistant message. A message's result card and
the right-hand panel carry only the bundle for that message's turn: a single file previews directly,
multiple files browse only that turn's set, and the whole session's history is never implicitly
merged into one card; the top result entry follows the most recent turn that has results. The copy
button copies message text only and takes no part in the artifact lifecycle. If a reply already
shows a generated image but the turn ends with no reopenable local file, it registers
`failed/generated_preview_not_persisted`, and the UI states "artifact save failed" rather than
silently hiding the failure or passing a remote URL off as a saved artifact. When at least one saved
output exists but preview sources cannot all be attributed to saved files, the bundle records
`partial/generated_preview_persistence_unverified` for diagnostics without presenting the mismatch
as confirmed user data loss. The in-body image preview and artifact persistence are independent, but
for a final generated image both must produce output. At turn end the main process
materializes the assistant's local image attachments, Markdown data images, and public HTTPS image
previews into the turn's managed directory before building the bundle, so a preview source need not
be a native local file. Remote materialization is allowed only for a public HTTPS address carrying no
account info, validating redirects and the resolved address hop by hop, rejecting loopback/intranet
addresses, non-image responses, and content over 32 MiB. When it cannot materialize, it keeps the
in-body preview and registers partial/failed rather than letting the preview impersonate a saved
artifact. To stop the model from writing new files into the previous turn's directory when it reuses
an old script, `sendMessage` records a file baseline of the session's old artifact directories at
turn start; at turn end it copies only files added or changed after the baseline in the old dirs into
the current turn's directory and then registers the bundle independently under the current message,
leaving the old bundle untouched. The scan is strictly limited to the current session's artifact
root at that turn's real storage location, ignoring hidden items and symlinks; on an incomplete or
out-of-bounds baseline it disables recovery outright rather than guessing.

The built-in `/bug-report` slash command still sends to the current OpenCode session; `ChatServiceImpl`
appends a dedicated system prompt for that turn and generates `wanta-bug-report.md` based only on the
session evidence that existed before the command. The command forces the effective mode to Build
before allocating the artifact directory, so `createArtifactDir`, `artifactSessionDir`, and
`promptStreaming` all use the same mode, and writes this single UTF-8 Markdown report into the Build
managed output directory; it must not investigate, retry, or fix the original problem, nor call a
connector, the network, a shell, or read extra files. The report is shown as a single-file artifact
via the `ArtifactBundle` chain above, and the assistant body gives only a short completion status,
not the report content.

An in-chat multi-file bundle shows a single collection card that uses the real file count as its
title, does not show the internal turn directory name, and no longer appends a behavior-identical
"view all" entry. Intermediate scripts, temp data, and logs are written to a separate process
directory, recorded as `TurnOutputRecord.process` and viewed on demand via a secondary "execution
details" entry; they are not artifacts. An in-place edit inside the project is shown as a
`project_change` review/diff and likewise does not impersonate an exported artifact. `process` and
`project_change` share `TurnOutputShelf` and `TurnOutputsPanel`; when both kinds coexist in one turn,
the right-hand panel offers a "changes / process files" role switch and picks the initial role from
the entry the user clicked. Switching to process files defaults to collapsed and keeps the
non-artifact notice. The right-hand artifact preview keeps browsing the registered trusted
directories via `resolveLocalArtifacts`.

Local artifact previews have their own IPC surface beyond `resolveLocalArtifacts`:
`getLocalArtifactPreview` / `getLocalArtifactThumbnail` return structured previews (spreadsheet /
archive / docx / pdf / text, etc.), with XLSX parsing running in the main-process
`node:worker_threads` worker (`spreadsheet-preview-worker-client.ts`). The renderer side is
`ArtifactPreviewPane`, `ArtifactUniverSpreadsheetPreview` (a hard-rule-#11-protected component),
`ArtifactDocxPreview`, and `ArtifactPdfPreview`, backed by a preview cache and scheduler.

## 6. Login and credential flow

**The sole OOMOL credential across the app is the session token `oomol-token`** (an Electron session
cookie, persistent but short-lived and expiring). The gateway authenticates uniformly — a cookie, a
token, or an api-key are all accepted — so chat / connector / team / skills / billing all use this
one token. It **no longer fetches or persists a long-lived default-api-key** (persisting a long-lived
credential is unsafe and creates a split lifecycle where "chat works but usage cannot be viewed").

1. The renderer clicks "Sign in with browser" → the main process opens the system browser at
   `https://console.<ep>/launcher?protocol=<scheme>`.
2. After the web login it redirects to the deep-link `<scheme>://signin?authID=...` (the macOS
   `open-url` listener **must be registered at module top level**; waiting for whenReady loses the
   cold-start callback).
3. The main process `POST https://api.<ep>/v1/auth/auth_id` exchanges it for the `oomol-token`
   session cookie (persisted as an Electron cookie, expiry = the JWT `exp`).
4. It uses that token to `GET /v1/users/profile` for the account profile (**no default-api-key fetch
   anymore**).
5. The profile is written to `userData/auth.json` (0600, tmp+rename atomic write, **profile only, no
   credential**) → `applyAuthAccount` uses the session token to bring up the agent.

The single credential yields one consistent lifecycle: `AuthManager.currentState()` is async and
**token-gated** — if the profile is still there but the cookie has expired/been evicted it counts as
signed-out → the renderer falls to `LoginRoute`, and chat/connector/usage all become unavailable
together (no more split). `activeRuntimeAccount()` = profile + session token (null with no token);
`currentSessionToken()` now serves only the main-process skills service (`electron/skills/node.ts`) —
connector/team requests already authenticate renderer-direct via the session cookie (consistent with
§7) and no longer go through the main process for a token. At startup, `AuthStore.purgeLegacy()`
one-time-wipes any stale long-lived api-key left on disk.

A mid-session expiry is discovered and propagated from the renderer: on a 401 `oomolFetch` dispatches
the `wanta:auth-required` window event, `useAuth` listens and calls the AuthService facade's fourth
method `expireSession`, and `AuthManager.expireSession` sets `sessionInvalidated`, clears the cookie,
`applyAccount(null)` to stop the agent, and broadcasts signed-out while keeping the local profile.

`applyAuthAccount` (main.ts) is serialized through an `applyChain` promise + a same-credential
(id+sessionToken) idempotent short-circuit (the cold-start deep-link and whenReady both apply and
would double-apply); an agent-startup failure rolls back and leaves no zombie reference. **Every**
login callback — including one this app initiated with a pending in flight — must show a system
dialog to confirm the account: the launcher returns no verifiable state/nonce, so confirmation is the
only guard against a second deep-link silently swapping the account inside the pending window
(login-CSRF); the pending has a 10-minute timeout. The pure part is in `electron/auth/browser-login.ts`
(with unit tests).

The renderer's `src/App.tsx` keeps authentication and Agent readiness separate. A signed-out user can
enter the normal application shell when a custom model is configured, configure OpenConnector, and
use Link tools without an OOMOL account. Without OOMOL model access or a custom model, Chat remains
`model_required`; Settings and Connections still expose the independent Link configuration and
status.

## 7. Connections panel flow

OOMOL connector-management requests **moved wholesale to the renderer**
(`src/lib/connections-client.ts`, see §4) —
this was the poster child for "the main process does too much": during OAuth the summary's multi-way
fan-out was triggered at high frequency by the 2s poll. The client uses `oomolFetch` (session cookie
auto-auth, **no `Authorization: Bearer` anymore**); the Apps, usage, and detail team resources attach
the `x-oo-organization-name` header per workspace, while the global `/v1/providers` public catalog
attaches no team header. The two read kinds each keep an etag/`if-none-match` + 30s GET cache (saving
a re-pull of the ~600-provider catalog on every poll), and a permission denial or transient failure
on the team Apps does not clear the public Provider catalog; the pure functions
`summary.ts` / `usage.ts` / `executions.ts` / `federated.ts` / `domain.ts` are imported directly by
the renderer (merging `/v1/apps` connected + `/v1/providers` catalog → `ConnectionSummary`).

The summary read is now two-phase: catalog-first (apps + providers, `appsStatus`:
ready/forbidden/unavailable) plus a background usage fill (`usageStatus`: loading/ready/unavailable);
a usage failure keeps the previous usage rather than clearing it.

`useConnections(workspace)` (the sole consumer, instantiated by AppShell) holds the summary state:
`workspace` comes from `useTeamWorkspace`, where `null` means a team is selected but its name is not
ready yet — this pauses all connector requests, resets the panel state to its initial state (actions
are rejected with "Workspace is still loading."), and does **not** carry over the previous workspace.
On change it re-pulls the summary and **syncs the agent's team scope via the `chatService.setAgentTeam`
IPC** (the agent is still owned by the main process). `connect()` handles five `authType`s: `oauth2`
takes `authorizationUrl` from the renderer's `startOAuthConnect` → `chatService.openExternalUrl` IPC
opens the system browser (the main process only validates the protocol is http/https — rejecting
`file://` and custom protocols — then `shell.openExternal`) → then polls `/v1/apps` at 2s intervals /
5min timeout, comparing against the active-app-id baseline recorded before connecting to detect a new
connection, and only after that re-pulls one full summary (no longer firing the four-way summary
fan-out per tick); `api_key` / `custom_credential` / `federated` / `no_auth` POST directly then
refresh locally. On a successful change (connect/disconnect/alias), `connections-client` internally
targeted-invalidates that workspace's `/v1/apps` (incl. the by-id detail) cache keys and re-pulls
(the public Provider catalog cache is retained); a full `clearConnectorCache()` happens only on an
auth-state change / Provider unmount (`AppDataProvider`) — there is **no cross-process
`connectionSummaryChanged` broadcast anymore** (single consumer, local state is the sync). See
[network-request-caching.md](network-request-caching.md). A tool call result carrying an
`authorization` (`AuthorizationInfo`) field → renders a "go authorize" button → opens the in-chat
connection drawer to that provider and records the auth intent so the original action auto-retries
once authorization completes.

OpenConnector does not reuse that renderer client because doing so would expose the runtime token
and mix different management contracts. Its Connections route calls the main-process Link runtime
facade, which reads `/v1/apps`, validates the standard envelope, maps `alias` to `connectionName`,
and returns only redacted fields. Provider management remains in the external Console.
OpenConnector authorization opens the structured
`<consoleUrl>/providers/<encoded-service>` destination in the system browser; the original turn
remains retryable, but Wanta does not poll or auto-retry the external flow. OOMOL keeps the existing
in-app drawer and automatic retry.

OAuth pending is persisted and recoverable: the pending op is written to `sessionStorage` under a
branding `storageKey` (5-minute TTL), so on panel remount / a workspace switch-back it auto-resumes
the poll; a repeated `connect()` for the same service attaches to the existing pending rather than
re-requesting an authorization URL. `connections-client` also adds user-level OAuth client config
management (`/v1/oauth-client-configs` GET/PUT — not tied to the team workspace, no team header) with
its own 5-minute cache; a successful PUT targeted-invalidates the provider catalog/detail cache keys.

## 8. Module map

The map is cluster-level and deliberately non-exhaustive — the source tree is the source of truth,
so this describes shape and traps, not every file.

```text
electron/
  main.ts preload.ts          assembly root / RPC bridge
  branding.ts domain.ts       R1 single brand source / R2 endpoint derivation (only domain source;
                              domain.ts is also imported by the renderer, see §4)
  protocol.ts                 deep-link registration / single-instance lock / URL listener
  service-events.ts           in-process ServiceEvent<T> (not RPC)
  app-command.ts app-locale.ts  app command palette + locale feeding the application menu
  command-path.ts             per-platform PATH resolution for spawned binaries (see §2 sidecar)
  atomic-file.ts              tmp+rename atomic writes shared by every store
  trusted-path-registry.ts    registered user-project path guard for local-side-effect services
  media-permission-policy.ts  renderer media-permission gate (audio-only, main window/frame)
  attachment-dialog-handlers.ts attachment-picker.ts  attachment-picker IPC + read-only snapshotting (§5)
  diagnostics-log.ts store-diagnostics.ts  diagnostics log + store health reporting
  oo-command.ts oo-store-paths.ts  oo CLI invocation + oo-store directory layout
  activity-metrics.ts agent-refresh-scheduler.ts renderer-error-report.ts  (among other root modules — see the source tree)
  net/oomol-cors.ts(+test)    CORS shim for renderer-direct *.<endpoint> (§4); pure applyOomolCors + webRequest shell
  agent/                      the sidecar kernel — see §2
  agents/  catalog(+test)     discovers externally installed agent CLIs (5s discovery cache); NOT the agent/ sidecar dir
  artifact-resource/ lease-store,protocol(+test)  custom wanta-resource protocol streaming leased artifact files to the renderer
  attention/ common,node,store,policy,notification-{capability,delivery,history}(+test)  unread-task state, persistence, system notification + app-icon badge policy
  auth/    common,node,store,browser-login,session-cookie(+test)  login & credentials (see §6)
  chat/    common,node + ~45 modules  by far the largest main-process domain: SSE event bridge; per-turn lifecycle & outputs (turn-lifecycle, turn-outputs); structured artifact registration/persistence (artifact-bundles, artifacts) + previews (spreadsheet-preview-worker[-client]); permission / local-access policy (permission-state, project-permission); project-* commands; attachments; stream buffering (stream-event-buffer, context-system). Also thin main-process facades openExternalUrl (shell external open) / setAgentTeam (agent team scope) for the renderer request layer (§4, §5)
  git/     common,node,status,turn-diff(+test)  GitService (serviceName("git-service")): project git status + per-turn diff review
  knowledge/ common,node,store,runner,uri,thumbnail(+test)  WikiGraph knowledge-base import, registration, query runtime & RPC service
  link-runtime/ common,node(+test)  selected Link runtime, origin-bound OpenConnector token, health/inventory facade
  teams/   common       types only, no node.ts — team requests moved renderer-side (src/lib/teams-client.ts, §4)
  connections/ common,summary,usage,executions,federated,domain,summary-model(+test)  **pure functions + types, no node.ts** — connector requests moved renderer-side (src/lib/connections-client.ts, §4/§7); electron-free, imported straight into the renderer bundle
  skills/  common,node,actions,scan,inventory,…  skill service (install/scan/inventory); browse GET moved renderer-side (src/lib/skills-catalog-client.ts); actions.ts normalize* reused by the renderer (§4)
  session/ common,node,activity-store,metadata-store,project-store,title(+test)  session CRUD (proxies AgentManager, sessionsChanged broadcast) + session activity/metadata + per-session project binding
  models/  common,node,store,builtin,limits(+test)  built-in + custom model list; changing custom models restarts the agent
  settings/ common,node,store(+test)  themeSource + completion-notification condition + notification sound + unread badge + knowledgeBase beta flag; atomic writes; stores no credentials (R8); updateChannel lives only in the on-disk store layer, consumed by UpdateService
  update/  common,node,channel,policy(+test)  UpdateService: check/download/install/channel switch, periodic/foreground/wake scheduling + appUpdateStateChanged;
                              generic feed = static.<ep>/release/apps/wanta/<plat>/<arch>; packaged-only; autoDownload=false
                              (settings UI triggers explicitly); channel via setFeedURL channel field (never the channel setter —
                              it silently sets allowDowngrade) + explicit allowDowngrade=false; bounded retries tolerating 404;
                              under ESM must static-default-import updaterPkg.autoUpdater
  window/  application-menu(+application-menu-messages),title-bar-overlay,window-close-behavior,windows-tray-lifecycle(+test)  application menu, native title-bar overlay, close-to-tray behavior, Windows tray lifecycle
src/
  main.tsx App.tsx            entry / AuthGate
  lib/     oomol-http domain  renderer-direct request base (§4): oomolFetch (credentials:include) + the wanta:auth-required 401 broadcast / domain re-export
           shared-request resource-store   shared request infra + keyed resource store backing the clients below
           billing-client connections-client teams-client skills-catalog-client team-skills-client   per-domain request clients (connections/skills carry their own keyed cache)
           team-details-resource   team member/authorization/provider-options shared resource + targeted invalidation
  components/app-shell/       AppShell three-pane + internal route state (archived|billing|chat|connections|knowledge|teams|skills|settings)
  components/ai-elements/     vendored trim (conversation loader message message-image prompt-input shimmer task code-block message-streamdown + the mermaid/diagram trio: diagram-viewer mermaid-policy mermaid-renderer)
  components/ui/              shadcn primitives (button badge dialog select popover tooltip … 25 files)
  components/ (top level)     shared data layer AppDataProvider/AppDataContext/AppDataHooks; ThemeProvider/theme-context; ErrorBoundary; PageRouteShell; InspectorPanel; SkillIcon/skill-icon-source; AgentIcon; … (~30 components)
  routes/  Archived/ Billing/ Chat/ Connections/ Knowledge/ Login/ Settings/ Skills/   (Chat/voice-asr.ts renderer-side speech-to-text, §4)
  hooks/   useChat useSessions useConnections useLinkRuntime useAuth useAppUpdate useBillingOverview useTeamWorkspace useAttention useKnowledgeBases useProjectGit useTeamSkills useAppSettings … (~20 hooks)
  i18n/    in-house lightweight i18n (zh-CN baseline + en, localStorage key wanta.locale)
  index.css                  import hub for src/styles/*.css (theme base platform login app-shell ui markdown turn-diff — 8 files); Tailwind v4 theme (CSS variables); @source streamdown + @streamdown/mermaid live in src/styles/theme.css
  styles/                    the eight imported stylesheets above
```
