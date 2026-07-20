# Project Overview: What Wanta Is, Why, and Its Place in the Ecosystem

> Related: [architecture.md](architecture.md) (how it is implemented) · [key-decisions.md](key-decisions.md)
> (why it is implemented this way)

## 1. Product Positioning

Wanta is an Electron desktop AI Agent chat client. The user states a need in natural language; the Agent
interprets it and orchestrates the OOMOL connector cloud service (~600 SaaS providers, 6000+ actions),
local tools, and any WikiGraph knowledge bases the session references, streaming results back into the
chat area. Local capabilities are now enabled (bash / file read-write / writing and executing scripts);
the typical pattern is "pull data from several connector actions → write a small script to
join / aggregate / format".

- **Target users and the problem solved**: non-developers (knowledge workers in operations, analytics,
  administration, and similar roles). Their data is scattered across SaaS services (GA, email, issue
  trackers, spreadsheets, storage, ...); manually pulling, reconciling, and summarizing across services
  is tedious and hard to automate. Wanta turns all of that into one natural-language sentence —
  authorize once, and from then on the Agent discovers actions, inspects schemas, calls them, and
  organizes the results on its own.
- **Core data flow**: user message → OpenCode Agent → OOMOL connector (via the `oo` CLI) / local tools →
  streamed reply.
- **UI shape**: three-pane layout — left: session navigation (create/delete/rename/switch across
  sessions; the settings entry lives here); center: the main content area, switching across eight shell
  routes (`archived` / `billing` / `chat` / `connections` / `knowledge` / `teams` / `skills` /
  `settings`) — chat renders streamed Markdown plus collapsible tool-call steps, and Connections is a
  standalone page route (connected providers, new authorization) with an additional on-demand in-chat
  connection drawer (`AppShellConnectionDrawer`); right: the collapsible Artifacts panel (task outputs)
  with a draggable, keyboard-operable splitter — width is adjustable and the panel can be maximized
  (the original "fixed ratios, no drag handles" lock no longer holds).
- **Product surface beyond chat**: team workspaces (connector requests attach the
  `x-oo-organization-name` header when a team workspace is active); projects (a `ProjectContextBar`
  with git-branch integration); a skills system (skills bundled at `Resources/skills` and copied into
  the OpenCode workspace); billing/usage pages; and knowledge bases (Beta — see the WikiGraph row
  in §2).
- **Golden path** (the primary use case that drove acceptance throughout development): connect Google
  Analytics → type "check the site's PV for the last 7 days" → the Agent knows GA is authorized and
  calls it directly → the result streams back into the chat area.
- **Selling points**: SaaS credentials are OAuth-ed once, then encrypted and hosted in the cloud — the
  local machine only receives results and never persists plaintext credentials. Task outputs are
  preserved as artifacts (see §5), surfaced in the right-hand Artifacts panel; main-process support
  lives in `electron/artifact-resource/`.

## 2. Relationship to the OOMOL Ecosystem

