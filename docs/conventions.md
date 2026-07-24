# Coding Conventions and Security Baseline

> The root guide (AGENTS.md / CLAUDE.md — one file under two names via symlink) lists the hard rules;
> this doc is the full version. Related: [architecture.md](architecture.md) · [development.md](development.md)

## 1. Design numbering system (recurs in comments, inherited from the original plan)

- **R1** Branding single source of truth: `electron/branding.ts`. `electron-builder.ts` must derive
  appId / productName / protocol from that module. The `OO_` env prefix and `x-oomol-*` headers are
  external protocol contracts and do not change with branding.
- **R2** Endpoint single source of truth: `electron/domain.ts` derives every domain; scattered
  hardcoding is forbidden (now a build-time constant; dynamic switching has been removed).
- **R3** oo is controlled only through environment variables: `buildAgentLinkEnv` and
  `buildOomolMaintenanceEnv` in `electron/agent/oo.ts` are the complete runtime-specific sets.
- **R4** Dynamic system prompt: the stable persona lives in agent.prompt (prompt-cache friendly);
  the per-turn presence hint for authorized Link providers (sourced from `/v1/apps`) is injected at
  the end via `body.system` (verified in practice to append, not override); by default do not list
  specific provider names, so availability context does not become tool bait.
- **R5** Discovery / invocation / authorization signals all travel through structured tool results —
  never parse model free text; unauthorized detection relies on the stderr `errorCode: <code>` token
  (a locale-independent anchor; the zh copy uses full-width parentheses, so the regex must exclude
  `)）`).
- **R6** System prompt contract: the blueprint comes from the oo-cli built-in oo skill, with
  CLI-specific clauses removed.
- **R7 is overloaded in code — distinguish when grepping**: the original-plan meaning =
  **IPC streaming** (ClientInvokes initiate + ServerEvents push, see the comments in
  `electron/chat/common.ts` and [architecture.md §3](architecture.md)); whereas the "R7" in the
  header comment of `electron/agent/system-prompt.ts` is a **prompt revision number** (the revision
  that unlocked local coding) and has nothing to do with IPC.
- **R8** Security: never persist plaintext session tokens; settings.json stores no credentials
  (kept separate from auth.json); secrets travel only via env / CI secrets.
- "Phase 0..6" in comments corresponds to the original 7 commits
  (see [project-overview.md §4](project-overview.md)).

## 2. Main-process fs discipline

- **Never use synchronous fs APIs in the Electron main process** (`existsSync` / `readFileSync` etc.
  block the main process and in turn stall the renderer).
  - Dev-time existence checks → the predev guard `scripts/check-oo.ts` (a standalone Node CLI, where
    sync fs is fine).
  - Packaged builds always bundle the binaries; no existence check is needed at runtime.
  - Runtime file operations use `node:fs/promises` (e.g. `electron/agent/workspace.ts`).
  - Existing exceptions (small, one-off, do not spread): the small JSON reads/writes in
    `electron/auth/store.ts` and `electron/settings/store.ts`.

## 3. File and module layout

- Service domains registered as main-process RPC services co-locate in one directory:
  `common.ts` (contract + pure types, imported by both main and renderer) / `node.ts` (main-process
  implementation) / `store.ts` (persistence) / `*.test.ts`. This applies to the RPC-registered
  domains (currently attention / auth / chat / git / knowledge / link-runtime / models / session /
  settings / skills / update — see the source tree); `connections` and `teams` keep only `common.ts` contracts
  and pure functions under `electron/`, with their request logic living in the renderer at
  `src/lib/*-client.ts`.
- Unit-testable logic is split into pure-function files: `auth/browser-login.ts`,
  `connections/summary.ts`, `agent/event-translator.ts`, `auth/store.ts` all follow this pattern.
  Prefer this split for new logic.
- `electron/agent/` stays **electron-free** (no electron imports), so headless smoke tests can
  construct an `AgentManager` directly.
- Relative imports carry an explicit `.ts` extension (tsconfig `allowImportingTsExtensions`; also
  required when running scripts directly with `node --experimental-strip-types`).
- `node --experimental-strip-types` does not support TS parameter properties: classes always use
  explicit fields + constructor assignment, never `constructor(private x)`.
- Renderer path alias `@/` → `src/` (vite + tsconfig paths; components.json kept in sync).

