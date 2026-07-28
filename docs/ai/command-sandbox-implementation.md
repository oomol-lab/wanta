# Command Sandbox Implementation Memory

Read [../architecture.md](../architecture.md) and [../conventions.md](../conventions.md) before
changing the agent execution boundary.

## Current Goal

Build and verify a natural, low-interruption macOS command sandbox for ordinary users. Keep the
initial claim limited to OpenCode's built-in Bash tool and descendants. Do not treat the VS Code
integration or `@vscode/sandbox-runtime` configuration as Wanta's product architecture.

## Decisions That Must Survive Context Compaction

- Ship the first sandbox only on macOS and label it **Command Sandbox (Preview)**.
- Windows and Linux continue to execute directly on the host. Explain this once per device and show a
  quiet direct-execution status; do not imply equivalent isolation.
- Cover OpenCode's built-in Bash tool and its descendant processes first. Do not claim OS isolation
  for read, write, edit, Link, Browser, MCP, or custom tools.
- Public internet and loopback TCP access are on by default. RFC1918 destinations require a
  target-scoped grant; link-local destinations remain blocked. Unix sockets, Mach/XPC expansion,
  and local binding are separate capabilities and do not follow from loopback access.
- Treat every Bash command as untrusted without trying to classify malicious intent. The Preview
  protects filesystem and Wanta credential boundaries from an actively malicious command, but does
  not claim to resist macOS/Seatbelt vulnerabilities, misuse of user-authorized data, or an
  independently installed unauthenticated localhost service acting as a privileged broker.
- A selected project is read-write for its session, attachments are read-only, task output and
  process directories are read-write, and other user paths require explicit selection.
- Persist project grants with the session across app restarts. Do not turn them into global path
  grants.
- Generic shell processes must not see the user's real home or Wanta credentials. Use a persistent
  Wanta-managed home and capability brokers instead.
- Installed Skill packages may be mirrored read-only into the Wanta runtime. Declared capabilities
  are granted once at install or first use; a Skill never receives the whole home as a side effect.
- Task subagents inherit the parent session's grants but cannot expand them. New grants surface
  through the parent interaction.
- Standard-registry dependencies may install automatically into the selected project or a
  Wanta-private environment. System installs, privilege escalation, alternate registries, and
  URL/Git/local package sources still require approval.
- Explicit recoverable operations may run without another prompt. Permanent, ambiguous, broad, or
  agent-expanded destructive actions require approval.
- A macOS sandbox initialization failure never silently falls back. The user may choose direct
  execution for the current session only.
- The existing per-session Default Access / Full Access control is the sandbox exit. Default Access
  keeps Bash sandboxed on macOS; Full Access runs Bash directly for that session and switching back
  restores the sandbox. Do not add a second global sandbox toggle.
- Keep the normal UI quiet. Explain expansion, failure, and direct execution in plain language;
  reserve policy details for an advanced view.
- Upload only structured diagnostics without commands, paths, environment values, addresses, or file
  contents. Detailed logs stay local and require an explicit user export.
- Do not require generic file-mutation history or one-click undo for the first release. Probe
  OpenCode's native revert separately and treat it as a later enhancement.
- Hide `@vscode/sandbox-runtime` behind a Wanta-owned adapter. Pin and package the exact implementation;
  Wanta owns policy, grants, lifecycle, diagnostics, and UI.
- VS Code, Codex, and their approval UX are research inputs, not Wanta's implementation standard.
  Optimize decisions and defaults for ordinary Wanta users.
- Do not ship a `tool.execute.before` command rewrite until the original command remains the input to
  OpenCode and Wanta permission evaluation. Containment must be inserted after permission evaluation
  and before process spawn, or carry an authenticated structured mapping back to the original command.

## Exact Versions Under Investigation

- Wanta and the local dependency tree use OpenCode and its SDK/plugin packages at `1.17.13`.
- The adjacent VS Code checkout pins `@vscode/sandbox-runtime` to `0.0.1`.
- Current probe host: Apple Silicon, macOS 26.5.2, Node.js 24.18.0.

## Verified Evidence

### OpenCode shell inherits sidecar secrets

A disposable OpenCode `1.17.13` server was started with sentinel values in both `OO_API_KEY` and a
fake provider API key inside `OPENCODE_CONFIG_CONTENT`. Calling the official `session.shell` endpoint
with the built-in `build` agent returned:

```text
oo_exposed/config_exposed
```

This is runtime evidence, not an inference from source. Wanta currently builds the sidecar
environment by spreading the Electron process environment and then adding Link credentials,
`OPENCODE_CONFIG_CONTENT`, and the sidecar Basic Auth password. A file sandbox alone would therefore
leave a direct credential-exfiltration path.

