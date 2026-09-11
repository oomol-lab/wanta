# Agent-independent host capabilities

## Product contract

Wanta owns product capabilities; the selected agent owns the reasoning loop.
For BYOA, the selected local agent also owns authentication, provider routing,
its model catalog, and native model/effort selection. Only the built-in
OpenCode kernel uses Wanta account or BYOK model routes.
Switching between OpenCode, Codex, Claude Code, or another adapter must not
silently switch the user's Wanta identity, Link workspace, selected context,
data-safety policy, or UI semantics.

The target split is:

| Owner         | Responsibilities                                                                                                                                                                                                   |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Wanta host    | session identity, team/workspace scope, Link connections, browser and knowledge services, artifacts, redaction, authorization signals, audit records, normalized tool UI, and built-in OpenCode model/BYOK routing |
| Agent adapter | native session lifecycle, native account and provider route, native model/effort catalog and selection, reasoning loop, local-tool enforcement, and translation to/from the normalized adapter contract            |
| Model         | intent understanding, planning, tool choice, synthesis, and response generation; for BYOA, usage is charged by the user's local agent account                                                                      |

Agent-native behavior is not expected to be identical. Host capability
identity, business safety, and result semantics are expected to be identical.
Local interactive permissions belong to the selected external agent. Wanta
projects supported modes through ACP and displays the native approval options,
then returns the exact selected option ID. It does not apply its local-access
classifier, auto-answer native requests, or store grants for ACP sessions.
This includes native requests to execute managed Link CLI or host MCP tools.
The built-in OpenCode kernel continues to use Wanta's local-access policy.
Link identity and business authorization remain enforced at capability entry
points, independently of the agent's local permission mode.

## Runtime-context contract

Every turn receives the same host-owned context before adapter translation:

- Wanta session ID and selected agent;
- active Link runtime and exact team workspace, when applicable;
- selected team skills, explicit context mentions, and project context;
- normalized permission mode and browser availability;
- response-language policy;
- managed artifact/process locations when the adapter supports them;
- built-in slash-command contracts such as `/bug-report` (forced Build artifact
  placement, a host-written evidence pack in the process directory, stripped
  this-turn attachments, a diagnostic local-access fence limited to that pack
  and the report artifact, no connector or host MCP capability, an isolated
  evidence-pack cwd for BYOA, and the same diagnostic report prompt on OpenCode
  and BYOA).

OpenCode receives this context through its dynamic system tail, custom tools,
and managed sidecar environment. External agents receive the shared
dynamic context as a delimited host-context block because ACP has no portable
per-turn system-prompt field. The recorded user message remains the original user text.

## Capability transport

Capability ownership and transport are separate decisions. Wanta owns identity,
workspace, credentials, validation, redaction, authorization, and audit
semantics regardless of the wire used by an agent.

- External coding agents use the Wanta-managed `oo` CLI for Connector discovery
  and actions. This preserves their native command and Skill workflow without
  eagerly loading the Link catalog as MCP tools.
- MCP is reserved for stateful Wanta-native capabilities without an equivalent
  managed CLI, such as the integrated browser, structured questions, knowledge,
  current-turn Skill snapshots, and isolated direct-provider runtimes.
- OpenCode keeps its in-process host invoke path.
- Every transport normalizes into the same tool UI and permission vocabulary.

Every agent runtime that can execute `oo` must use a Wanta-managed guard. The
guard binds a bare OOMOL business command only when all currently running
external turns agree on one team, and fails closed when their workspaces differ
or no team identity is available. It preserves the active runtime boundary,
rejects cross-workspace fallback, and redacts connector output.
External agents receive only an authenticated loopback guard descriptor;
Electron main retains the real OO executable path and the in-memory per-turn
runtime/team scope. The boundary rejects runtime-administration commands and
accepts only contract-declared capability search, Connector apps/run/schema/search,
bounded file upload/download, and the explicitly enabled Open Flow read, Draft,
run, and publish operations. Project switching, Flow deletion/rollback/cancel,
browser-opening commands, and unrecognized OO operations remain unavailable.
Loaded Skill instructions keep Connector work on that managed CLI. Native agents decide whether the managed command needs approval; Wanta forwards
their requests unchanged. OpenCode uses its existing host command classifier.

