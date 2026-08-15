# Agent-independent host capabilities

## Product contract

Wanta owns product capabilities; the selected agent owns the reasoning loop.
Switching between OpenCode, Codex, Claude Code, or another adapter must not
silently switch the user's Wanta identity, Link workspace, selected context,
data-safety policy, or UI semantics.

The target split is:

| Owner         | Responsibilities                                                                                                                                                             |
| ------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Wanta host    | session identity, team/workspace scope, Link connections, browser and knowledge services, artifacts, redaction, authorization signals, audit records, and normalized tool UI |
| Agent adapter | native session lifecycle, model/effort selection, reasoning loop, native local-tool permissions, and translation to/from the normalized adapter contract                     |
| Model         | intent understanding, planning, tool choice, synthesis, and response generation                                                                                              |

Agent-native behavior is not expected to be identical. Host capability
identity, business safety, and result semantics are expected to be identical.

## Runtime-context contract

Every turn receives the same host-owned context before adapter translation:

- Wanta session ID and selected agent;
- active Link runtime and exact team workspace, when applicable;
- selected team skills, explicit context mentions, and project context;
- normalized permission mode and browser availability;
- response-language policy;
- managed artifact/process locations when the adapter supports them.

OpenCode receives this context through its dynamic system tail, custom tools,
and managed sidecar environment. External agents receive the shared
dynamic context as a delimited host-context block because ACP has no portable
per-turn system-prompt field and Claude's system prompt is fixed at session
creation. The recorded user message remains the original user text.

## Capability transport

The transport for external-agent host capabilities is Wanta MCP:

1. Wanta exposes narrow Link, browser, Skill, knowledge, question, and direct-provider tools.
2. Each tool resolves Wanta session identity in the host, not in the model.
3. Link calls bind the active workspace before reaching Connector.
4. Credentials remain in Wanta; agents receive only capability-scoped access.
5. Results are redacted and normalized before reaching the agent and renderer.
6. The same tool result produces the same authorization CTA and audit record
   for every adapter.

ACP adapters will receive these servers in `session/new.mcpServers`. Native
adapters will use their supported MCP/tool registration mechanism. OpenCode's
existing custom tools remain the session-aware compatibility transport for its
multiplexed sidecar.

Raw CLIs remain a fallback, not the primary business API. Every agent runtime
that can execute `oo` must use a Wanta-managed guard. The guard must fail closed
when it cannot resolve an unambiguous session workspace, preserve explicit
selectors, reject cross-workspace fallback, and redact connector output.
Loaded Skill instructions carry the same transport override for every external
adapter: when a Wanta host capability covers the requested operation, the
agent must use that capability instead of copying a CLI example into its native
shell. If an agent still selects the guarded `oo` compatibility path, the
shared permission classifier—not an adapter-specific rule—decides whether the
single command is safe to run without a redundant approval card.

## Kernel contract

`HostCapabilityKernel` is the single registry and execution boundary for
Wanta-owned tools. A capability declares an id, version, instructions, and
schema-validated tools. The kernel rejects duplicate capabilities/tools,
validates inputs even when the transport already did so, and emits metadata-only
audit records without tool inputs or outputs.

`HostCapabilityContext` is a per-turn host snapshot. It carries stable session
and turn ids plus team/project/artifact/process scope. Capability-specific
credentials live in opaque bindings and are resolved only inside the
corresponding capability implementation. Models must never provide or override
those bindings.

`HostCapabilityLease` owns the mutable context behind one agent session. A
lease can be refreshed for a new turn, disabled when account/runtime identity
changes, and permanently revoked when a task is deleted or the app exits. A
lease can never change its Wanta session identity.

`HostCapabilityServer` is the authenticated loopback MCP transport over that
kernel. It owns no business logic. ACP, Claude, and future transports receive
only its opaque bearer capability; real provider credentials remain in
Electron main. OpenCode retains its guarded compatibility tools where the
sidecar needs session-aware dispatch.

## Delivery phases

### Phase 1: shared turn context

Delivered:

- Pass Link runtime/team identity and the existing Wanta system-tail inputs to
  external adapters.
- Translate the context without replacing the agent's native base prompt.
- Preserve original user text in transcripts and UI.
- Add regression tests for team selectors and adapter prompt translation.

### Phase 2: Wanta MCP capability server

Delivered foundation and Link frontend:

- A generic `HostCapabilityKernel`, per-session `HostCapabilityLease`, and
  authenticated `HostCapabilityServer` now own registration, validation,
  context refresh, revocation, and transport.
- Link action discovery/invocation now has a host service independent of the
  selected agent.
