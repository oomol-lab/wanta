# Spaces integration

Spaces is Wanta's optional Convex-backed website capability. The host exposes
`spaces_read`, `spaces_create`, and `spaces_deploy` through the same capability
kernel to OpenCode (host invoke) and external ACP agents (MCP). It is available
only with an OOMOL runtime and an explicit current-turn team. OpenConnector
credentials and a server-selected default team are never used as fallbacks.

## Routing and consent

Use Spaces for a website requiring shared persistent data or server functions
and a database that fit Convex. Static pages, browser-only storage, prototypes,
and frontends with an existing backend keep their existing workflow. Ambiguous
requirements require clarification. Explicit management of an existing Space
is also supported.

`spaces_create` requires prepared source with a build script, the `convex`
dependency, and a backend directory. The agent supplies the concrete reason
for using a backend. Wanta's native structured question supplies the operation,
team, target, project, authoritative price, monthly renewal terms, and choices
to confirm, create a prototype instead, or cancel. No tool argument can grant
consent. Local automatic-approval modes do not bypass this question.

**New paid Spaces are currently blocked in production wiring.** The upstream
contract provides the price code `spaces/space/month` but no verified quote
endpoint or amount. The product decision is to require an exact amount before
creation. `SpacesServiceOptions.price` is the host-only integration point;
`electron/main.ts` deliberately supplies an unavailable price. Do not substitute
a guessed price, a model-supplied amount, or a generic billing warning. Connect
an authoritative source returning amount, currency, source, revision, and expiry
before enabling creation. The quote is checked again after confirmation.

Creation and its first deployment share one consent only in the same turn,
for the same Space, source path, and source fingerprint. Subsequent deployments
show the exact live target and backend effects. Account/team changes, turn
replacement, cancellation, task deletion, and shutdown invalidate pending
consent and abort host work. Restarts preserve the recovery journal, not consent.

## Runtime and credentials

The fixed Spaces CLI 0.4.0 release provides its embedded Bun runtime. The
download uses immutable release URLs and pinned archive SHA256 checksums;
development and packaged builds use the same binary. Upstream provides macOS
and Linux builds, but no Windows build. Windows keeps the capability unavailable
without preventing the rest of Wanta from starting or packaging.

The stock CLI's full project deployment inherits its account environment into
project scripts. Wanta therefore owns control-plane requests, deployment
credentials, artifact upload and billing consent instead of exposing that raw
command. The binary is used only as its embedded JavaScript runtime. No new
OOMOL login is needed: control-plane requests use the same in-memory session
token as Wanta's managed OOCLI.

Sources are snapshotted under the turn's process directory after confirmation.
The project must be under the turn's project or artifact root; symlink escapes
are rejected. Dependencies, prior build output, local environment files, and
local credential configuration are excluded. The source fingerprint is checked
before building. Project scripts receive an allowlisted environment and a
temporary home, never the account token or host capability bearer. A short-lived,
target-checked Convex deploy key reaches only the backend deployment subprocess.
The frontend build receives public deployment URLs only.

This environment separation is not an OS sandbox. A project still executes
local code when the user confirms deployment. The short-lived deploy credential
is deliberately available to the project's Convex CLI during that step.

## Deployment and recovery

The initial supported shape is a package.json project whose `build` script
produces `dist/index.html`, with `convex/` backend source. The sequence is install,
backend deployment, frontend build, bounded zip upload, and job polling. It is
not arbitrary Node/Python/SSR hosting. Use returned URLs; do not construct tenant
domains. Team visibility protects the website entrance, not the Convex data API;
application functions must enforce their own data access rules.

Operation journals live in the host-private `spaces/operations` directory. They
record idempotency keys before writes and retain Space/job IDs for recovery,
without account or deploy credentials. A lost paid-create response is reconciled
by reading the original target. An unresolved operation is not replaced with a
fresh paid request. Upload uncertainty similarly requires checking the existing
deployment history. Terminal failed jobs can be retried after a new confirmation.

Backend changes are not atomic with the frontend. A frontend failure explicitly
reports that the backend has already changed. A queued job is not successful
publication: use `spaces_read` with `operation=job` and then verify the website's
real read/write behavior. Rollback, delete, resume, public-access changes and
secret provisioning are intentionally not exposed in this initial release.

## Verification

Run the Spaces service/client tests, question broker and host invoke tests,
workspace/tool assembly tests, and shared context tests. The service suite
exercises native consent over both transports. When `.spaces-bin/spaces` is
installed, it also runs the real embedded runtime against a fixture backend and
a mocked control plane, checking install/backend/build/upload ordering and
credential separation without issuing a real charge. This does not prove live
Convex or billing behavior; live creation remains gated on authoritative pricing.

Use `node --experimental-strip-types scripts/download-spaces.ts` to prepare a
missing development binary. `postinstall` and `prepare:binaries` do this as well.
