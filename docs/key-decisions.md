# Decision log: background → decision → rationale → consequences

> Source: development session records + verification against current code. Only major
> direction-changing decisions are recorded, organized by topic — **this is not a changelog**: no
> commit hashes (use `git log` to search by topic when needed), and do not append entries for each
> new commit. Related: [architecture.md](architecture.md) · [project-overview.md](project-overview.md)

## 1. Engineering mirrors oo-desktop wholesale

- **Background**: building an Electron repo from scratch, while OOMOL already had a mature
  oo-desktop.
- **Decision**: create a standalone repo (not a fork), but replicate oo-desktop entirely for
  vite/electron/tsconfig/oxlint/oxfmt/packaging/signing/CI/postinstall (download-electron)/IPC
  service split (`@oomol/connection` + common.ts/node.ts)/frontend stack (React 19 + shadcn +
  Tailwind 4).
- **Rationale**: the two apps' UI stays coherent, maintenance cost is shared, and CI secret names
  carry over directly (`MACOS_CERTIFICATE` / `APPLEID`, etc.).
- **Consequences**: highly predictable architecture; but oo-desktop's pitfalls come along with it
  (e.g. the `open-url` cold-start bug, see §4), and there are deliberate divergences: the connector
  auth header uses `Bearer` (without `x-oomol-user-uuid`), and i18n is a lightweight in-house
  implementation instead of `@embra/i18n`.

## 2. Agent kernel = OpenCode local sidecar

- **Background**: research compared five modes: cloud loop + thin client, local sidecar server
  (OpenCode), Pi embedded in-process, AI SDK thin loop, stdio/ACP. The cloud loop scored highest
  but was vetoed by the user (no appetite for cloud operations, wanted a fast POC); the Claude
  Agent SDK was explicitly ruled out by the user; Pi lost mainly because the approval/permission
  layer would have to be built entirely from scratch, plus its 0.x breaking iteration.
- **Decision**: spawn the published binary `opencode-ai@1.17.13` as a sidecar; the main process
  drives it via `@opencode-ai/sdk@1.17.13` over HTTP+SSE; pure-configuration customization
  (full replacement of the custom agent prompt + `.opencode/tools/` custom tools), zero source
  modifications. **Do not use the SDK's `createOpencodeServer`** — spawn it ourselves: the former
  allows no control over binary path/env/cwd, and in production packaging opencode-ai is not in
  node_modules (the binary ships via extraResources).
- **Rationale**: OpenCode brings a built-in permission model + session infrastructure +
  company-backed maintenance; importing it as a library was not viable (at research time all
  server-related packages were private; `opencode-ai` is a pure bin package); vendoring the
  monorepo carried a heavy maintenance burden (~41 commits/day upstream at the 2026-05 research,
  with no API compatibility promise).
- **Consequences**: the three packages are pinned at `1.17.13`, floating forbidden; the sidecar
  must run in isolated directories (`XDG_*` pointed at userData, otherwise it reads the global
  `~/.config/opencode` and leaks local machine config); the default system prompt is selected by
  model ID (a coding persona), so it must be fully replaced via the agent `prompt` field.

## 3. Connector calls all go through the bundled oo binary

- **Background**: oo-cli runs on Bun, with ~30 source files deeply coupled to Bun-only APIs, and
  cannot be imported into Node/Electron.
- **Decision**: bundle the platform binary via electron-builder `extraResources`; control it solely
  through `OO_*` environment variables (R3); authorization signaling uses structured tool results
  (R5): `call_action` parses the `errorCode: <code>` token from stderr, and on an
  authorization-blocking code returns `{status:"authorization_required", authUrl}` — **never parse
  the model's free text**.
- **Rationale (connector exposure strategy, research conclusion)**: registering all ~600 providers
  as tools is a dead end — model tool-selection accuracy drops significantly beyond 30–50 tools;
  hence the hybrid approach of "inject only an authorized-existence hint (R4, no specific provider
  names by default) + list/search/inspect/call meta-tools for progressive disclosure" — **do not
  re-propose per-provider tool generation or full registration**.