Required consequence: the command boundary must provide an allowlisted environment and must prove
that a sandboxed process cannot recover secrets from the unsandboxed parent process. Merely clearing
a few variables in the interactive shell is not yet accepted as sufficient.

### Exact SRT 0.0.1 macOS behavior

A second disposable probe installed the exact npm artifact used by VS Code and invoked its CLI with
an explicit settings file.

Observed:

- `denyRead`, `allowRead`, `allowWrite`, and `denyWrite` enforced the expected precedence.
- Nested shells and background children retained the Seatbelt restrictions.
- Path traversal, pre-existing outbound symlinks, symlink replacement after launch, and an
  allow-write entry that was itself an outbound symlink did not produce an out-of-scope write.
- A denied-domain configuration blocked both proxied and direct public access. An allowed public
  domain succeeded while another public domain remained blocked.
- A sandboxed process could not inspect a sentinel in an unsandboxed same-user process with
  `ps eww` or `sysctl kern.procargs2`. The generated profile limits process inspection to the same
  sandbox label. This does not make a sidecar placed inside the same sandbox a safe secret holder.
- Obvious broker attempts through `open`, Finder Apple Events, and `osascript do shell script` did
  not create an out-of-scope file or launch the tested application. This is a regression signal, not
  proof that every broker surface is closed.
- SRT preserved an arbitrary inherited environment variable unchanged.
- Interrupting a foreground command terminated it, but a detached `nohup` background process
  survived after the SRT CLI exited. Its sandbox label still enforced filesystem policy until it was
  killed manually.
- Loopback and RFC1918 targets were unreachable by default even when listed as allowed domains,
  because SRT forces them into `NO_PROXY` while Seatbelt only permits the SRT proxy ports. Removing
  `NO_PROXY` made an explicitly allowed local target reachable through the proxy.
- `allowedDomains: ["*"]` is rejected as overly broad. The only built-in all-network mode is
  `network.enabled: false`, which allowed both a public site and direct host loopback.
- The domain proxy validates the requested hostname but not the resolved address class. An allowed
  `nip.io` hostname resolving to `127.0.0.1` reached a host loopback service. Loopback is now an
  accepted default capability, but the result proves that hostname filtering cannot enforce
  target-scoped RFC1918 or link-local policy against DNS rebinding or SSRF.
- Local port binding failed by default and succeeded with `allowLocalBinding`. Keep that option off
  unless a declared capability needs it.

Required consequences:

- Run one SRT boundary per command. Do not put the credential-bearing OpenCode sidecar inside the
  same sandbox label.
- Build a strict child environment before launching SRT; SRT is not an environment scrubber.
- Reuse or extend Wanta's process-tree reaper. Do not rely on the SRT CLI to own detached descendants.
- Canonicalize configured roots and reject ambiguous, missing, or boundary-crossing symlink inputs
  before policy generation even though the tested runtime blocked the attempted writes.
- Treat loopback/private-network routing as a Wanta-owned policy and proxy problem. The package's
  default `NO_PROXY` behavior does not implement the agreed target-grant UX by itself. Public-default
  networking with gated RFC1918/link-local access requires post-DNS IPv4/IPv6 address classification
  and revalidation across CNAMEs, redirects, rebinding, and connection-time changes, or a stronger
  OS network layer.
- Keep local binding, Mach service expansion, and Unix-socket access as declared high-risk
  capabilities.

### OpenCode interception ordering

Source inspection against OpenCode tag `v1.17.13` and disposable plugin probes established:

- `tool.execute.before` receives every model-invoked built-in Bash call in Wanta's normal prompt
  path. The same hook also ran for Bash in a task child session.
- The hook mutates one shared output object. Mutating `output.args.command` in place changed the
  executed command; replacing `output.args` did not.
- The hook runs before OpenCode parses the command and asks for permission. A naive rewrite to
  `srt ... original-command` therefore changes the command seen by OpenCode permission rules and by
  Wanta's `metadata.command` risk classifier.
- Wanta's current local-access policy permits an unrecognized command as `default_command` when no
  other risk marker matches. Wrapping before classification without a reliable original-command
  mapping can therefore weaken the current protection.
- `shell.env` can overwrite known secret names with empty strings and did so for main and task-child
  Bash calls. OpenCode constructs the final environment by spreading its own `process.env` first;
  the hook cannot request a clean allowlisted environment.
- Without the SRT process boundary, a child with scrubbed variables still recovered the OpenCode
  parent's sentinel credentials using same-user process inspection.
