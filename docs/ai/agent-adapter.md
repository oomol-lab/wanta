# Agent adapter contract (BYOA)

> Read this before touching `electron/agent/contract/` or adding/changing any agent integration.

## What this layer is

Wanta supports bringing your own coding agent (BYOA). Every agent — the built-in
OpenCode kernel, Claude Code, ACP agents — sits behind one interface,
`AgentAdapter`, defined in `electron/agent/contract/adapter.ts`:

- `send(AgentInput)` — the single inbound channel
- `onEvent(AgentEvent)` — the single outbound channel
- `start()` / `stop()` — lifecycle
- `profile` — static capability declaration (`AGENT_PROFILES` in `contract/profile.ts`)

`ChatAgentBackend` in `contract/chat-backend.ts` is the composed host-facing
surface used by the chat service after session routing. It adds history and
pending-interaction reads without putting OpenCode-only deep features into the
protocol adapter contract. Shipping external agents, including Claude Code,
are registry-backed ACP agents built on `ExternalAgentAdapter`; Claude uses the
pinned `@agentclientprotocol/claude-agent-acp` bridge over the official Claude Agent SDK.

There are deliberately **no per-feature methods** (`prompt()`, `setModel()`, ...).
A new kind of interaction is a new variant on `AgentInput` or `AgentEvent`.

## Contract principles (enforced, not aspirational)

1. **Schema is the contract.** `AgentEvent` and `AgentInput` are zod
   discriminated unions in `contract/event.ts` / `contract/input.ts`. Change the
   schema first, then implementations. The `z.ZodType<...>` annotations force
   the schema and the TS union to agree at compile time.
2. **Validation asserts, never rewrites.** Runtime validation uses
   `agentEventIssues` / `agentInputIssues` and always forwards the ORIGINAL
   object. Never emit the result of `zod.parse` — object parsing strips unknown
   keys and would silently drop payload fields.
3. **Default deny, loudly.** `BaseAgentAdapter` rejects every optional input
   kind with a named error (`<kind>: <feature> is not supported`). Adapters
   opt in by overriding the handler. Silent degradation is forbidden.
4. **Capability declarations are honest.** A profile flag in `AGENT_PROFILES`
   must match an overridden handler; `supportsInput()` detects overrides and the
   contract tests fail on any mismatch.
5. **Teardown sweeps.** `stop()` resolves every pending permission/question and
   fails every non-terminal tool call before releasing resources, so no UI state
   can hang on a dead agent. Adapters route all emissions through
   `BaseAgentAdapter.emit()` so the sweep bookkeeping stays automatic.
6. **UI is capability-driven.** Model selector, BYOK panel, login prompts, and
   prompt controls derive from `AgentProfile` plus reflected events. Never
   write `if (agent === "...")` in UI or chat logic.
7. **Host capabilities stay host-owned; deep adapter features stay concrete.**
   Link workspace identity, selected context, response policy, redaction, and
   business authorization semantics belong to Wanta and cross every adapter.
   Agent-native depth (server-side sessions, title generation, native history,
   and artifact/process support not declared by a profile) stays on the concrete
   adapter and is never faked. See `host-capabilities.md`.
8. **Credential red lines.** BYOA runtimes authenticate through their own CLI
   login (`auth: { kind: "agent-cli" }`) and call only their native model
   provider route. Wanta never injects its account token, BYOK key, base URL,
   or model alias into an external agent. Wanta account and BYOK model routing
   belong exclusively to the built-in OpenCode kernel; BYOK keys keep the
   existing `safeStorage` rules (see docs/conventions.md).

## Event/input vocabulary

`AgentEvent` keeps the `{event, data}` envelope of the chat ServerEvents layer
(the payload types in `electron/chat/common.ts` are shared on purpose — the UI
vocabulary is the source of truth). ACP vocabulary is used where a concept maps
cleanly (`cancel`, tool-call ids/status, permission replies). Connection health
is a normal event variant (`connectionStatus`), not a side channel.

## External (BYOA) adapter layer

External agents build on `electron/agent/external/`:

- **Session identity & routing**: external session ids are
  `wanta-ext:<kind>:<uuid>` (`external/session-id.ts`). The chat layer routes
  every session-scoped operation with a pure id parse (`chatBackendFor`), never
  a kind lookup table. ACP agents keep an in-memory Wanta-id -> native-id map;
  Wanta's persisted transcript is the restart-safe history boundary.
- **`ExternalAgentAdapter`** (`external/adapter-base.ts`): transcript-backed
  `getMessages`, pending-permission queries, `forgetSession`, and the optional
  `applyPermissionMode` capability. Wanta's normalized permission-mode
  vocabulary (`default | read_only | accept_edits | plan | auto | full_access`)
  is declared per agent in `AgentProfile.permissionModes` and projected onto
  the agent's own approval policy through ACP session modes and the registry's
  `permissionModeMap` (Claude includes its classifier-backed `auto` mode).
  Enforcement is always agent-side. Applying a declared
  mode is fail-closed: a missing or rejected native mode blocks the turn rather
  than silently continuing under a stale, potentially broader mode. The one
  exact exception is `default` on a session that advertises no ACP modes at
  all (Grok 1.0.5 omits `modes` from `session/new`): the agent already runs
  its own default policy and `default` is the only live mode exposed, so the
  projection is a no-op instead of an error.