- **Consequences**: oo-cli 1.2.0 had to implement the full `OO_*` variable set first (once an
  undeclared hard precondition, later closed by an upstream release — this behavior comes from
  oo-cli 1.2.0 live testing + upstream release records; oo is a black-box binary this repo cannot
  re-verify, so re-validate on every oo upgrade); `OO_SKILLS_SYNC_DISABLED=1` must be set or oo
  writes to the user's home directory on every run (`~/.claude`, `~/.agents`, etc., verified on
  1.2.0).
- **Reliability addendum**: the Link action must not treat a model-typed display name as a
  connection locator; an explicit `connectionName` must first be validated against the current
  workspace's connection list. For batches of same-target actions, `call_action` runs a canary
  first, then bounded concurrency, and applies a short-term circuit breaker to queued calls after
  hitting an authorization block. The chat layer aggregates CTAs by connection issue; if the same
  connection target succeeded earlier in the turn and later returns an authorization error, the
  product semantics are "the connection became unavailable or connector state is inconsistent" —
  do not assert the user never authorized.
- **Later evolution (bundled tool runtime)**: the custom tool sources now import
  `"../runtime/tool.js"` instead of depending on `@opencode-ai/plugin` directly — postinstall's
  `scripts/build-agent-tool-runtime.ts` uses rolldown to bundle the tool helper + Zod into
  `resources/agent-tool-runtime/tool.js` (entry `scripts/agent-tool-runtime-entry.ts` merely
  re-exports `@opencode-ai/plugin/tool`), and `workspace.ts` atomically places it at
  `<workspace>/.opencode/runtime/tool.js`, so tool loading no longer depends on OpenCode installing
  npm packages from the network on first start.

## 4. Login flow correction: OO_API_KEY env → browser login

- **Background (what was wrong)**: the original implementation read `process.env["OO_API_KEY"]` at
  startup; without that variable the app opened but nothing worked, and there was no login entry —
  unusable for end users.
- **Decision**: switch to a browser login flow (console launcher → deep-link return → authID
  exchanged for the `oomol-token` session token → profile persisted to `auth.json` →
  `applyAuthAccount` dynamically assembles the agent). Full 5 steps and credential details:
  [architecture.md §6](architecture.md) (the single authoritative description of the current flow).
- **Follow-up revision (credentials unified on the session token)**: the original scheme used the
  session token to fetch a **long-lived default-api-key**, persisted it, and fed it to the
  agent/connectors, with only billing on the session token — producing a split where "chat works
  but usage is unavailable" when the session expired, plus the insecurity of a long-lived key on
  disk. Now the **session token is used throughout** (the gateway layer accepts
  cookie/token/api-key uniformly); no api-key is fetched or persisted anymore; token expiry means
  globally logged out and requires re-login (a consistent lifecycle). `auth.json` stores only the
  profile.
- **Rationale**: the flow is identical to oo-desktop (only the scheme name differs), reusing a
  proven pattern.
- **Consequences (multi-agent adversarial review confirmed 13 issues, all fixed; highlights)**:
  - macOS cold-start losing the login callback: `open-url` fires before ready with no buffering →
    listener registration moved up to module top level (same bug unfixed upstream in oo-desktop).
  - Login CSRF: any local program can push a deep link with a forged authID to silently switch
    accounts → because the launcher returns no verifiable state/nonce, **every** browser login
    callback — including app-initiated ones with a pending login — must confirm the account
    identity via a system dialog; canceling the confirmation rejects the pending login.
  - RPC credential leak: `@oomol/connection` registration exposes everything → credential logic
    moved into the **unregistered** `AuthManager`; only a thin facade is registered.
  - Assembly race → everything goes through `applyChain` serialization + same-credential
    idempotent short-circuit.
  - Known limitations (accepted tradeoffs explicitly marked "not fixing, record only" at the time):
    - Chat history lives in a fixed `userData/agent`; multiple accounts share one session history
      (on account switch the AppShell remounts the whole tree, which only resets UI state — it
      **does not isolate session storage**).
    - When agent startup fails, the UI stays at "Agent starting…" with no retry button
      (recoverable via re-login; failures no longer leave zombie state).

