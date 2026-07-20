# Security Policy

Wanta is a desktop Agent with access to local files, shell commands, model credentials, and—when a
user opts in—connected third-party accounts. Security reports are taken seriously.

## Reporting a Vulnerability

Do not disclose a suspected vulnerability in a public issue, discussion, pull request, log, or
screenshot.

Use GitHub's private vulnerability reporting flow from the repository **Security** tab. If that
flow is unavailable, contact OOMOL privately through an official channel listed at
[oomol.com](https://oomol.com/) and include a link to this repository. Do not send real production
credentials; use redacted samples or disposable test credentials.

Please include, when available:

- affected version, commit, platform, and runtime mode;
- impact and the security boundary that is crossed;
- minimal reproduction steps or a proof of concept;
- whether local files, credentials, renderer IPC, Connector accounts, or update delivery are
  involved;
- suggested mitigations or related upstream reports.

The maintainers will coordinate disclosure and remediation privately. Please allow time for a fix
and release before publishing details.

## Supported Versions

Security fixes target the latest stable release and current `main`. Older builds may not receive
backports. Reproduce against the newest available version before reporting when it is safe to do so.

## Security Architecture

- The renderer never receives OOMOL session tokens or stored custom-model API keys.
- OOMOL authentication uses an httpOnly Electron session cookie; persisted `auth.json` contains
  profile metadata only.
- Custom-model API keys are encrypted with Electron `safeStorage`; plaintext fallback is rejected
  when the Linux secure-storage backend is not suitable.
- [OpenCode](https://github.com/anomalyco/opencode) runs as a loopback-only sidecar with a random
  server password, isolated configuration/data directories, and an in-memory model configuration.
- Risky OpenCode permissions are connected to Wanta's explicit approval UI.
- Connector credentials remain in the configured OpenConnector/OOMOL service. The Agent invokes
  Connector actions through the bundled oo CLI and receives scoped results rather than stored SaaS
  credentials.
- Deep-link, diagnostic, and error-report paths must redact authentication material.

See [docs/architecture.md](docs/architecture.md) and [docs/conventions.md](docs/conventions.md) for
the authoritative implementation contracts.

## Out of Scope

General support requests, model-quality concerns without a security impact, and vulnerabilities in
an external service that do not cross a Wanta trust boundary should use the relevant project's
normal support channel. Upstream vulnerabilities that affect Wanta's pinned dependency versions
are in scope when the report explains the reachable impact in Wanta.