- **Native enforcement is agent-side; user-visible approval semantics are
  host-owned**: an external CLI keeps its sandbox and decides when it needs an
  interactive native permission response. Every such request is normalized and
  evaluated by the same Wanta local-access policy used for the built-in kernel.
  Ordinary operations are answered automatically; protected or consequential
  boundaries reach the user. Switching agents must not change the decision for
  the same normalized operation, permission mode, and host context. A
  non-sensitive, non-high-risk dispatch to a generated `wanta_*` MCP server is
  also auto-approved at the transport layer: Wanta auto-approves that redundant
  ACP transport prompt because the call enters the same host-owned capability
  kernel used directly by OpenCode, where identity, credentials, validation,
  and auditing are already enforced. Sensitive or high-risk host-tool requests
  still continue through the shared prompt-or-deny policy.
  Claude's native Skills and subagents remain owned by Claude inside the ACP
  bridge; their file, shell, network, and permission operations still reach the
  same Wanta policy boundary as other external agents.
  The guarded `oo` CLI Connector path is classified by the same shared command
  policy for OpenCode, Claude, and ACP agents. A bare OOMOL business command is
  bound only when all currently running external turns agree on one team;
  ambiguous or missing workspace identity fails closed. A single `oo` command
  from an external agent crosses an authenticated loopback execution boundary;
  Electron main retains the real CLI path and in-memory turn scope, and the
  boundary accepts only connector apps/run/schema/search operations. The agent
  never receives the real CLI path or a writable scope file. A single `oo` command
  receives a fast-path allow when it includes only the shared bounded output
  suffixes (`head`/`tail` or stderr descriptor duplication). Other ordinary
  pipelines, sequences, and file redirections fall through to the same
  baseline local-command policy that applied before BYOA; a parser miss must
  never make `oo` stricter merely because it is present. Sensitive paths,
  high-risk operations, credential/configuration overrides, and authentication
  commands remain protected. Loaded Skills also receive a host execution
  policy: connected-service work follows the Skill's schema/run workflow through
  Wanta's managed `oo` command; MCP stays reserved for Wanta-native capabilities.
  Explicit session grants still never cross sensitive-resource or high-risk
  boundaries. The shared defaults (`default_local` / `default_command`,
  trusted-project allows, and host-side `full_access`) apply to every adapter.
  External sessions also register Wanta's stable artifact/process roots with
  their native runtime so ordinary managed-output writes do not create a
  redundant sandbox escalation.
- **Transcript persistence**: every emitted event is folded into
  `ExternalTranscriptRecorder` and mirrored to one JSON file per session under
  `<scratchRoot>/<kind>/transcripts/` (atomic replace, debounced writes,
  immediate flush on turn completion/stop, lazy rehydration on view or first
  prompt, deleted with the session).
- **Model/effort selection**: the built-in OpenCode kernel uses Wanta's model
  catalog and BYOK routes. Every BYOA registration uses its native model
  catalog, account, provider configuration, and selection protocol. External
  selection is carried by `set-model` / `set-effort` input variants plus
  `agentModelId`/`agentEffortId` on the session-creating prompt. The ACP
  adapter prefers v1.3 session config options (`session/set_config_option`,
  categories `model` / `thought_level`) and falls back to the unstable `models`
  state + `session/set_model` that shipping agents (codex-acp 1.6.2, grok 1.0.5)
  actually implement. Available options surface on
  `ExternalAgentRuntimeStatus.catalog` and the UI renders them verbatim; a
  `warmCatalog()` pass (a throwaway ACP session closed right away) fills the catalog before the first user session so draft-time
  pickers show the real lists. Per-session choices are also stored in Wanta's
  session metadata so they survive renderer reloads and full app restarts.
  Wanta/BYOK `model` and `reasoningLevel` fields are never forwarded to an
  external adapter, including when a stale renderer sends them. Claude Code,
  Codex, and Grok therefore show only the catalogs reported by their local
  runtimes and charge the user's own locally configured account.
- **Authentication recovery**: ACP `initialize.authMethods` is normalized into
  `ExternalAgentRuntimeStatus.authMethods`. Agent-owned methods are invoked by
  the `authenticate` input variant; Wanta never receives or persists the
  credential. A static registry command is display/copy-only fallback. Login
  success invalidates the probe and catalog caches before the renderer refreshes.
  Runtime readiness may disable prompt submission, but it must never disable
  the Agent configuration control used to authenticate or switch away.