## 5. Removing dynamic endpoint switching

- **Background**: phase 5 implemented runtime switching between oomol.com/oomol.dev, but the
  business has no switching need, and it introduced a lot of race-handling code; there is also a
  hard constraint: **externally distributed artifacts must not grep `oomol.dev`** (prevents
  leaking the internal development domain).
- **Decision**: the endpoint became the vite `define` compile-time constant `__OO_ENDPOINT__`;
  `electron/domain.ts` collapsed to a single constant + template-string derivation of all base
  URLs; invisible and unswitchable at the app layer. `resolveOoEndpoint` priority: explicit
  `WANTA_ENDPOINT` environment variable (**effective in every mode, including build**) >
  `.env(.local)` read only in dev/serve (**build deliberately reads no files** — what gets ignored
  is only `.env` files, not environment variables) > default `oomol.com`. Tests were migrated from
  `node --test` to vitest in the same change (native vite define support, no runtime injection
  hack).
- **Rationale / lesson**: a second-round loadEnv change once introduced a regression — a local
  `.env.local=oomol.dev` running build would bake the dev domain into the artifact (caught by
  adversarial review); the final fix was the more fundamental invariant "build reads no files",
  not a CI grep guard.
- **Consequences**: removed the switching abstraction across ~15 files (`setEndpoint` /
  `reconfigure` / `supportedEndpoints`, etc.); `auth/store.ts` gained `migrateLegacyAccounts()`,
  which drops historical accounts that don't match the current build endpoint; the `oomol.dev`
  literal is allowed in **code and config** only in three places that never ship
  (a vite.config.ts comment, .env.example, store.test.ts); documentation is exempt (docs/ and the
  root guide — AGENTS.md / CLAUDE.md, one file under two names via symlink), so a grep guard, if
  added, should exclude docs.

## 6. oo CLI invocation failure fix: node_modules binary → self-managed `.oo-bin/`

- **Background (root cause)**: agent connector tool calls failed with `spawn .../oo EACCES`. The
  upstream `@oomol-lab/oo-cli-*` platform package tarballs shipped `bin/oo` itself as 0644
  (published without +x); in dev, `which oo` hit the `node_modules/.bin` wrapper, and the wrapper
  spawned a binary without the execute bit → EACCES. Production always worked because
  `prepare-binaries.ts` chmods 0755 while copying — a dev-only problem.
- **Decision**: remove the `@oomol-lab/oo-cli` npm dependency; `OO_CLI_VERSION` in
  `scripts/oo-cli.ts` is the single source of truth for the current version, and that script
  centralizes the platform/libc mapping, a hand-written ustar extractor, npm packument
  `dist.integrity` sha512 verification, atomic placement, and `chmod 0o755`. Postinstall
  (`scripts/download-oo.ts`, best-effort) downloads into the gitignored `.oo-bin/`, shared by dev
  and packaging. Dev resolution order: `WANTA_OO_BIN` override > `.oo-bin/oo`; `which oo` was
  removed. The opencode source was switched to `node_modules/opencode-ai/bin/opencode.exe` in the
  same change (fixing a pre-existing Windows package-name error: upstream is
  `opencode-windows-x64`, not `win32`).
- **Rationale (rejected alternative)**: adding an `existsSync` pre-check in the main process was
  vetoed by the user — **sync fs is banned in the main process (it blocks the renderer)**;
  instead, a `predev` guard `scripts/check-oo.ts` (standalone CLI scripts may use sync fs). This
  has since become a project hard rule.
- **Consequences**: upgrading oo means changing only `OO_CLI_VERSION`; with `.oo-bin/oo` missing
  the app still launches (the error surfaces only as JSON returned to the model on the first tool
  call) — exactly why the predev guard exists. The managed-binary set later grew a third member:
  postinstall also downloads ripgrep (`scripts/download-ripgrep.ts`) into `.oo-bin/`,
  `prepare-binaries.ts` copies opencode + oo + rg together into `resources/bin/`, and AgentManager
  prepends that directory to `PATH` so OpenCode's built-in grep tool can use it.