## 4. Language and logging

- Comments: English. Code identifiers / system prompts / log text: English.
- Docs (docs/ and the root guide): English. Localized root READMEs (`README.<locale>.md`) are the
  explicit exception and must remain faithful translations of `README.md`.
- All human-readable text in Git operations must be English, including but not limited to commit
  messages, branch names, PR titles, PR descriptions, PR reviews/comments, tags/release notes; do
  not use Chinese Git copy for Codex/agent commits either.
- Legacy Chinese comments still exist in older code and are being migrated separately; write new or
  edited comments in English, and do not mass-translate unrelated comments in feature PRs.
- Docs are organized by topic — **no commit hashes, no per-commit append records** (git log is the
  authoritative source of history); do not hardcode the root guide's filename (it exists under two
  mutually symlinked names).
- Main-process business logs uniformly use the `console.*("[wanta] ...")` prefix — no exceptions
  remain (`electron/protocol.ts` and `electron/preload.ts` also use `[wanta]`).
- **Deep-link logs must be redacted** (the query contains an authID redeemable for credentials):
  log only scheme/host/path (see `redactDeepLink` in `main.ts`).

## 5. Security baseline (new code must not weaken it)

- Credentials never enter the renderer: the only OOMOL credential in the app is the session token
  `oomol-token`; the `AuthManager` that holds it (`currentSessionToken` / `activeRuntimeAccount`) is
  deliberately not registered as an RPC service (`@oomol/connection` registration exposes
  everything — there is no method allowlist); only the contract facade is registered. **Long-lived
  api-keys are no longer fetched or persisted** — the gateway layer uniformly accepts
  cookie/token/api-key, so the session token is used throughout. User-entered third-party custom
  model API keys (DeepSeek / Gemini / OpenRouter, etc.) are the exception: they are stored as
  ciphertext entries in the single 0600 `model-credentials.json` file by `ModelCredentialStore`
  using Electron `safeStorage`, and are never returned to the renderer (only an
  `apiKeyConfigured` boolean is exposed).
  `models.json` must not contain any key. On Linux, weak/unknown `safeStorage` backends must be
  explicitly rejected; silent plaintext fallback is prohibited.
- An optional OpenConnector runtime token follows the same one-way boundary: renderer input only,
  origin-bound ciphertext in 0600 `link-runtime.json`, and only `tokenConfigured` returned. The
  unregistered `LinkRuntimeManager` owns decryption; the registered service is a redacted facade.
  Never send the saved token to a changed origin or through a cross-origin redirect. Provider
  credentials, admin tokens, and OAuth client secrets remain owned by OpenConnector and must not be
  copied into Wanta.
- `auth.json`: 0600 permissions, tmp+rename atomic write; **stores only the account profile, never
  any credential**. The session token lives only in the Electron session cookie and runtime memory;
  `AuthStore.purgeLegacy()` at startup wipes any legacy persisted api-key remnants.
- **Every** signin deep-link callback requires a system-dialog confirmation (anti login-CSRF) —
  including pending logins initiated by this app, because the launcher returns no verifiable
  state/nonce. There is no "app-initiated may skip" path; do not add a confirmation-free shortcut
  for pending logins.
- The sidecar HTTP server carries random-password Basic Auth (`OPENCODE_SERVER_PASSWORD`).
- External URL opening uses the protocol allowlist `{http, https, mailto, tel}`, centralized in
  `openExternalUrl` in `main.ts`; `setWindowOpenHandler` and `will-navigate` must share that helper.
  When adding a protocol, consider both paths. Archived falsified review finding (disproven, do not
  re-report): "will-navigate wrongly blocks the renderer page when the dev host is not localhost" —
  the window loads the very same `viteDevServerUrl` string (prefix self-match always holds), and
  vite-plugin-electron's `resolveServerUrl` maps `0.0.0.0`/`::` to localhost anyway.
- Markdown rendering introduces no raw HTML (streamdown, like the former react-markdown, keeps HTML
  escaping for XSS protection); tightening link protocols should happen in the renderer, not only as
  an Electron-side deny (otherwise you get "clickable but nothing happens").
- OpenCode configuration is injected inline via `OPENCODE_CONFIG_CONTENT`; the session token enters
  only the in-memory env and never touches disk (custom model API keys, persisted in
  `userData/models.json` as above, are injected inline through the same config); the provider's
  `options.apiKey` and oo's `OO_API_KEY` field names are retained (external contract), with the
  session token as the value.