## Built-in OpenCode local-access policy

The following command classification rules apply only to the built-in kernel.
ACP agents use their native local policy; the managed Link guard remains active
at its business execution boundary.

Shell setup is classified by its operation: a plain `export NAME=value`
assignment is ordinary local work only when it does not involve protected
credentials or runtime configuration. Assignments containing `OO_API_KEY` or
`OO_CONNECTOR_TOKEN` remain denied as `credential_reference`; assignments to
`OO_ENDPOINT` remain denied as `runtime_environment_override`. Environment
dumps (`export`, `export -p`, `env`, `printenv`) remain blocked. Assignment
values containing executable shell syntax do not qualify for this exception.
Every subsequent command still receives the credential, runtime-override, and consequential
operation checks, including commands wrapped in a shell. Managed Skill
runners should reuse the host-injected PATH and `WANTA_OO_BIN`, passing the
managed executable to child CLI calls instead of rebuilding PATH. The GPT
Image 2 runtime-copy guidance documents its `--oo` option for this purpose.
Automatic local-access decisions record a stable reason in diagnostics;
denial reasons contain no command arguments or credential values.

Default Access distinguishes `env NAME=value command` launchers from environment
dumps and still inspects the launched command. Explicit `printenv` reads of known
non-sensitive runtime variables (such as `LANG`, `PATH`, and `NODE_ENV`) and literal
`rg`/`grep` searches for credential variable names are ordinary operations; reading
the actual managed credential values remains denied. Proven command cwd also
qualifies relative generated-output cleanup without requiring a redundant `cd`.
Git push and rsync dry runs remain ordinary. Deletion-enabled rsync, Docker volume
pruning, and Helm uninstall join the existing consequential-operation boundaries.
Recursive deletion of an unrelated `/tmp`, `/var/tmp`, or `/private/tmp` child
requires confirmation; a temporary path alone does not establish task ownership.
The active task process directory's descendants and the existing recognized
project output roots remain eligible for automatic cleanup, including proven cwd
forms. Agents should put disposable intermediates in the supplied task process
directory. This policy does not add filesystem scans or automatic backups.

Process-directory guidance asks agents to create fresh, uniquely named temporary
resources and avoid optional cleanup or broad process termination as task prerequisites.
Necessary cleanup stays separate from generation and validation; ordinary commands
can still be combined. Cancelling a permission request rejects the entire call.
Default Access guidance permits independent work or a different approach only within
the original authorization and without the rejected side effects, unless the user
asked to stop. OpenCode also receives this explanation in its user-rejection reply;
ACP keeps its native permission-option response without an injected follow-up turn.

Default Access is a permissive guard against common consequential mistakes, not
an execution sandbox. Ordinary dependency operations use the default command
policy even when their cwd, variable expansion, wrapper, or script composition
cannot be proven by the bounded-install recognizers. This deliberately also
allows plain pip and installs whose environment is not proven task-private;
agents should still prefer the supplied task environment. A parser miss alone
is not a dependency confirmation boundary.

Explicit global Node dependency mutations, publishing, alternate package sources,
Python user/system installs, destination overrides, external requirements or
constraint inputs, and pipx/uv tool mutations retain confirmation. The existing
credential, sensitive-resource, project `.env` write, broad edit, and consequential
operation checks remain in force. These are text-level guards; opaque scripts,
unknown tools, and dynamic expansion are not a strict filesystem boundary.

Explicit npm `--prefix` destinations must resolve inside the task or selected
project. Explicit uv `--python` destinations must match an existing recognized
task-private or selected-project interpreter path. Unknown or outside destinations
prompt; absolute and equals forms are checked, including repeated options. Relative
destinations require proven cwd. These checks do not resolve shell variables.
Dynamic dependency operation names or option names also prompt because they can
conceal publishing or global/user installation. Ordinary path/package values and
multiline processing remain eligible for default execution. Nested shell or
cwd-changing launcher text does not establish a relative destination's cwd.