| Component         | Relationship                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **OOMOL cloud**   | LLM gateway (`https://llm.<endpoint>/v1`; the built-in default is Auto, i.e. `oomol/oopilot`, and the GPT 5.5 option is `openai/gpt-5.5` — six built-in models in total, also including DeepSeek V4 Flash/Pro and Qwen 3.7 Plus/Max, see `electron/models/builtin.ts`); connector gateway (`https://connector.<endpoint>`); console (authorization management; `console.<endpoint>/launcher` is the browser login page); api (account API); org-control (team control); console-server (console API); insight (usage/balance); registry and search (skills registry/search); static (auto-update distribution); chat-as-proxy-dev (voice transcription). All derived from the single endpoint by `electron/domain.ts` (the authoritative list). A second build-time constant `__PACKAGE_ASSETS_BASE_URL__` (`packageAssetsBaseUrl`) serves skill asset files, and `externalModelProviderBaseUrls` holds fixed base URLs for third-party model providers (DeepSeek / Gemini / OpenRouter / Zhipu / Kimi / MiniMax / Qwen / Xiaomi) that are deliberately **not** derived from the endpoint. |
| **oo CLI**        | The only channel through which the Agent calls connectors. Bundled as a black-box **binary** (dev in `.oo-bin/`, packaged into `Resources/bin`), controlled solely via `OO_*` environment variables (`electron/agent/oo.ts`); its source is never modified. The version is pinned in one place: `OO_CLI_VERSION` in `scripts/oo-cli.ts`. **No longer an npm dependency** — session records show it once depended on `@oomol-lab/oo-cli`; EACCES problems led to a project-managed download instead (see [key-decisions.md §6](key-decisions.md)). oo-cli runs on Bun and cannot be imported into Node/Electron; turning it into a library was rejected (argument in [key-decisions.md §3](key-decisions.md)).                                       |
| **OpenConnector** | Open-source sibling in the same connector ecosystem ([github.com/oomol-lab/open-connector](https://github.com/oomol-lab/open-connector)). Wanta uses the same shared connector ecosystem as OpenConnector.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| **WikiGraph**     | The parsing and retrieval runtime for local `.wikg` knowledge bases. `wiki-graph@0.3.0` ships as an exact-version project dependency; the main process and the Agent's custom read-only tool both execute its CLI via Electron's Node mode; knowledge-base files are copied to `userData/knowledge-bases/files` for unified management. Currently a Beta feature, off by default — the knowledge-base menu appears and sessions may reference knowledge bases only after the user enables it in Settings; the toggle persists in the local `settings.json`. Sessions persist only knowledge-base IDs and never send the raw archive as a chat attachment.                                                                                         |
| **oo-desktop**    | Sister app + engineering baseline (separate repository, not inside this repo; local path varies per dev machine). Wanta was created as a new standalone repository (not a fork), but build/packaging/CI/IPC service layout/UI style all align with oo-desktop so the two apps' UIs stay coherent and maintenance cost stays low. Mind the known difference: connector auth headers (Wanta uses `Authorization: Bearer <session token>` **without** `x-oomol-user-uuid`; oo-desktop sends the auth.toml account key as a bare header — do not copy it).                                                                                                                                                                                            |
| **OpenCode**      | The Agent kernel. Spawns the published binary `opencode-ai@1.17.13` as a sidecar; the main process drives it over HTTP+SSE via `@opencode-ai/sdk@1.17.13`. Pure configuration-level customization, zero source modification. At research time (2026-05) no community precedent was found for using OpenCode in non-IDE / general-agent workloads; Wanta was the first known case (positioned as a non-coding agent at inception; local coding capability was opened up later).                                                                                                                                                                                                                                                                   |

## 3. Original Plan vs Shipped

The original plan document `WANTA_PROJECT_PLAN.md` (a historical document that existed only on the
original dev machine — no copy in the repo; its rules and phase numbering are preserved in
[conventions.md §1](conventions.md)) defined 7 phases (Phases 0–6) and 8 global rules R1–R8. Session
records show that the first 7 commits delivered Phases 0–6 one by one, followed by unplanned fixes and
evolution (arc in §4). The main divergences between plan and outcome:

| Planned                                                                                                        | Shipped (current state)                                                                                                                                                                                                                                                                                                       |
| -------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Credentials injected via the `OO_API_KEY` environment variable; no login required                               | Replaced by a browser login flow (console launcher → deep-link return → exchange for the `oomol-token` session token; used exclusively throughout — `auth.json` stores only the profile, no credentials persisted to disk)                                                                                                     |
| Endpoint switchable at runtime between `oomol.com` / `oomol.dev` (Phase 5 even wired up `setEndpoint`)          | **Removed entirely**: the endpoint is the build-time constant `__OO_ENDPOINT__`, invisible and unswitchable at the app layer                                                                                                                                                                                                    |
| Strictly non-coding agent: deny all built-in coding tools, keep only connector tools                            | **Opened up but controlled**: OpenCode built-in tools are enabled; under Default Access, bash, ordinary file read/write, and specific non-sensitive paths flow without friction, while only the baseline safety boundaries — credential/secret paths, destructive deletion, dependency installation, privilege escalation, pushing, publishing/deploying, etc. — require approval via an in-chat confirmation card |
| Custom tools were only `search_actions` / `call_action`                                                         | Grew to five custom tools: added `inspect_action` (enforcing inspect-before-call), `list_apps` (directly lists connected apps in the active workspace), and `query_knowledge` (read-only WikiGraph knowledge-base queries)                                                                                                     |
| Front end: hand-written chat UI on shadcn/ui                                                                    | Chat UI migrated to vendored ai-elements components; Markdown rendering switched from react-markdown to streamdown                                                                                                                                                                                                              |
| Tests on Node's native `node --test`                                                                            | Migrated to vitest (alongside the endpoint constant change — vitest natively applies vite define)                                                                                                                                                                                                                               |

Locked decisions that held: Agent kernel = OpenCode sidecar; all connector traffic through the oo CLI;
LLM gateway derived from the endpoint; authorization state sourced from `/v1/apps`; deep link
`wanta://signin` (dev `wanta-local`); IPC over `@oomol/connection`. (The original "three panes, no drag
handles" lock did not survive: the layout has since evolved into a right-hand Artifacts panel with a
draggable resize splitter — see §1.)

## 4. Git History Arc

> This section describes the evolution arc only and **does not maintain a per-commit list** (use
> `git log --oneline` for hashes and the full list); do not append entries as new commits land.

The first 7 commits delivered Phases 0–6 one by one, with commit messages matching the phase names:
scaffolding (mirroring oo-desktop) → Agent-kernel headless golden path → chat UI and streamed
rendering → Connections panel and OAuth → dynamic prompts + in-chat authorization loop (R4) → settings
and endpoint switching → packaging/signing/notarization/auto-update/CI.

Unplanned fixes and evolution followed: login fix (browser login flow) → removal of dynamic endpoint
support → oo-cli fix (self-managed `.oo-bin`) → Markdown rendering + system prompt + tool-call UI
fixes → right-side connections UI polish → UI framework migration to ai-elements → tools permission
opened up and consolidated into the two-tier Default Access / Full Access model. The "why" behind each
node is in [key-decisions.md](key-decisions.md).

## 5. Glossary

- **connector / provider / action**: the SaaS integration units of the OOMOL cloud — a provider is a
  service (e.g. `hackernews`), an action is a callable operation under it (e.g. `get_item`); the agent
  lists connected apps in the current workspace with `list_apps` and progressively discovers and calls
  actions via search/inspect/call.
- **artifact**: a task output the Agent produces and preserves (rather than losing it in chat scroll),
  surfaced in the right-hand resizable Artifacts panel; main-process support lives in
  `electron/artifact-resource/`.
- **sidecar**: the local `opencode serve` child process started with the app — an HTTP+SSE service
  hosting the agent loop.
- **endpoint**: the OOMOL primary domain (`oomol.com` / internal development `oomol.dev`), fixed at
  build time; all subdomains derive from it.
- **golden path**: the GA→PV use case above; all phase acceptance during development revolved
  around it.
- **R1–R8 / Phases 0–6**: the rule and phase numbering from the original plan, scattered through code
  comments; see [conventions.md §1](conventions.md).