- **Live modes and context metadata**: permission pickers use the intersection
  of registry-normalized semantics and the concrete session's `availableModes`;
  unsupported candidates are never shown or applied. Native
  `current_mode_update` notifications are normalized back into Wanta session
  state. Agent-native work modes may map prompt `build`/`plan` onto a declared
  config category (Codex uses `collaboration_mode`). Model metadata reported at
  ACP initialize, including Grok's `totalContextTokens`, seeds the external
  catalog so the context meter can render before the first turn. Live
  `usage_update.size` remains authoritative once a turn runs.
- **Attachments**: delivered as ACP `resource_link` blocks that the agent
  resolves with its own tools and permission model — never inlined into the payload.
  Display rides the kernel's `userAttachmentStore` record keyed by the
  synthesized user message id.
- **Host turn context**: Wanta passes the active Link workspace, team skills,
  selected context, project context, permission guidance, and response-language
  policy through the normalized prompt input. ACP adapters translate
  the dynamic tail into a delimited first text block while transcript display
  preserves the original user text. This remains a guidance transport; Wanta's
  guarded command and host-capability layers enforce identity independently of
  whether the agent follows the prompt.
- **Artifact publication**: every adapter receives the same artifact and process
  roots plus the same explicit publication instructions. Final files are
  declared with relative paths in `.wanta-artifact.json`; raw responses,
  temporary scripts, logs, checkpoints, and machine-review data stay in the
  process root. The chat finalizer validates the declaration and persists the
  normalized bundle, so adapters never need an artifact-specific method or UI
  branch.
- **Usage reporting**: adapters emit `usageUpdated` (normalized
  `ChatTokenUsage` + optional `contextWindow`) from ACP `usage_update`. The recorder attaches it to the
  latest assistant message, which is what lights the composer context meter.
- **Probing** (`external/probe.ts`): PATH scan (reusing
  `electron/agents/catalog.ts` + `resolveUserCommandPath`) with `--version`, plus
  validation of any native CLI delegated to by a packaged ACP bridge
  verification, plus fail-open login detection for agent-owned ACP agents via
  config marker files or native status commands. An explicit logged-out result
  gates submission; an unknown status remains fail-open so the runtime can be
  authoritative on first connection.
  Exposed to the renderer via the chat service
  `getExternalAgents` invoke.
- **Sessions** (`electron/session/external-store.ts`): Wanta-owned records
  replace `agent.listSessions()` for external sessions; scope/pin/archive stay
  in the shared metadata overlay. Transcripts persist across restarts as
  Wanta's own event record; importing agent-side history files stays a
  non-goal.
- **Version pairing**: `@agentclientprotocol/claude-agent-acp` is pinned and
  bundled as a self-contained JS bridge. Wanta resolves the USER'S detected
  `claude` binary into `CLAUDE_CODE_EXECUTABLE`; the bridge pins its Claude
  Agent SDK. ACP is version-negotiated at `initialize` (`PROTOCOL_VERSION`),
  and a mismatch is a hard error.
- **Credential red line**: Wanta stores no third-party agent subscription
  secrets. Agent-owned login state is observed, never managed. External agent
  subprocesses inherit the user's native provider configuration; Wanta adds
  only host-capability guards and runtime paths, never model credentials or
  provider endpoints.

## Checklist: adding a new agent

0. **ACP-speaking agent?** Then it is ONE registration entry in
   `electron/agent/acp/registry.ts` (command, ACP args, login hint, optional
   `permissionModeMap` and `selection` capability flags) — the profile is
   derived, the generic `AcpAgentAdapter` picks it up, and `external/create.ts`
   instantiates it automatically. No new code branches are allowed anywhere.
   Only continue with the steps below for a NATIVE (non-ACP) adapter.
1. Extend `AgentKind` in `contract/profile.ts`; the `satisfies
Record<AgentKind, AgentProfile>` on `AGENT_PROFILES` breaks the build until
   the new profile row exists. Declare only capabilities the adapter genuinely
   implements.
2. Implement the native adapter by extending `ExternalAgentAdapter` (or by
   implementing `ChatAgentBackend` directly when another host component owns
   transcript and pending-interaction reads):
   - required hooks: `handleStart`, `handleStop`, `handlePrompt`, `handleCancel`
   - override optional hooks only for declared capabilities
   - translate native events in a stateless translator module (pattern:
     `event-translator.ts`) and publish via `this.emit()`
   - message/part/session ids must be stable across deltas of the same item;
     prefer provider-native ids
3. Add a fixture to `adapterFixtures` in `contract/contract.test.ts`. All
   lifecycle invariants must pass unmodified — the suite itself never grows
   adapter-specific branches.
4. Verify SDK behavior against installed artifacts (`node_modules` `.d.ts`),
   never from memory; 0.x agent SDKs drift. Pin SDK and CLI binary as a pair
   and record verified behavior in code comments with version stamps.
5. Wire UI strictly through the profile: agent picker rows, model-selector and
   BYOK visibility, login-state hints. No new conditionals on the agent name.
6. Run: `pnpm run ts-check && pnpm run lint && pnpm test`, then a live
   `dev:worktree` smoke per docs/ai/dev-debugging.md.