- The host exposes an authenticated loopback MCP endpoint. External agents see
  only an opaque session capability; OOMOL/OpenConnector credentials remain in
  Electron main.
- ACP and Claude sessions register the same four tools: `list_apps`,
  `search_actions`, `inspect_action`, and `call_action`.
- Tool events normalize back to the existing connector UI vocabulary, so
  authorization overlays do not depend on an agent-specific MCP name.
- Capability context refreshes on each turn. Account/runtime switches disable
  old contexts before another account can use them.

OpenCode's four generated tools now prefer the session-aware host invoke
transport and therefore execute the same `LinkCapability` implementation as
ACP and Claude. The guarded raw-CLI code remains only as a startup-compatibility
fallback when the host transport is absent; it preserves the same four-tool
contract and fails closed on ambiguous workspace identity.

### Phase 3: guarded Link parity

Delivered behind a compatibility fallback: every agent's primary path uses the
same host Link implementation. Authorization enrichment, first-call probing,
same-target authorization blocking, and bounded concurrent action calls live
in `LinkCapability`, not in one adapter. Both transports bind the exact
workspace, validate selected connections, redact output, and fail closed
instead of falling back to another identity. OpenCode's former raw-CLI path is
retained temporarily for startup compatibility and is not the source of truth.

### Phase 4: Skill registry and task snapshots

Delivered foundation: `SkillRegistry` resolves a deterministic current-turn
snapshot from explicitly labelled sources. The source model supports bundled,
managed, user, team, plugin, and connection origins; the current app assembly
provides bundled, Wanta-managed, and active direct-connection roots.
External agents visibly call `list_skills`, `load_skill`, and
`read_skill_file`; referenced paths cannot escape the Skill root. OpenCode uses
the same managed bundled/runtime sources in its private workspace. Connected
direct-provider Skills are added only while their identity is active. Snapshot
creation reports duplicate ids, missing references, hardcoded agent/workspace
paths, and embedded credentials; a Skill containing an embedded credential is
excluded.

### Phase 5: browser and knowledge

Delivered: all agents operate the same visible `BrowserManager`; Wanta supplies
the session id. Host tool results support MCP-native image content, so browser
screenshots reach external agents as images rather than file-URL text.
WikiGraph reads use Wanta's managed state and are restricted to read-only,
bounded `wikg://lib` queries.

### Phase 6: artifacts, processes, and user interaction

Delivered with an explicit boundary: every adapter receives the exact managed
artifact/scratch-process locations and uses the same finalizer. `ask_user`
bridges a blocking tool call to Wanta's structured-question UI and is cancelled
on task deletion or shutdown.

Wanta intentionally does not expose a second arbitrary-command process manager
as a host capability. Local subprocess start/stop remains an agent-native tool
subject to that adapter's permission flow; Wanta owns only the per-turn scratch
directory, output collection, cancellation of the selected agent run, and
cleanup. Adding `start_process(command, argv)` in the host would duplicate the
agent shell, bypass its approval model, and broaden the credential boundary.

### Phase 7: direct providers, history, and parity gate

Delivered at the guarded-adapter boundary: Lark, WeCom, and DingTalk execute
through Wanta-managed isolated runtimes. Calls must name an active
provider-matching Skill from the same turn; bounded argv validation rejects
administration, control-line injection, and oversized requests. Provider CLIs
remain the business-schema authority because their command sets ship with
their versioned Skills. Wanta's
persisted transcript is the history source of truth: Claude resumes natively,
while ACP agents receive a bounded context rebuild when native loading is not
available. Host capability availability is resolved dynamically from Wanta's
active runtimes and settings rather than duplicated as static per-agent flags.
The normal suite covers the shared contracts, transports, scope switches,
runtime revocation, and restart paths.

## Acceptance contract

For the same Wanta session, workspace, service, connection target, and action:

- every agent resolves the same Link workspace;
- no agent retries under a different identity after an error;
- authorization errors preserve runtime/workspace metadata;
- connector output is redacted before model and persistence boundaries;
- the renderer produces one normalized tool record and one authorization CTA;
- switching agents never requires reconnecting an already-active provider.

Unit and contract fixtures cover OOMOL team scope, OpenConnector, simultaneous
sessions, account/runtime switching, task deletion, Skill snapshots, browser
session binding, rich screenshot results, managed outputs, structured
questions, and restart recovery. A transport-parity fixture executes the same
Link capability and workspace through OpenCode's invoke transport and external
MCP. Real-agent smoke tests remain opt-in because they require installed and
authenticated third-party CLIs; release qualification must run them when those
runtimes are available.