## 6. Error handling

- Service methods when the agent is missing: read-type methods return empty collections/false,
  write-type methods throw (e.g. "Agent not configured (sign in first)").
- Background broadcast failures are silent: `.catch(() => undefined)`.
- Agent startup failure must roll back the reference — no zombie state left behind (see
  `applyAuthAccountNow` in `main.ts`).
- Credential/agent assembly always goes through the serialized `applyAuthAccount` chain — never
  bypass it (a dual-path race happened before).

## 7. Agent / tools

- **Capabilities sync across three places**: the tools configuration in `config.ts` (current state:
  no disable table, all built-in tools enabled), permission (agent-level + root-level), and the
  `system-prompt.ts` prompt. Changing any capability policy means changing all three together.
- **Permission `"ask"` must be verified against the UI**: `permission.asked` /
  `permission.v2.asked` are first handled by the ChatService main-process local access policy;
  Default Access treats bash as a normal working channel, auto-approving ordinary shell commands,
  scripts, project checks, data processing, simple output filtering, ordinary file reads/writes, and
  specific non-sensitive paths. Reading specific non-sensitive files, ordinary directories, and
  project files should not create prompts; only broad home/system root scans prompt. Credentials/
  secrets, browser login state, and private app data such as mail/messages/contacts/calendar must be
  evaluated before any generic directory grant — an ordinary folder grant never covers these
  sensitive sub-paths. Third-party Python dependencies must go into the private `.wanta-python` venv
  under each turn's process directory. Direct PyPI requirements are auto-approved there regardless
  of package popularity, including ordinary extras and version constraints. This does not cover
  `--user`, `--break-system-packages`, extra indexes, URL/local-path/requirements files, or system
  Python. Direct standard-registry Node.js packages are auto-approved only when an
  npm/pnpm/yarn/bun install explicitly targets the turn process directory or the currently selected
  project. Package runners are ordinary local execution rather than a package-specific risk class.
  No-argument or other project dependency operations can earn a task-level grant valid only for the
  current generation. Global installs, custom registries, user config, Git/URL/local package
  sources, explicitly high-cost runtimes, and out-of-scope commands never qualify for automatic
  approval. Session
  grants may still cover non-sensitive requests the user has explicitly allowed; Full Access =
  session-level local YOLO — once confirmed, the main process auto-replies local permissions for the
  session and stops doing per-request local risk judgment.
  New ask rules must be verified end to end: pending-permission queries, event push, auto-approve
  dedup, and reply.
- **oo CLI fast path**: the OpenCode configuration still keeps the fast pass for commands whose
  first token is `oo` / `$WANTA_OO_BIN` / `${WANTA_OO_BIN}`; all other local bash /
  external_directory asks fall through to the ChatService Default Access policy. Shell pipes/
  redirection are not by themselves a reason to prompt — prompt only on a genuine baseline security
  risk; `sudo`, piping into a shell, writes to sensitive paths, etc. still require confirmation.