- The legacy `/session/:id/shell` path triggered `shell.env` but not `tool.execute.before`. Inline
  Markdown shell expansion, custom tools that spawn processes, built-in file tools, PTY, MCP, LSP,
  formatter, and worktree operations are also outside the Bash before-hook guarantee.
- Shadowing the built-in Bash tool with a custom tool worked through duplicate-ID ordering, but it
  discarded native permission, parsing, timeout, process, truncation, and metadata behavior. It is
  not an acceptable security boundary.

### OpenCode configured-shell seam

A follow-up probe set OpenCode's `config.shell` to an absolute disposable wrapper.

Observed:

- A normal built-in Bash call reached the wrapper as `["-c", originalCommand]`.
- OpenCode's parsing, permission evaluation, tool input, and tool title retained the exact original
  command. A real pending permission request contained the original Bash segments and exact original
  `metadata.command`; the wrapper path did not replace permission metadata.
- `shell.env` generated a policy path keyed by the exact session and call IDs, and the wrapper
  received that value before spawn.
- A task-subagent Bash call reached the same wrapper with the child session's own policy path.
- Quoting, stdout, stderr, exit status, and a short timeout retained native behavior in the tested
  cases.
- The legacy `session.shell` endpoint also honored the configured wrapper and received a generated
  call-specific policy through `shell.env`.
- Inline shell expansion inside an OpenCode Markdown command honored the configured wrapper but
  bypassed both permission and `shell.env`, so the wrapper received no policy.

This is the preferred no-fork seam for the Bash-only Preview. The production wrapper must be an
absolute Wanta-owned executable that:

- consumes policy only from Wanta-private state;
- builds an explicit environment allowlist before starting SRT;
- removes its policy-control variables from the sandboxed command;
- launches the exact packaged SRT implementation;
- relays terminal streams, exit, signals, cancellation, and timeout without changing shell semantics;
- reports explicit initialization failures; and
- owns process-tree cleanup after the command, including detached descendants.

The wrapper must fail closed when no authenticated policy is present. Wanta should also disable or
reject OpenCode inline shell expansion rather than silently assigning it a broad default policy.
Policy files must be created atomically outside every sandbox-writable root and validated before
use. The wrapper must preserve the delegated shell's name, invocation semantics, and profile
behavior rather than accidentally changing compatibility by presenting itself as the shell.

The wrapper itself remains trusted and unsandboxed; the OpenCode sidecar also remains outside the
per-command sandbox label. A complete agent-level sandbox would still require a credential-free
executor boundary for Bash, file tools, and other process-producing capabilities.

Known process-producing paths outside this P1 boundary include custom tools that call
`execFile`/`spawn` directly, MCP servers, LSP servers, formatters, Git/worktree helpers, dependency
installation helpers, and explicitly selected PTY commands. OpenCode's in-process read, write, edit,
apply-patch, glob, and grep tools also do not become OS-sandboxed merely because Bash does. Product
copy and diagnostics must describe this boundary precisely.

### OpenCode native revert

Disposable V2-session probes against the exact OpenCode `1.17.13` binary observed:

- Model-driven built-in Bash, edit, and write changes were included in one assistant snapshot.
- `revert.stage({ files: true })` restored modified and deleted tracked text, tracked binary, a
  tracked 3 MiB file, small untracked text and binary files, and files created through Bash, edit,
  and write.
- `revert.clear()` restored the staged agent changes byte-for-byte.
- A second stage followed by `revert.commit()` kept the reverted files and removed the assistant
  message while retaining the user message.
- `files: false` changed only the conversation boundary and did not mutate files.
- Exact 4 MiB untracked text and binary files were silently absent from the snapshot and survived
  revert. Equivalent 1 MiB untracked files were captured; the exact cutoff was not established.
- Revert changed the working tree but did not restore the Git index. An agent-staged modification
  remained staged and produced an `MM` state after file revert.
- Tracked binary and large files were restored, but their returned `FileDiff.patch` was empty.

Wanta currently uses OpenCode's legacy session creation, prompt, and message APIs. Those legacy
messages were absent from the V2 message list, and V2 revert returned `MessageNotFoundError`.
A separate legacy `session.shell` probe found that legacy `session.revert` changed session revert
metadata but did not restore the files changed by that direct shell message.

Required consequence: native revert is not a P1 dependency or security guarantee. It may become a
later **best-effort undo** only after a V2 session migration, explicit size/index limitations,
post-revert Git status verification, and cross-platform tests.

## Product Alignment After Grill

### Private-network approval

- A user should be able to ask naturally for a specific private target, such as testing
  `192.168.1.20`, without learning a permission syntax or receiving a redundant prompt.
