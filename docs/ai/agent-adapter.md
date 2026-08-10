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
   history behavior derive from `AgentProfile` plus reflected events. Never
   write `if (agent === "...")` in UI or chat logic.
7. **Deep capabilities stay concrete.** OpenCode-specific depth (server-side
   sessions, artifact/process dirs, Link team scope, title generation) lives on
   `OpencodeAgentAdapter` as explicit passthroughs — outside the normalized
   contract. External adapters are never forced to fake them.
8. **Credential red lines.** External agents authenticate through their own CLI
   login (`auth: { kind: "agent-cli" }`); Wanta stores no subscription secrets.
   BYOK keys keep the existing `safeStorage` rules (see docs/conventions.md).

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
  a kind lookup table. Claude Code reuses the embedded uuid as its native
  session id; ACP agents keep an in-memory wanta-id -> native-id map.
- **`ExternalAgentAdapter`** (`external/adapter-base.ts`): transcript-backed
  `getMessages`, pending-permission queries, `forgetSession`, and the optional
  `applyPermissionMode` capability. Wanta's normalized permission-mode
  vocabulary (`default | read_only | accept_edits | plan | full_access`) is
  declared per agent in `AgentProfile.permissionModes` and projected onto the
  agent's own approval policy (Claude SDK permission modes; ACP session modes
  via the registry's `permissionModeMap`). Enforcement is always agent-side.
- **Transcript persistence**: every emitted event is folded into
  `ExternalTranscriptRecorder` and mirrored to one JSON file per session under
  `<scratchRoot>/<kind>/transcripts/` (atomic replace, debounced writes,
  immediate flush on turn completion/stop, lazy rehydration on view or first
  prompt, deleted with the session).
- **Model/effort selection**: `set-model` / `set-effort` input variants (plus
  `agentModelId`/`agentEffortId` on the session-creating prompt). Claude maps
  them to SDK `model`/`effort` options and live `setModel`/flag settings; the
  ACP adapter prefers v1.3 session config options (`session/set_config_option`,
  categories `model` / `thought_level`) and falls back to the unstable `models`
  state + `session/set_model` that shipping agents (codex-acp 1.1.14, grok 1.0)
  actually implement. Available options surface on
  `ExternalAgentRuntimeStatus.catalog` and the UI renders them verbatim; a
  `warmCatalog()` pass (throwaway ACP session closed right away, or an idle
  Claude query) fills the catalog before the first user session so draft-time
  pickers show the real lists.
- **Usage reporting**: adapters emit `usageUpdated` (normalized
  `ChatTokenUsage` + optional `contextWindow`) — Claude from result-frame
  usage/modelUsage, ACP from `usage_update`. The recorder attaches it to the
  latest assistant message, which is what lights the composer context meter.
- **Probing** (`external/probe.ts`): PATH scan (reusing
  `electron/agents/catalog.ts` + `resolveUserCommandPath`) with `--version`
  verification, plus fail-open login detection (Claude: `~/.claude.json`
  `oauthAccount` key presence only — no secret is ever read; ACP agents: config
  marker files). Exposed to the renderer via the chat service
  `getExternalAgents` invoke.
- **Sessions** (`electron/session/external-store.ts`): Wanta-owned records
  replace `agent.listSessions()` for external sessions; scope/pin/archive stay
  in the shared metadata overlay. Transcripts persist across restarts as
  Wanta's own event record; importing agent-side history files stays a
  non-goal.
- **Version pairing**: `@anthropic-ai/claude-agent-sdk` is pinned in
  package.json and declares its paired CLI version (`claudeCodeVersion` in the
  package manifest). The adapter drives the USER'S detected `claude` binary via
  `pathToClaudeCodeExecutable`; probe results expose both versions so a drift is
  visible instead of silent. ACP is version-negotiated at `initialize`
  (`PROTOCOL_VERSION`), and a mismatch is a hard error.
- **Credential red line**: Wanta stores no subscription secrets. Login state is
  observed, never managed; the login hint tells the user to sign in with the
  agent's own CLI.

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
2. Implement the adapter extending `BaseAgentAdapter`:
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