- **Permission gates only built-in tools**: `bash: deny` and the like do not constrain `.opencode`
  custom tools (their permission gate lives inside each built-in tool's execute) — when
  re-tightening permissions, the connector meta-tools keep spawning oo unaffected.
- **Questions only honor the runtime pending request**: `question.asked` is a runtime interrupt
  where the agent pauses to await extra user input — it is not a permission prompt, nor a
  history-message recovery mechanism. The renderer shows only the current pending question from
  ChatService/the sidecar; historical question tools render as history only. Cancelling a question =
  `rejectQuestion` — it must not also stop the generation; only stopping the generation clears the
  current pending-question UI. Never fake resumable interaction from localStorage, history messages,
  or stopped/recoverable/dismissed states.
- Embedded tool source (`tool-sources.ts`, String.raw) **must not contain backticks or `${}`**
  (they break the template string); that code runs in OpenCode's Bun and does not participate in
  this project's tsc/oxlint. The embedded custom tools are the four connector tools plus
  `query_knowledge` (knowledge-base archive queries, incl. pack/`--budget` operations), backed by
  the full `electron/knowledge/` service domain registered as an RPC service. Tool descriptions are
  themselves part of the prompt: keep the list/search/inspect/call responsibility boundaries and
  cross-references, and keep `query_knowledge` scoped to knowledge-base retrieval.
- The embedded tools do not rely on OpenCode implicitly installing npm packages on the user's
  machine: the tool helper and Zod schema are bundled at build time by
  `scripts/build-agent-tool-runtime.ts` (entry `scripts/agent-tool-runtime-entry.ts`) into a
  single-file runtime, synced by `workspace.ts` into `<workspace>/.opencode/`; every tool uniformly
  does `import { tool } from "../runtime/tool.js"`. When changing embedded tools, account for this
  runtime as well.
- Sidecar cwd = `userData/agent/workspace`, not changeable (`.opencode/tools/` lives under it);
  file access escaping it goes through `external_directory: "ask"`, handled by the ChatService local
  access policy.
- `parseConnectorErrorCode` (`oo.ts`) and the inline regex in `call_action` must stay identical —
  change one, sync the other. `AUTH_BLOCKING_ERROR_CODES` (`connection_required` etc.) comes from
  the connector upstream, not oo-cli; the **authoritative definition** is the connector OpenAPI
  error schema (`https://connector.<endpoint>/openapi.json`, requires
  `Authorization: Bearer <session token>`) — check there before adding to or removing from the set.
- The Link tools' `connectionName` is a connector-internal locator: the model must never guess it
  from provider display names, account labels, aliases, or email addresses; before passing it
  explicitly it must be validated against the current workspace's `list_apps` result. When the
  connection list is unreadable, never silently switch to a default account.
- `list_apps` only answers the connection inventory or validates an account the user explicitly
  chose — never use it as a pre-flight health check for ordinary Link reads/actions. The per-turn
  dynamic system prompt must state that turn's team; custom Link tools apply per session
  automatically, and if a bare `oo connector` CLI call is unavoidable it must explicitly pass the
  same `--organization`; after an error, never drop the selector or retry under a different
  identity.
- `call_action` batches get canarying, per-target throttling, and a short-term authorization
  circuit breaker at the tool layer; queued calls after a connection block return
  `status: "skipped"` and must not keep hitting the connector or generate a second authorization
  prompt. Connection actions in the chat UI aggregate by this turn's workspace/service/target/error;
  tool details are retained but each same-origin problem offers exactly one user action.
- New code that needs an endpoint: import derived constants from `domain.ts`; do not add new
  `__OO_ENDPOINT__` reference points (the define coverage must stay in sync with the vite/vitest
  configs; currently three define points: renderer/main/preload).
- **Artifacts are only the real files registered by the system**: producers write into each turn's
  managed output directory; Build tasks for a registered project first write to
  `<project>/.wanta/artifacts/<session>/<turn>/`, and on completion the main process publishes the
  final artifacts to the project root — relative layout preserved — as ordinary visible files; with
  no project, or in Plan mode, writes go only to `userData/agent/artifacts/<session>/<turn>/`, and
  process files always stay in the private process directory. Project publishing must preserve
  valid Unicode names, atomically sidestep same-named files or top-level directories with `-2`,
  `-3` suffixes, and never overwrite or escape via symlinks; published files belong to the user —
  session cleanup may delete only the managed directories. No pre-existing directory segment of the
  managed path inside a project may be a symlink. The main process builds and persists the
  `ArtifactBundle`; the renderer consumes only the structured bundle. Never infer artifacts by
  parsing assistant free text, copied content, or arbitrary paths; never rely on a model-generated
  manifest to decide whether files exist, their type, or their count. Third-party Skills are outside
  Wanta's control and may write runtime-state sidecars (session, resume, checkpoint, etc.) into the
  same directory as final results; the main process may exclude well-evidenced runtime state from
  the `ArtifactBundle` using conservative, testable rules that combine filenames with structured
  content, but must not delete or move the original files, must not filter by extension alone, and
  must not hide the only output; explicit assistant attachments/previews take precedence for
  retention, and anything that cannot be reliably classified must also be kept. Inline image preview
  and artifact persistence must be decoupled, and a final image must produce both: the main process
  may materialize local/data/public-HTTPS images from explicit assistant image attachments or
  Markdown image nodes, but must not guess paths from ordinary copy; remote materialization must
  restrict protocol, private-network addresses, redirects, MIME, size, and timeout. Failing to
  persist, or to publish to the project, must yield an explicit failure state — never dodge failure
  by hiding the preview or the managed copy. A preview-count mismatch beside a reopenable saved
  output is only incomplete source attribution, not proof that a distinct user deliverable was lost;
  keep that diagnostic state without showing a data-loss warning. At the start of each turn, record
  a file baseline of the current session's older artifact directories under this turn's actual
  storage location; if an old script mistakenly writes into an old directory, recover at turn end
  only the regular files added or changed after the baseline into the current turn — never rewrite
  old bundles, scan across sessions, or follow symlinks, and never recover when the baseline is
  incomplete.
- **User attachments are separated from model representations**: when an ordinary file is selected
  it is first copied into a Wanta-private 0400 read-only snapshot; preview, parsing, and agent
  tools read only the snapshot — never modify the user's source path or the attachment snapshot.
  When the user asks for modifications, first copy into the current turn's artifact directory and
  make the copy the new output. Public message attachments are persisted by `UserAttachmentStore`
  keyed by user message ID and are the source of truth for chat history; `agentPath`
  representations (XLSX text extraction, optimized image copies, OCR, fallback path instructions,
  etc.) are internal only — they must not replace the attachment card, enter copied text, or
  impersonate the user's original during history restore. Persist the exact user-authored text with
  the public attachment record and use it as the display/copy/retry source of truth. OpenCode's and
  Wanta's synthetic attachment context must be filtered by structured markers — never guessed from
  Read copy or free text. Directory attachments are local references
  and do not get recursive snapshots.

## 8. Renderer / UI

- No router library: page switching is internal state in `AppShell.tsx`; before adding a "page",
  first ask whether a router library is truly needed.
- Streaming render stability: text parts use a stable React key (partId), `upsertPart` replaces in
  place — no remounting, no flicker; `messageDelta` is cumulative full text, not incremental.
- During streaming, Enter must only send — never stop (stop responds solely to an explicit button
  click; this was once a HIGH regression).
- The visual hierarchy of chat results is fixed: final artifacts use single-file/collection cards;
  in-place project modifications use review cards; intermediate scripts, temporary data, and logs
  use only the secondary "execution details" entry. A message's result card represents only the
  turn that produced it: single files preview directly, multi-file cards open only this turn's
  collection, never implicitly mixing in the whole session's historical results. Multi-file
  artifacts must not offer both a collection card and a behaviorally identical "view all" entry,
  must not expose internal turn directory names to the user, and must not label process files as
  artifacts. `process` and `project_change` share the file review component; when both are present
  they must switch roles inside the same panel — never duplicate two detail panels.
- Vendored component rules: new vendored files go in `src/components/ui/` or
  `src/components/ai-elements/` (covered by the `react/only-export-components` override);
  `ui/badge.tsx` is a merge of the shadcn standard plus this project's own success/warning/muted
  variants — do not overwrite it directly on upgrade; the `// @ts-expect-error ... v6` comments that
  ship with registry sources must be deleted when vendoring (this project installs ai v6, so the
  directive becomes "unused" and blocks ts-check).
- The two `@source` lines in `src/styles/theme.css` — `@source "../../node_modules/streamdown/dist"`
  and `@source "../../node_modules/@streamdown/mermaid/dist"` — must not be deleted (Tailwind v4
  does not scan node_modules; deleting them means the classes those packages use are not generated).
- i18n: an in-house lightweight implementation (`src/i18n/i18n.ts`), flat dot keys + `{var}`
  placeholders, zh-CN as baseline + en mirror; new copy must be added to both locales; `useT()`
  returns the translate function.
- ai-elements is a chat component library — it has no sidebar/navigation/forms/list items; build
  non-chat UI with shadcn primitives, do not force ai-elements onto them.

## 9. Verification discipline (distilled from session records)

- Every change's DoD must be verified by a real run (log/screenshot evidence), never assumed;
  commit after each completed phase.
- For UI/runtime changes, compiling is not enough: verify live with `pnpm run dev`. OOMOL scenarios
  require login; signed-out custom-model and independent Link-runtime status scenarios do not.
- Changes to the vite build config must preserve the invariants: build output defaults to
  oomol.com, is unaffected by `.env.local`, and only an explicit `WANTA_ENDPOINT` can override it
  (verification: run build with `.env.local=oomol.dev`, then grep the output).