- Use an independent, Wanta-owned Policy Reviewer to decide whether the user's own message
  authorizes the exact structured network capability requested by the enforcement layer. Do not ask
  it whether a command is generally safe.
- The Reviewer receives only user-authored messages, the normalized target/protocol/port, existing
  grants, and provenance metadata. It does not receive web pages, Skill text, command output, or the
  main agent's reasoning.
- Its schema is bounded to `approve` or `ask`, an evidence reference into the user message, and the
  requested scope. It cannot invent or widen a target. Deterministic checks verify the actual IP
  class, exact requested capability, output schema, and evidence.
- Only a high-confidence single-host private-network grant may be auto-approved. CIDRs, subnet
  scans, link-local destinations, sandbox bypasses, and other capability classes require their own
  policy. Model failure, timeout, malformed output, or uncertainty falls back to one short user
  confirmation.
- Approved target grants persist for the session. Redirects, DNS changes into a different address
  class, and targets discovered by the model or untrusted content do not inherit the grant.
- Do not use regular expressions or a command-risk classifier as the authorization boundary.
  Deterministic IP/CIDR classification and exact capability matching remain necessary enforcement,
  not intent detection.

### Reviewer model routing

- In Wanta-managed mode, use a fast Wanta-hosted model such as the available
  `deepseek-v4-flash` class.
- BYOK and local sessions use an isolated reviewer call from the same model source. Never silently
  send their message or private address to Wanta or another provider.
- The main agent never reviews its own permission request, even if the same underlying model family
  is reused with a clean independent context.
- A weaker or unavailable local reviewer produces more user confirmations, not a broader grant.

### First-release network compatibility

- Support HTTP/HTTPS and SOCKS5-aware TCP clients to an explicitly granted single private target.
  This covers common API checks and tools that honor HTTP or SOCKS proxy settings.
- Direct raw TCP to arbitrary private IP addresses is not available in the Preview. The pinned SRT
  profile can allow exact loopback ports or all loopback outbound connections, but macOS Seatbelt
  rejects arbitrary remote IP literals and only accepts wildcard remote ports. Exact private
  IP-and-port enforcement therefore requires Wanta's proxy path. SSH, database, and other raw TCP
  clients need explicit proxy support; a transparent implementation would require a Network
  Extension, PF helper, or VM and is outside this release.
- Defer UDP, ICMP, multicast, mDNS, Bonjour, and subnet discovery. Do not present their failure as a
  permission denial when the Preview simply does not implement the protocol.
- SRT's local HTTP/SOCKS proxies are enforcement points, not replacements for a user's proxy. The
  trusted Wanta layer captures `HTTP_PROXY`, `HTTPS_PROXY`, and `NO_PROXY` as runtime-only upstream
  configuration, then gives the sandbox command only localhost proxy addresses.
- Upstream proxy credentials never enter the sandbox policy file or command environment. Apply
  upstream `NO_PROXY` only after Wanta authorizes the destination. Redact proxy credentials from
  logs.
- An invalid, unsupported, or unreachable upstream proxy fails explicitly. Never fall back silently
  to direct internet access. PAC, NTLM/Kerberos, enterprise CA, and macOS system-proxy behavior need
  dedicated compatibility probes.

### Rejected shortcuts

- Do not use a regex or LLM judgment as the OS security boundary.
- Do not treat Codex or VS Code approval behavior as normative product requirements.
- Do not ship SRT's unrestricted network mode to obtain compatibility.
- Do not silently bypass the sandbox, a target grant, or the user's configured upstream proxy after
  an initialization or network error.

## Follow-up Questions

- Which additional macOS brokers and inherited-descriptor cases need permanent negative regression
  probes beyond the obvious `open` and AppleScript cases?
- Which auto-discovered OpenCode commands can contain inline shell expansion, and how should Wanta
  prevent that permission-less path from becoming user reachable?
- Does a future best-effort undo need to cover task-child sessions and survive sidecar restarts?

## Release Security Gates

Do not enable the macOS Preview by default unless executable probes show all of the following:

- The selected filesystem roots are the only writable user locations.
- Personal files and credentials outside authorized roots are unreadable.
- Descendant and background processes remain contained.
- Symlinks, path normalization, process brokers, and same-user process inspection do not recover
  unauthorized data or create an unsandboxed execution path.
- Sensitive environment values are absent from commands and cannot be recovered from ancestors.
- Public and loopback TCP networking work while RFC1918 grants and link-local blocking remain
  enforceable.