## 7. Markdown rendering + system prompt + tool-call UI

- **Background**: three parallel problems — assistant messages rendered as plain text without
  Markdown; the tool-call UI was too prominent; the model guessed connector parameters (instance:
  hackernews `get_item` was passed `item_id` while the schema requires `id`, and
  `additionalProperties:false` rejected it).
- **Decision**:
  - The parameter problem's root cause was the toolset lacking schema-query capability
    (`search_actions` does not return inputSchema); prompt-only fixes treat the symptom → added a
    third tool `inspect_action` (`oo connector schema "<service>.<action>" [...] --json`; from oo
    1.3.0, dot-notation id addressing and batch fetching of multiple contracts in one call; 2+ ids
    return a JSON array in request order); the prompt mandates the **search → inspect → call**
    flow, and inputSchema is the single source of truth for parameters. After oo-cli 1.4.2
    provided `oo connector apps --json --organization`, `list_apps` was added specifically to
    answer the current team's connected provider/app list, so catalog search stops being misused
    as a connection-status query. The custom toolset has since grown a fifth tool,
    `query_knowledge`: read-only queries against WikiGraph knowledge bases pinned to the session
    (operations: inspect/search/related/evidence/pack), with session-level access control via
    `WANTA_KNOWLEDGE_REGISTRY` / `WANTA_TEAM_SCOPE_PATH` (a knowledge base not pinned to the
    current session is refused); it relies on the `wiki-graph` package, with runtime paths
    injected via `WANTA_WIKIGRAPH_EXECUTABLE` / `WANTA_WIKIGRAPH_CLI`.
  - Prompt layering (R4): the stable persona/tools/contracts live in agent.prompt to benefit from
    prompt caching; the per-turn-changing authorized-existence hint goes through dynamic
    `body.system` injection, with no specific provider names by default. That same `body.system`
    channel now also carries per-turn team-skill injection (`buildTeamSkillsSystem`) and the response
    language policy (`buildResponseLanguageSystem`). The language policy follows the latest
    substantive user request for every user-facing agent message and uses the application locale only
    as a fallback. Bundled skills are distributed via postinstall (`scripts/download-skills.ts`) →
    exported to `resources/skills/` by prepare-binaries → rebuilt into the workspace's
    `.opencode/skill/` by `syncBundledSkills`.
  - Markdown via react-markdown@10 + remark-gfm (no rehype-raw, keeping HTML escaping to prevent
    XSS); the main process also gained external-link handling (`setWindowOpenHandler` +
    `will-navigate` sharing `openExternalUrl`, whitelist http/https/mailto/tel — mailto/tel were
    added after adversarial review found links "clickable but unresponsive").
  - Tool-call UI collapses to a one-line summary by default; click to expand params/results.
- **Consequences**: the backend parts (inspect_action, the prompt contract, external-link
  handling) live on; the frontend Markdown/collapse UI was later replaced in the ai-elements
  migration (react-markdown removed).

## 8. UI framework migration to ai-elements

