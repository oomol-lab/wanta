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

## Checklist: adding a new agent

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