- Cancellation, timeout, session shutdown, and app shutdown reap the full command process tree.
- Main-agent and task-subagent Bash calls use the same boundary.
- Any initialization or policy failure is explicit and fail-closed.

Compatibility and performance defects may be documented Preview limitations. A failed security gate
blocks default release rather than weakening the claim.

## Current Implementation and Production Probes

The Preview now uses the configured-shell architecture below on macOS:

- a main-process policy store writes authenticated per-session policies outside sandbox-writable
  roots;
- an OpenCode `shell.env` plugin resolves task children to the root session and passes only opaque
  session/call identifiers;
- a Wanta-owned shell wrapper creates an allowlisted environment, persistent managed home, local
  HTTP/SOCKS enforcement proxies, one SRT label per command, and a detached process group that is
  reaped after completion;
- the same authenticated policy switches Full Access sessions to direct execution without restarting
  the agent; direct commands receive the user's real home and selected terminal integration
  variables, but never inherit Wanta/OpenCode credentials from the sidecar environment;
- an independent Policy Reviewer receives only the user message and exact private-network request;
  strict deterministic checks bind approval to one resolved address and optional port;
- Wanta-managed sessions route review to `deepseek-v4-flash`; custom/local sessions keep review on
  their selected model source;
- the user's HTTP(S) proxy remains upstream of Wanta's enforcement proxy, including proxy
  authentication and post-authorization `NO_PROXY`, with no silent direct fallback; and
- existing Wanta external-Skill synchronization mirrors installed Skill packages into the private
  OpenCode workspace. That mirror is readable in the sandbox, so Skill-local scripts do not require
  opening the real `~/.agents/skills` tree.

A real macOS probe against the built wrapper and OpenCode shell path verifies project writes,
read-only attachments, denied out-of-project reads and writes, removed sidecar secrets, HTTP and raw
loopback, detached-child cleanup, private policy-state protection, root-session policy handoff, and
the authenticated switch from sandboxed execution to direct out-of-project access.
The read boundary denies macOS user-data regions (`/Users`, system temporary directories, external
volumes, and network volumes) and re-allows authenticated project, attachment, managed-home, and
runtime paths. It deliberately leaves system/tool roots readable for normal command compatibility.
Unit tests cover signed policies, address classification, HTTP/SOCKS routing, upstream proxy
behavior, Reviewer schema validation, broker grants, shell generation, and attachment inheritance.

Two release limitations remain explicit:

- arbitrary raw private TCP cannot be expressed by Seatbelt and must remain blocked unless a future
  transparent network backend is added; and
- a live private-target auto-approval call has not been exercised against every supported BYOK or
  local model. Reviewer failures are fail-closed: the request remains blocked so the agent can ask
  the user to confirm it in a new message; failure never creates a broader grant.

Treat follow-up questions as acceptance-test work rather than permission to weaken a release gate.
Disposable probe artifacts and processes must be removed after their observations are recorded.

## Corrected Architecture Conclusion

The probes support building a macOS **Command Sandbox (Preview)**, but they do not support shipping
`@vscode/sandbox-runtime@0.0.1` unchanged behind a Bash argument rewrite.

The minimum viable architecture is:

1. Wanta main resolves the session's grants into an atomic, private, call-scoped policy.
2. An OpenCode plugin uses `shell.env` only to pass an opaque session/call policy locator.
3. OpenCode continues to parse and permission-check the exact original command.
4. OpenCode's `config.shell` points to an absolute, Wanta-owned wrapper.
5. The wrapper authenticates the policy, constructs a clean environment, and launches the command in
   its own SRT sandbox label.
6. A Wanta-owned supervisor cancels and reaps the complete process tree, including detached
   descendants.
7. A Wanta-owned network layer permits public destinations and loopback TCP by default while
   validating resolved IPv4/IPv6 addresses at connection time, requiring grants for RFC1918
   destinations, and blocking link-local destinations.

The exact SRT package is a useful and empirically effective macOS filesystem/process primitive, but
its current network modes fail Wanta's agreed product contract. `network.enabled: false` exposes
private targets; domain allowlists invert the desired default and still permit an allowed hostname
to change address class after policy evaluation. Before release, Wanta therefore needs either an
audited, pinned SRT fork/patch or another maintained macOS backend with equivalent filesystem
containment and a public-plus-loopback network policy with target-scoped private access.

Keep the first claim deliberately narrow: built-in Bash and its descendants on macOS. Preserve
OpenCode's native permission UX and avoid putting the credential-bearing sidecar inside a shared
sandbox. Treat OpenCode native revert as a later best-effort convenience after V2 migration, never
as containment or a prerequisite for the Preview.