Known task-scratch or generated-project cleanup can compose with ordinary work
when the existing sequence parser proves every step independently allowable.
No partial execution or approval occurs: the original call is approved as a whole.
Literal directory changes establish scope only on their success path; a failed
or piped cd does not prove a cleanup target. Unknown deletion targets, variable
cleanup, and unsupported cleanup control flow still require confirmation.
A built-in shell permission with no command cannot be automatically approved.
ACP requests preserve command metadata for display without host classification.

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
kernel. It owns no business logic. ACP and future transports receive
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

Historical foundation (the Link-over-MCP choice below was later superseded by
the managed-CLI transport policy above):

- A generic `HostCapabilityKernel`, per-session `HostCapabilityLease`, and
  authenticated `HostCapabilityServer` now own registration, validation,
  context refresh, revocation, and transport.
- Link action discovery/invocation now has a host service independent of the
  selected agent.
- The host exposes an authenticated loopback MCP endpoint. External agents see
  only an opaque session capability; OOMOL/OpenConnector credentials remain in
  Electron main.
- External ACP sessions register the same four tools: `list_apps`,
  `search_actions`, `inspect_action`, and `call_action`.
- Tool events normalize back to the existing connector UI vocabulary, so
  authorization overlays do not depend on an agent-specific MCP name.
- Capability context refreshes on each turn. Account/runtime switches disable
  old contexts before another account can use them.

OpenCode's four generated tools now prefer the session-aware host invoke
transport. The guarded raw-CLI code remains as a compatibility path and fails
closed on ambiguous workspace identity.

### Phase 3: guarded Link parity

External coding agents reach Connector through the guarded OOCLI rather than an
eagerly injected `wanta_link` MCP server. OpenCode continues to use the
in-process host Link implementation. Both paths preserve workspace identity,
redact output, and fail closed instead of falling back to another identity.

OOMOL Marketplace accounts remain ordinary Connector virtual connections at
this boundary. Wanta preserves their `marketplace:oomol:<service>` app id,
`marketplace_oomol` connection name, pricing metadata, Team visibility, and
Action policy; it never receives the managed provider credential. OpenCode and
external agents use the same default or explicit connection selection instead
of a Marketplace-specific execution tool.

The same authenticated boundary exposes bounded OO file transfer and Open Flow
subcommands. Uploads can read only regular files under the active turn's
managed roots. Downloads accept only public HTTP(S) artifact URLs and write
only inside those roots. Flow requires an OOMOL runtime and explicit Project
binding for Project-scoped work; read and Draft operations are enabled, while
run and publish execute without a separate user confirmation. Project
switching, Flow deletion or rollback, run cancellation, and browser-opening
commands remain closed until they receive separate host semantics.

Single-file website deployment uses `oo website upload` with an active OOMOL
runtime. The managed external-agent boundary accepts one regular `.html` or
`.htm` file under the active turn's managed roots, capped at 20,000,000 bytes.
The enabled default Registry Skill `@alwaysmavs/oo-deploy-single-html` is installed
after login without a version selector, so a new installation fetches the latest
published version. Existing installations retain the normal Skill update and
user-removal behavior.

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

Final deliverables use the adapter-independent `.wanta-artifact.json`
publication declaration. The host resolves and validates only relative,
non-symbolic-link files inside the current turn's artifact root, persists their
primary/supporting/summary roles in a versioned artifact bundle, and routes
undeclared or metadata files to execution details. Turns without a declaration
retain legacy inference for compatibility; a present but invalid declaration
fails closed instead of exposing the whole directory as final output.

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
their versioned Skills. Wanta's persisted transcript is the history source of
truth; ACP agents receive a bounded context rebuild when native loading is not
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