- **Background**: the user's goal was "replace all frontend components with ai-elements"
  (Vercel's AI chat component library distributed via the shadcn registry).
- **Decision**: **vendoring, not CLI installation** — registry canonical sources hand-landed into
  `src/components/ai-elements/` and trimmed (the CLI assumes Next.js; the original prompt-input
  was 37KB deeply coupled to unused Radix primitives). Markdown rendering switched to streamdown
  (built into MessageResponse). **Migration boundary (the user's call)**: migrate only the parts
  with a real counterpart, i.e. the chat interface; sidebar/login/connector list/forms keep shadcn
  primitives (ai-elements has no such components — do not force totality).
- **Rationale**: control the dependency surface (new Radix confined to
  collapsible/input-group/slot); keep sources canonical for side-by-side upgrades
  (`.claude/skills/ai-elements/references/` is the authoritative API reference,
  `skills-lock.json` records source hashes).
- **Consequences (13-agent review confirmed 9 runtime issues, fixed)**: Enter during streaming
  only sent instead of stopping (was a HIGH regression); after the tool-call UI migrated to the
  `Task` collapsed summary, the unwired standalone Tool component was removed — CodeBlock,
  however, was later reintroduced and is in active use (shiki highlighting, serving messages and
  the artifact preview); Tailwind v4 does not scan node_modules, so `@source` declarations are
  required — they now live in `src/styles/theme.css`: `@source "../../node_modules/streamdown/dist"`
  and `@source "../../node_modules/@streamdown/mermaid/dist"`; the vendored directory gets an
  oxlint override (`react/only-export-components` off).

## 9. Opening up tools permissions and wiring in two-tier local access

- **Background**: the early agent was positioned as a "non-coding connector assistant" with all
  built-in tools blocked. Consequence: it could not answer "what files are on my computer", nor
  write scripts to combine multiple actions' JSON results.
- **Decision (the current permission model)**: lift the "three-layer lockdown" (each layer
  necessary) — ① delete the `DENIED_BUILTIN_TOOLS` table (all built-in tools enabled by default);
  ② when OOMOL is the Link runtime, the Build agent, the Plan agent, and root-level permission gate
  local shell through the shared `OO_CLI_BASH_PERMISSION` pattern table rather than a flat `ask`:
  default `"*": "ask"`, but pure oo CLI invocations (`oo`, `oo *`, `$WANTA_OO_BIN` and their
  quoted variants) are `allow` — a deliberate fast path for the bundled CLI. OpenConnector keeps
  shell at `ask` so ChatService can protect credentials and injected runtime configuration while
  automatically approving ordinary built-in oo business operations. Only `external_directory`
  (and `edit` in Build) is unconditionally `ask`; `edit` in Plan allows only
  `.opencode/plans/*.md`; both levels also carry `webfetch: "allow"`;
  ③ `event-translator.ts` translates the `permission.asked` / `permission.v2.asked` and replied
  events; ChatService exposes pending-permission queries and reply; ④ ChatService in the main
  process holds the local access policy: Default Access treats bash as a normal working channel,
  auto-approving ordinary shell commands, scripts, project checks, data processing, simple output
  filtering, ordinary file reads/writes, and specific non-sensitive paths; only fundamental
  security boundaries are pushed to the renderer for confirmation — credential/key paths, broad or
  recursive home/system scans, destructive deletion, global/system or alternate-source dependency changes, privilege
  escalation, `git push/reset/clean`, publish/deploy, infrastructure changes, and the like.
  Sensitive-resource checks take precedence over generic directory session grants; a generic grant
  can never green-light a high-risk request. Full Access can still take over the session's
  permissions after a single confirmation. The renderer only displays the pending UI, syncs the
  access mode, and relays the user's choice; ⑤ the system prompt was fully rewritten as
  dual-capability (connector meta-tools + local tools) with dynamic additions per access mode —
  opening the tools without changing the prompt leaves the model refusing itself.
- **Rationale (key constraints)**: OpenCode permission values are `ask | allow | deny`. Wanta's
  product layer does not expose fine-grained permissions, sparing users from understanding
  per-built-in-tool rules; underneath, OpenCode ask still gates high-risk local actions. **Do not
  change the sidecar cwd** (connector tools depend on `userData/agent/workspace/.opencode/tools/`);
  accessing real files still uses absolute paths/`~` and hits the permission boundary via
  `external_directory: "ask"`.
- **Consequences**: the current security posture converged from "any shell / file IO / network
  access with zero confirmation" to "under Default Access, bash and ordinary file capabilities
  flow smoothly, pausing only at real risk boundaries". Users need not approve `oo ... | head`,
  `npm test`, `rg`, data-processing scripts, or ordinary Desktop/Downloads files one by one;
  specific non-sensitive file reads stay smooth, and only broad scans of the whole home/system
  root prompt. Unscoped, global/system, or alternate-source dependency changes, reading credentials/keys, browser login state,
  mail/messages/contacts/calendar data, recursive or destructive deletion, storage overwrite,
  privilege escalation, push, deploy, remote repository deletion, and infrastructure or recursive
  cloud-storage destruction still require confirmation; such sensitive reads take precedence over
  generic directory session grants and cannot be silently waved through because the user once
  allowed a parent folder. To keep
  coding and document tasks from drowning in back-to-back approvals, dependency approval follows
  execution scope and package source rather than a reviewed popularity list: direct Python
  requirements only through the turn-private `.wanta-python` interpreter, and direct
  standard-registry Node.js packages only through npm/pnpm/yarn/bun commands explicitly targeted at
  the turn process directory or selected project. Normal extras and version constraints are
  accepted without Wanta pinning a version. Package runners are ordinary local execution rather
  than a separate high-risk class. The user can still issue a task-level grant for no-argument or
  other standard Node.js dependency operations explicitly targeted at the selected project; those
  grants do not outlive their intended task/session scope. Global installs, custom registries,
  alternative indexes, user config, Git/URL/local sources, requirements files, `--user`,
  `--break-system-packages`, system Python, and explicitly high-cost runtimes remain protected.
  Default Access is a risk policy rather than an OS sandbox; package-name matching cannot provide
  process isolation once ordinary Python, Node.js, and shell execution is available. If sensitive
  paths (browser profiles, mail databases, more credential
  directories) or external side-effect classification are refined further in the future,
  `config.ts`, the ChatService local access policy, the access-mode UI, the event tests, and
  [conventions.md §7](conventions.md) must be updated in sync. If permissions are ever
  re-tightened: OpenCode permission **gates built-in tools only** — `bash: deny` does not cut off
  `.opencode` custom tools (connector meta-tools spawn oo regardless, see
  [conventions.md §7](conventions.md)).

## 10. Questions = runtime pending requests, not a frontend recovery state machine

- **Background**: after wiring up OpenCode `question.asked`, the renderer once maintained
  stopped/recoverable/dismissed/localStorage state for exception flows — continue after stop,
  restore after refresh, dismiss after cancel, dedup on restore — reconciling from three places:
  backend pending, message history, and local cache. The result was too many sources of truth: a
  historical question tool could be restored by the frontend into an interactive question while
  the sidecar was not necessarily still waiting on that same request.
- **Decision**: questions recognize only the main process/sidecar's current pending question.
  `getPendingQuestions()` and the `question.asked` event are the sole interaction source of truth;
  historical question tools display as history only. User submission goes through
  `answerQuestion`; user cancel goes through `rejectQuestion`, which rejects only the current
  request and does not implicitly stop the generation; only when the user explicitly stops the
  generation is the current pending-question UI cleared. Drafts stay in-memory only, never
  restored across restarts. `rejectQuestion` has a short timeout guard so the UI cannot hang, but
  a timeout does not auto-abort the run.
- **Rationale**: a question is fundamentally an agent runtime interrupt — not an ordinary chat
  message, and not a permission prompt. Without backend checkpoint/run-state support, faking
  "continue the previous turn" on the frontend from message history and localStorage manufactures
  inexplicable intermediate states. To support answering after a refresh in the future, there must
  first be a durable pending request whose same `requestId` the main process/sidecar can restore;
  until then, only expired/resolved history can be shown.
- **Consequences**: the question recovery state machine and resume-message splicing logic were
  deleted; the state boundary converges to "show it while the backend is still waiting, otherwise
  treat it as history". The system prompt constrains the model in tandem: ask narrowly only when
  missing information would materially affect the result, block a necessary action, or create
  risk; after the user rejects/cancels, do not re-ask verbatim — make safe assumptions, skip
  optional actions, choose the lower-risk path, or state the blocker.

## 11. Beta/Stable dual release channels

- **Background**: daily builds needed to go out on a beta channel and official releases on stable,
  with users able to switch both ways in Settings (default stable). oo-desktop is single-channel
  (only latest\*.yml), so there was no precedent to copy — a deliberate divergence from the §1
  mirroring strategy (cf. the Bearer header / i18n precedents).
- **Decision**: use electron-updater's generic-provider native channel mechanism — beta version
  numbers are `X.Y.Z-beta.N` (baseline = max(latest stable patch+1, highest existing beta
  baseline), computed by `scripts/release-version.ts` with anti-rollback validation);
  electron-builder automatically emits `beta*.yml` alongside `latest*.yml` in the same directory;
  client channel = `user setting ?? derived from own version`, selecting the pointer file via the
  `channel` field of `setFeedURL`. `generateUpdatesFilesForAllChannels` is enabled: stable builds
  also refresh `beta*.yml`, so beta users converge immediately after an official release (single
  exception: when stable is below an existing beta baseline, CI skips the beta pointer to prevent
  rollback).
- **Rationale (three key constraints)**: ① patch+1 is the only safe baseline — it is the minimum
  possible value of the next official release, guaranteeing any future stable exceeds the live
  beta; convergence does not depend on predicting the next version number; ② **do not use the
  `autoUpdater.channel` setter** — it silently flips `allowDowngrade` to true (electron-updater
  AppUpdater source), conflicting with "switching beta→stable waits for the next official release
  by default and never auto-downgrades"; hence the channel goes through `setFeedURL` configuration
  with an explicit `allowDowngrade=false`; ③ immediate downgrade was rejected — electron-updater
  offers no protection whatsoever for post-downgrade data compatibility (the opencode sidecar
  session/storage schema is written by the newer version); waiting for convergence is the
  officially aligned (roll-forward) safe path.
- **Consequences**: release discipline got heavier — the rclone include whitelist is tightened per
  channel (beta never touches `latest*.yml`), the CDN purge manifest is computed per channel, and
  mac/win each carry hard channel-yml validation; a missing channel yml on the generic provider is
  a hard error (no fallback), so `beta*.yml` must always exist in both platform directories; the
  stable auto-bump must filter beta tags (bash arithmetic explodes on `-beta`, now locked in as a
  release-version.ts regression case); `electron-builder`/`electron-updater` are pinned exactly
  because channel behavior is version-sensitive.

## 12. OpenConnector is a separate Link runtime, not a sign-in or model runtime

- **Background**: Wanta originally derived connector capability, OOMOL model access, account state,
  team identity, Skills, billing, and Connections UI from one `cloudRuntime` branch. OpenConnector
  implements the compatible connector runtime API and oo CLI contract, but supplies neither an LLM
  nor an OOMOL account. Adding it to that union would make valid combinations such as an OOMOL model
  with OpenConnector impossible and would leak OOMOL team behavior into a self-hosted endpoint.
- **Decision**: resolve three independent axes: account/cloud capabilities, model access/choice, and
  one selected Link runtime. The Link runtime is OOMOL, a user-configured OpenConnector, or none;
  catalogs are not merged and there is no fallback between them. OpenConnector configuration lives
  behind an unregistered main-process manager. Its optional runtime token is `safeStorage`-encrypted,
  bound to the normalized API origin, and never returned to the renderer. The existing bundled oo
  binary remains the only Agent connector transport.
- **Rationale**: this preserves signed-out custom-model + OpenConnector use, keeps provider and admin
  credentials in OpenConnector, and avoids duplicating hundreds of connector contracts or moving a
  bearer token into the renderer. One active backend also keeps action identity, authorization
  routing, connection aliases, cache keys, and idempotency unambiguous.
- **Consequences**: tools, prompts, permissions, workspace contents, capability reporting, inventory,
  and authorization UX must switch together. OOMOL retains team-scoped `--organization`, bundled oo
  Skills, the in-app connection drawer, and automatic authorization retry. OpenConnector removes
  team identity and bundled oo Skills and uses an external provider page. Its direct bundled oo
  business commands are automatically approved by ChatService, while credential expansion,
  environment dumps, authentication/configuration mutation, and injected runtime overrides are
  denied. OOMOL Skill registry maintenance remains account-owned even while OpenConnector is
  selected.
