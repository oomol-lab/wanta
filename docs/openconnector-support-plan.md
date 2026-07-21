# OpenConnector Support Plan

> Status: implemented and verified
>
> Plan date: 2026-07-21
>
> Scope: let Wanta use a user-configured OpenConnector runtime as its Link
> runtime, including the signed-out custom-model path, without weakening the
> existing OOMOL authentication, credential, team-scope, or Agent permission
> boundaries.
>
> Related: [project-overview.md](project-overview.md) (product positioning) ·
> [architecture.md](architecture.md) (process and Agent boundaries) ·
> [key-decisions.md](key-decisions.md) (security and runtime decisions) ·
> [conventions.md](conventions.md) (implementation rules)

## 1. Conclusion

OpenConnector must be integrated as an independent Link runtime, not as a
second sign-in method and not as a third MainProcessCloudRuntime kind.

Wanta currently couples three concerns that need independent ownership:

| Axis                           | Supported sources                                        |
| ------------------------------ | -------------------------------------------------------- |
| Account and cloud capabilities | Signed out or an OOMOL account                           |
| Model choice                   | OOMOL built-in model or a custom OpenAI-compatible model |
| Link runtime                   | None, OOMOL Connector, or OpenConnector                  |

The target design must support these combinations:

| OOMOL account | Model source    | Link runtime  | Expected result              |
| ------------- | --------------- | ------------- | ---------------------------- |
| Signed in     | OOMOL           | OOMOL         | Current default behavior     |
| Signed in     | Custom          | OOMOL         | Current supported behavior   |
| Signed in     | OOMOL or custom | OpenConnector | New behavior                 |
| Signed out    | Custom          | OpenConnector | New behavior                 |
| Signed out    | Custom          | None          | Current local Agent behavior |
| Signed out    | None            | Any           | Agent remains model_required |

OpenConnector provides connector capabilities, not an LLM. A fully signed-out
user therefore still needs a configured custom model before the Agent can
start.

The first release supports exactly one active Link runtime per Agent runtime.
It does not merge OOMOL and OpenConnector catalogs and does not silently fall
back from an explicitly selected runtime to another runtime.

## 2. Evidence and current constraints

The current code already supports a signed-out local Agent when a custom model
is configured:

- electron/runtime/agent-runtime.ts resolves a local runtime from the selected
  custom model.
- src/App.tsx mounts the normal application shell for the local account key
  instead of requiring an authenticated account.

Connector availability is still incorrectly derived from the OOMOL runtime:

- electron/runtime/common.ts sets connectors from mode === "oomol".
- electron/agent/manager.ts only builds the oo environment for an OOMOL cloud
  runtime.
- electron/agent/workspace.ts asks agentToolFilesForRuntime to remove Link tools
  from a local runtime.
- electron/agent/config.ts enables the Link-aware system prompt and direct oo
  permission only for an OOMOL cloud runtime.
- src/components/app-shell/AppShell.tsx uses cloudEnabled to gate teams,
  billing, cloud Skills, connection data, the connection drawer, and chat Link
  affordances together.

The bundled oo CLI is sufficient for the first implementation:

- scripts/oo-cli.ts pins oo CLI 1.5.1.
- oo 1.5.1 supports a self-hosted connector via connector login and the
  OO_CONNECTOR_URL / OO_CONNECTOR_TOKEN environment variables.
- The OpenConnector runtime exposes compatible apps, action search, action
  metadata, action execution, and provider metadata endpoints.
- A protocol probe using the bundled binary confirmed apps, search, schema,
  connection aliases, and action execution against OpenConnector-compatible
  response envelopes.
- The deterministic same-`OO_DATA_DIR` A -> B -> A probe returned the A schema,
  then the distinct B schema, then the original A schema for the same service
  and action. oo 1.5.1 therefore namespaces this cache by connector endpoint;
  Wanta keeps the existing isolated Agent `OO_DATA_DIR` and does not add a
  second endpoint-hash directory layer.

The integration is not an environment-variable-only change:

- The bundled CLI rejects --organization before sending any request when a
  self-hosted connector is active.
- Wanta's Link tools currently require an OOMOL team identity and append
  --organization to apps and run calls.
- Wanta's provider metadata request reads OO_API_KEY, while OpenConnector uses
  OO_CONNECTOR_TOKEN and may also run without authentication.
- Wanta recognizes the hosted connector authorization error codes but not
  OpenConnector's connection_not_found, oauth_token_expired,
  oauth_refresh_unavailable, and authorization_failed codes.
- Wanta currently opens its internal OOMOL connection drawer for every
  authorization action and ignores the parsed authUrl.

## 3. Non-negotiable design principles

### 3.1 Separate model and Link runtime ownership

Do not add OpenConnector to the existing cloud runtime union:

```ts
type MainProcessCloudRuntime = { kind: "local" } | { kind: "oomol"; sessionToken: string } | { kind: "openconnector" }
```

That model is invalid because OpenConnector neither provides the selected
model nor represents an OOMOL account. An OOMOL model and an OpenConnector
runtime are a valid combination.

Keep model access separate from the selected model, and keep both separate
from the Link runtime:

```ts
type ModelAccess = { kind: "local" } | { kind: "oomol"; sessionToken: string }

type LinkRuntime =
  | { kind: "oomol"; sessionToken: string; teamName?: string }
  | {
      kind: "openconnector"
      baseUrl: string
      consoleUrl: string
      runtimeToken?: string
    }
```

AgentManager receives ModelAccess, the existing default ModelChoice, and
LinkRuntime | null. Per-turn ModelChoice remains independent. Selecting a
custom model while signed in must not change ModelAccess.kind from oomol to
local, because the OOMOL runtime still provides built-in providers and account
access. These are internal unions, not public interfaces or provider
registries. No compatibility getter or forwarding cloudRuntime wrapper should
remain after the call sites are updated.

### 3.2 Use one active Link runtime

The persisted selection is either oomol or openconnector. The actual active
runtime and runtime availability are derived separately:

- OOMOL is available only while an OOMOL account is authenticated.
- OpenConnector is available only when a usable configuration exists and any
  configured secret can be decrypted and matches the saved normalized API
  origin. Transient endpoint reachability is reported as status and does not
  make the saved configuration unavailable.
- active equals selected when the selected runtime is available; otherwise it
  is none. active describes the resolved Link runtime, not whether an Agent
  with a usable model has mounted Link tools.
- A missing persisted file defaults selected to oomol so existing users keep
  current behavior.
- Signing out changes OOMOL availability and active, but does not rewrite
  selected.
- An offline OpenConnector endpoint changes runtime status, but does not delete
  or replace the selection.
- Removing an OpenConnector configuration never changes selected. If it was
  selected, selected remains openconnector and active becomes none until the
  user explicitly selects OOMOL or saves a usable OpenConnector configuration.
- Signing in or out must not silently overwrite an explicit OpenConnector
  selection.

RuntimeCapabilities.connectors is a later Agent-level derivation and requires
both an available active Link runtime and a runnable Agent. Do not use active
alone to expose Chat Link tools.

Do not merge catalogs, search both runtimes, or automatically retry a failed
OpenConnector action through OOMOL. Multiple simultaneous runtimes would
require source-qualified action identity, connection namespaces, authorization
routing, and runtime-aware idempotency keys and is outside this plan.

### 3.3 Keep credentials inside the Main and Agent trust boundary

The OpenConnector runtime token:

- may exist in the renderer only as new user input in a password field and one
  IPC request;
- is cleared from renderer form state after submission;
- is encrypted with Electron safeStorage;
- is decrypted by the main process for exact-origin connection tests, redacted
  runtime status or inventory reads, and Agent runtime assembly;
- when OpenConnector is active, is passed only to the credential-bearing Agent
  sidecar environment as OO_CONNECTOR_TOKEN and from there to its oo child
  processes;
- once stored, is never returned to the renderer by an IPC method or event;
- is never included in a diagnostic, runtime key, error message, or log;
- must not be exposed by logging the raw save or test request;
- is represented publicly only by tokenConfigured;
- rejects basic_text and unknown safeStorage backends on Linux.

The Agent sidecar is part of the trusted computing base, like the current
OOMOL credential-bearing sidecar. A process with arbitrary execution inside
that environment can inspect inherited variables; this design does not claim
process isolation between bash and OO_CONNECTOR_TOKEN. Instead, Wanta must
prevent model-issued direct oo commands from reconfiguring endpoints,
persisting connector credentials, or expanding secret environment variables.
Phase 5 defines that permission boundary. If treating the sidecar as trusted is
not acceptable, stop and design a main-process oo broker; do not partially
simulate broker security with command-pattern checks.

Wanta must not store the OpenConnector admin token, OAuth client secrets, or
provider credentials. Provider credentials remain owned by OpenConnector.

### 3.4 Keep OpenConnector an external runtime

The first release connects to an existing endpoint. It does not:

- launch the sibling connect repository as an Electron child process;
- bundle OpenConnector, its database, or its Web Console;
- manage OpenConnector migrations or updates;
- copy the complete OpenConnector credential and OAuth management UI;
- introduce an OpenConnector admin-token boundary into Wanta.

## 4. User-facing behavior

Settings gains a Link Runtime section where the user can:

1. See the selected and actual active Link runtimes.
2. Select OOMOL or OpenConnector.
3. Enter an OpenConnector base URL.
4. Optionally enter a separate Console URL for split API/UI deployments.
5. Optionally enter a runtime token.
6. Test the connection.
7. Save the configuration and use it.
8. Clear a stored runtime token.
9. Remove the entire OpenConnector configuration.
10. Open the OpenConnector Console.

When OpenConnector is active and the Agent has a usable model:

- the existing list_apps, search_actions, inspect_action, and call_action
  workflow is available;
- the Connections route shows runtime status and a sanitized connection
  inventory;
- a missing provider connection produces a structured authorization issue;
- its action opens <consoleUrl>/providers/<service> in the system browser;
- the first release asks the user to retry after completing configuration
  instead of polling an external browser flow indefinitely.

When OpenConnector is active but no model is available, Settings and
Connections still expose its configuration and runtime status, while Chat
remains model_required and advertises no executable Link tools.

## 5. Phase 0: branch and baseline

### Work

- Create a throwaway feature branch from the latest main.
- Preserve the existing user-owned package-lock.json modification.
- Implement directly on the current feature branch, as requested by the
  implementation owner; do not reset or discard the existing modification.
- Record the current four quality-gate results.
- Run Wanta once and verify the current OOMOL, local custom-model, and
  Connections behavior.
- Start /Users/su/oomol-lab/connect and verify both /health and /v1/health.
- Verify oo 1.5.1 schema-cache isolation before implementation:
  - run mock connector endpoints A and B from the same temporary OO_DATA_DIR;
  - return different schemas for the same service and action from each
    endpoint;
  - run oo connector schema in the sequence A -> B -> A;
  - record the exact commands, temporary directories, mock routes, returned
    schemas, and observed cache files;
  - when an OOMOL login is available, separately smoke hosted OOMOL ->
    self-hosted OpenConnector -> hosted OOMOL to verify backend and account
    namespace behavior.
- If the schema cache is not endpoint-aware, partition the Agent OO_DATA_DIR by
  a stable hash of the backend and normalized endpoint. Prefer this over a
  broad cache clear or refresh on every runtime switch.
- Keep oo CLI pinned at 1.5.1 unless a real runtime smoke test proves that a CLI
  fix or upgrade is necessary.

### Verification

```bash
rtk npm run ts-check
rtk npm run lint
rtk npm run format
rtk npm test
```

### Exit criteria

- Pre-existing failures are documented rather than attributed to this feature.
- A real OpenConnector development runtime is reachable.
- The current OOMOL behavior has a reproducible baseline.
- The oo 1.5.1 schema-cache isolation result is documented, and the required
  OO_DATA_DIR strategy is decided before Agent environment implementation.
- The deterministic A -> B -> A probe passes independently of whether hosted
  OOMOL credentials are available.

### Implementation record

- The implementation stayed on the existing feature branch and preserved the
  user-owned `package-lock.json` modification.
- The pre-change baseline passed `ts-check`, `lint`, `format`, and all 1,763
  tests in 251 files.
- The oo 1.5.1 A -> B -> A probe used one temporary `OO_DATA_DIR`, two mock
  connector origins, and the same service/action identity with deliberately
  different schemas. The observed schemas were A, B, A; endpoint switching did
  not reuse the other origin's schema. No additional `OO_DATA_DIR` partition is
  required.
- The production implementation keeps one isolated Agent oo store and adds
  backend plus normalized endpoint identity to Wanta's in-memory inventory,
  authorization, probe, and circuit-breaker keys.
- Final quality gates passed: `ts-check`, `lint`, `format`, and 1,790 tests in
  252 files.
- Real smoke used the sibling OpenConnector with a temporary data directory on
  port 3100. `/health`, `/v1/health`, and `/v1/apps` returned the expected
  responses; bundled oo 1.5.1 completed apps, search, schema, and a live
  `hackernews.get_top_stories` action through `OO_CONNECTOR_URL` with the full
  isolated environment.
- Wanta then launched against a temporary Electron userData directory with the
  no-token OpenConnector selected. The Settings route reported it active and
  online while Chat remained `model_required`; the Connections route rendered
  all nine no-auth apps from the redacted main-process inventory. No temporary
  credential, userData, oo store, screenshot, or OpenConnector database was
  retained after the smoke.
- A live signed-in OOMOL browser/account regression was not repeated because it
  requires an interactive account session. Existing OOMOL behavior is covered
  by the unchanged baseline plus manager, tool, permission, workspace, Skills,
  ChatService, and capability regression tests.

## 6. Phase 1: Link runtime configuration and secret boundary

### 6.1 Module layout

Add:

```text
electron/link-runtime/common.ts
electron/link-runtime/node.ts
electron/link-runtime/node.test.ts
```

Keep storage internals private in node.ts if they remain cohesive. Do not add a
thin store file solely to wrap one owner.

### 6.2 Public IPC contract

common.ts exposes only redacted state:

```ts
export type LinkRuntimeSelection = "oomol" | "openconnector"
export type ActiveLinkRuntime = "none" | LinkRuntimeSelection

export interface OpenConnectorSummary {
  baseUrl: string
  consoleUrl: string
  tokenConfigured: boolean
}

export interface LinkRuntimeAvailability {
  oomol: boolean
  openconnector: boolean
}

export type OpenConnectorRuntimeStatus =
  | { kind: "unknown" }
  | { kind: "online"; checkedAt: number }
  | { kind: "offline"; checkedAt: number }
  | { kind: "unauthorized"; checkedAt: number }
  | { kind: "incompatible"; checkedAt: number }

export interface LinkRuntimeState {
  selected: LinkRuntimeSelection
  active: ActiveLinkRuntime
  availability: LinkRuntimeAvailability
  openConnector?: OpenConnectorSummary
}
```

The public service operations should be explicit:

```ts
getState(): Promise<LinkRuntimeState>

getOpenConnectorStatus(): Promise<OpenConnectorRuntimeStatus>

saveOpenConnector(input: {
  baseUrl: string
  consoleUrl?: string
  runtimeToken?: string
}): Promise<LinkRuntimeState>

testOpenConnector(input: {
  baseUrl: string
  runtimeToken?: string
}): Promise<OpenConnectorTestResult>

selectRuntime(kind: "oomol" | "openconnector"): Promise<LinkRuntimeState>

clearOpenConnectorToken(): Promise<LinkRuntimeState>

removeOpenConnector(): Promise<LinkRuntimeState>
```

Do not replace these operations with one broad updateConfig request containing
ambiguous boolean switches.

Persist selected, never active. The manager derives availability and active
from the saved selection, OOMOL authentication, OpenConnector configuration,
and secure-storage readability. Endpoint reachability belongs in runtime
status, not in the availability calculation.

Runtime status is an on-demand, non-persisted health snapshot with a short TTL
and in-flight request merging. The Renderer owns the transient checking state.
Configuration, authentication, and Agent-runtime changes invalidate the cached
snapshot; Settings reloads it on mount and after save, test, select, clear,
remove, sign-in, sign-out, or Agent recovery. Health results never rewrite
selected, active, or availability.

Status mapping is explicit:

- unknown means there is no usable saved configuration or no completed check;
- online means the validated OpenConnector health envelope succeeded;
- offline covers timeout, connection, DNS, and TLS failures;
- unauthorized means HTTP 401;
- incompatible means the endpoint responded but failed the OpenConnector
  status, envelope, or runtime-identity contract.

### 6.3 Private manager and public facade

Create an unregistered LinkRuntimeManager that owns:

- persisted configuration;
- safeStorage encryption and decryption;
- active-runtime resolution;
- endpoint validation;
- connection tests;
- runtime-status caching and invalidation;
- private LinkRuntime assembly for AgentManager.

Register only a thin LinkRuntimeServiceImpl facade with
@oomol/connection. Every public method must return a redacted state.

### 6.4 Persistence

Use one file unless implementation evidence requires a separate secret file:

```text
<userData>/link-runtime.json
```

Example private shape:

```json
{
  "version": 1,
  "selected": "openconnector",
  "openConnector": {
    "baseUrl": "http://localhost:3000",
    "consoleUrl": "http://localhost:5173",
    "encryptedRuntimeToken": "base64 ciphertext"
  }
}
```

safeStorage encrypts a serialized credential payload rather than a bare token:

```ts
interface StoredRuntimeCredential {
  version: 1
  origin: string
  token: string
}
```

origin is the normalized baseUrl origin at the time the token is saved.

Requirements:

- use node:fs/promises;
- use an atomic write;
- write mode 0600;
- treat a missing file as selected = oomol without requiring a migration write;
- persist selected, never the derived active or availability values;
- never add a synchronous main-process fs API;
- preserve the previous valid configuration when a write fails;
- roll back a token update when the metadata write fails;
- encrypt the versioned origin-plus-token payload as one safeStorage value;
- after decryption, compare the payload origin with the current normalized
  baseUrl origin before any use;
- treat a missing, malformed, undecryptable, or origin-mismatched payload as
  OpenConnector unavailable and never send its token;
- let tokenConfigured report only that ciphertext exists; availability still
  requires successful decryption and origin validation;
- reject an origin-changing save with an existing token unless the request
  supplies a new token or the user clears the old token first;
- removing OpenConnector deletes its endpoint and ciphertext but does not
  change selected;
- remove deleted data completely without compatibility shims;
- reject weak or unknown Linux safeStorage backends.

### 6.5 Endpoint validation

Validate baseUrl and consoleUrl at the public service boundary:

- accept only http: and https:;
- reject embedded username or password fields;
- remove query and fragment components;
- require origin-style URLs rather than /v1, /mcp, or a Console route;
- normalize a trailing slash;
- default consoleUrl to baseUrl for same-origin deployments;
- use baseUrl only for API and health traffic, and consoleUrl only for browser
  destinations;
- never attach the runtime token or credential-bearing query parameters to
  consoleUrl;
- allow loopback and explicitly configured private-network endpoints because
  self-hosting is an intended use case;
- never hardcode localhost:3000 as the production value.

### 6.6 Connection test

Test:

```text
GET <baseUrl>/v1/health
Authorization: Bearer <runtime-token>
```

Omit Authorization when no token is provided. Validate:

- a successful HTTP response;
- the standard JSON envelope;
- data.ok === true;
- data.runtime === "oomol-connect".

Return distinct redacted outcomes for:

- unreachable runtime;
- timeout;
- TLS failure;
- HTTP 401;
- non-OpenConnector endpoint;
- unsupported response body.

A saved token may be reused only when the main process normalizes the test URL
and confirms that its origin exactly equals the persisted baseUrl origin. A
changed or new base URL without a newly supplied token receives an
unauthenticated test. Token-bearing health requests use redirect: "manual";
they must never forward the token across an origin redirect. A same-origin
redirect may be followed only through an explicit same-origin check.

### 6.7 Phase exit criteria

- The renderer can read selected, active, availability, baseUrl, consoleUrl,
  and tokenConfigured without receiving a stored token.
- Save, update, preserve, clear, remove, and rollback behavior is tested.
- The persisted file never contains the plaintext token.
- The connection test distinguishes an invalid token from an offline runtime.
- A saved token is never sent to a changed endpoint or across a cross-origin
  redirect.
- Changing only the persisted baseUrl while retaining old ciphertext makes the
  runtime unavailable and does not send Authorization to the new endpoint.
- Runtime status remains separate from availability and is invalidated after
  every relevant configuration, authentication, or Agent-runtime change.

## 7. Phase 2: separate model and Link runtime resolution

### 7.1 Model access and model choice

electron/runtime/agent-runtime.ts remains responsible for resolving account
access. Rename the current cloud-runtime output to modelAccess where
necessary, but keep the existing default ModelChoice and per-turn ModelChoice
as separate values. A signed-in account retains oomol ModelAccess even when
the selected/default model is custom.

The main-process assembly becomes conceptually:

```ts
const modelAccess = resolveModelAccess(account)
const defaultModel = resolveDefaultModel(selected, customModels)
const links = await linkRuntimeManager.resolve(account)
```

### 7.2 AgentManager input

Replace cloudRuntime with:

```ts
modelAccess: ModelAccess
defaultModel: ModelChoice
linkRuntime: LinkRuntime | null
```

Update all internal call sites directly. Do not preserve the old field through
a compatibility layer.

### 7.3 Runtime restart ownership

Schedule an Agent refresh when:

- the OpenConnector endpoint changes;
- the OpenConnector Console URL changes;
- the runtime token changes or is cleared;
- the persisted Link runtime selection changes;
- sign-in or sign-out changes the selected runtime's availability.

OOMOL team changes continue through the existing team-scope update without a
sidecar restart when OOMOL remains the selected Link runtime.

Use agentRuntimeVersion or another non-secret revision to invalidate runtime
assembly. Never put a raw token into a key, event, log, or diagnostic field.

### 7.4 Runtime capabilities

Change RuntimeCapabilityOptions to carry connector availability independently:

```ts
interface RuntimeCapabilityOptions {
  mode: RuntimeMode
  localAgentAvailable: boolean
  linkRuntimeAvailable: boolean
}
```

Derive:

```ts
const oomol = mode === "oomol"

return {
  mode,
  localAgent: localAgentAvailable,
  localTools: localAgentAvailable,
  customModels: true,
  oomolCloudModels: oomol,
  connectors: localAgentAvailable && linkRuntimeAvailable,
  teams: oomol,
  billing: oomol,
  cloudSkills: oomol,
  voice: oomol,
}
```

### 7.5 Renderer capability split

Replace the broad cloudEnabled use with explicit values such as:

```ts
oomolEnabled
linksEnabled
```

Use:

- oomolEnabled for teams, billing, cloud Skills, voice, and OOMOL account data;
- linksEnabled for chat Link tools and connection authorization affordances;
- LinkRuntimeState for OpenConnector configuration, selected and active state,
  availability, status, inventory, and external connection management.

linkRuntimeAvailable means the selected Link runtime can be resolved; it is a
configuration/runtime fact, not an Agent capability. RuntimeCapabilities.connectors
means the current Agent has actually mounted Link tools, permissions, and the
Link-aware prompt. A selected and available OpenConnector may therefore have
active = openconnector while connectors remains false because the Agent still
needs a model.

### 7.6 Phase exit criteria

Unit tests cover:

- OOMOL model access plus a built-in model and OOMOL Link runtime;
- OOMOL model access plus a custom model and OOMOL Link runtime;
- OOMOL model access plus a built-in model and OpenConnector;
- OOMOL model access plus a custom model and OpenConnector;
- local model access plus a custom model and OpenConnector;
- local model access plus a custom model without a Link runtime;
- OpenConnector without a model, which remains model_required;
- signed out, OpenConnector active, and no custom model yields connectors =
  false and exposes no executable Chat Link affordance.

## 8. Phase 3: assemble the oo CLI for OpenConnector

### 8.1 Environment construction

Refactor electron/agent/oo.ts so common isolation variables and
backend-specific credentials are assembled separately. Keep two explicit
owners:

```ts
buildOomolMaintenanceEnv(...)
buildAgentLinkEnv(...)
```

buildOomolMaintenanceEnv is used by SkillService and other OOMOL account or
registry maintenance. It always receives the OOMOL session token, regardless
of the active Link runtime. buildAgentLinkEnv is used only for Agent Link
tools and branches between OOMOL and OpenConnector. SkillService must never
consume a generic environment derived from the active Link runtime.

Every oo subprocess environment retains:

```text
OO_CONFIG_DIR
OO_DATA_DIR
OO_LOG_DIR
OO_SKILLS_SYNC_DISABLED=1
OO_NO_SELF_UPDATE=1
OO_TELEMETRY_DISABLED=1
OO_LOG_LEVEL=warn
WANTA_OO_BIN
```

Every Agent runtime also receives:

```text
WANTA_TEAM_SCOPE_PATH
```

The legacy environment name remains because this file also carries
sessionKnowledgeBaseIds for query_knowledge; renaming it is outside this
feature. Resolve OO_DATA_DIR according to the Phase 0 schema-cache probe so
incompatible endpoint schemas never share a cache namespace.

OOMOL adds:

```text
OO_API_KEY
OO_ENDPOINT
WANTA_ENDPOINT
WANTA_CONNECTOR_URL
WANTA_CONSOLE_URL
WANTA_LINK_RUNTIME=oomol
WANTA_TEAM_NAME
```

OpenConnector adds:

```text
OO_CONNECTOR_URL=<baseUrl>
OO_CONNECTOR_TOKEN
WANTA_CONNECTOR_URL=<baseUrl>
WANTA_CONSOLE_URL=<consoleUrl>
WANTA_LINK_RUNTIME=openconnector
```

Only set OO_CONNECTOR_TOKEN when a token exists.

The main process performs safeStorage decryption, then supplies the plaintext
only to the selected credential-bearing sidecar environment. The sidecar and
its oo children inherit the value; it is not written to generated OpenCode
configuration or workspace files. This is an explicit trust boundary, not a
claim that arbitrary sidecar shell execution cannot read process environment.

Do not put the OpenConnector runtime token in OO_API_KEY. OO_API_KEY remains an
OOMOL account protocol field. A direct non-connector oo command must not send
an OpenConnector token to an OOMOL service.

### 8.2 Sidecar assembly

When linkRuntime is non-null:

- inject the oo environment;
- add the bundled oo directory to the preferred PATH;
- emit the Link tools;
- enable the Link-aware prompt;
- use the runtime-specific bash permission policy defined in Phase 5.

When linkRuntime is null, retain the current local bash ask behavior.

### 8.3 Workspace tools

Replace the single cloudRuntime switch with separate tool and bundled-Skill
inputs, conceptually:

```ts
ensureAgentWorkspace({
  connectors: boolean,
  bundledOoSkills: boolean,
})
```

connectors controls the four Link tools; query_knowledge is written for every
Agent runtime. It does not control bundled Skills.

For the first release, bundledOoSkills is true only when the active Link
runtime is OOMOL. Keep the existing oo, oo-find-skills, oo-create-skill, and
oo-publish-skill bundle out of OpenConnector workspaces, even when an OOMOL
account is also signed in: their direct CLI instructions assume the hosted oo
environment and are not an OpenConnector contract. OpenConnector uses the four
typed Link tools and Link-aware prompt instead; do not create a second router
Skill in this feature.

This workspace decision does not disable the app's OOMOL SkillService. Its UI
and main-process install, update, and delete operations remain gated by OOMOL
account capability and use buildOomolMaintenanceEnv regardless of active Link
runtime.

### 8.4 Phase exit criteria

- A custom-model plus OpenConnector runtime starts the sidecar.
- All four Link tools exist in its workspace.
- The local no-Link runtime remains unchanged.
- The runtime token is absent from every generated .opencode file.
- The runtime token exists in plaintext only in the trusted OpenConnector
  sidecar/process environment and its child oo process environment.
- The full isolated OO\_\* environment is present for spawned oo commands.
- query_knowledge remains available in an OpenConnector runtime and reads
  sessionKnowledgeBaseIds from WANTA_TEAM_SCOPE_PATH.
- With an OOMOL account signed in and OpenConnector active, Skill registry
  install, update, and delete still use the OOMOL maintenance environment.
- No bundled oo Skill is copied into an OpenConnector workspace; an OOMOL Link
  workspace retains the existing four-Skill bundle.

## 9. Phase 4: adapt Link tool identity and wire contracts

### 9.1 Backend-aware identity

Replace the current mandatory team identity in electron/agent/tool-sources.ts
with:

```ts
type LinkIdentity =
  | {
      kind: "oomol"
      cacheKey: string
      teamName: string
    }
  | {
      kind: "openconnector"
      cacheKey: string
    }
```

Behavior:

- OOMOL reads the per-session team scope and appends
  --organization <teamName>.
- OpenConnector Link identity ignores teamName and sessionTeams.
- OpenConnector appends neither --organization nor --personal.
- OpenConnector's cache key includes its normalized endpoint.
- query_knowledge remains independent of Link identity and continues reading
  sessionKnowledgeBaseIds from WANTA_TEAM_SCOPE_PATH in every Agent runtime.
- Schema caches use the endpoint-aware OO_DATA_DIR strategy decided in Phase 0.

This is mandatory: oo 1.5.1 rejects --organization before sending a request
when a self-hosted connector is selected.

### 9.2 Provider metadata authentication

The direct /v1/providers request resolves its token as:

```ts
const token = process.env.OO_CONNECTOR_TOKEN || process.env.OO_API_KEY || ""
```

When token is empty, send the request without Authorization. Only an OOMOL
identity may add x-oo-organization-name.

An OpenConnector token-bearing provider request uses redirect: "manual" and
may follow only an explicitly verified same-origin redirect. It never forwards
Authorization to a different origin.

### 9.3 Neutral tool language

Replace hardcoded OOMOL Link and active workspace wording with Link runtime and
active Link scope wording while preserving the existing behavioral contracts:

- search only when the task needs a connected account or SaaS action;
- inspect before every call;
- use exact schema field names;
- validate a selected connectionName against list_apps;
- do not guess or silently switch accounts;
- confirm side effects.

### 9.4 Authorization error mapping

Keep the hosted blocking codes:

```text
connection_required
app_not_found
app_not_ready
credential_expired
scope_missing
```

Add the OpenConnector blocking codes:

```text
connection_not_found
oauth_token_expired
oauth_refresh_unavailable
authorization_failed
```

Do not treat these as connection authorization issues:

```text
unknown_service
invalid_input
rate_limited
action_blocked
provider_error
internal_error
```

Preserve the original errorCode in the structured result.

### 9.5 Authorization destinations

Generate:

- OOMOL: <console>/app-connections?provider=<service>
- OpenConnector: <consoleUrl>/providers/<encoded-service>

Reliable search_actions results with authenticated: false must carry the same
backend-aware destination so the suggested authorization flow behaves like an
authoritative call_action failure.

### 9.6 Normalized OpenConnector inventory

Use a private main-process loader as the authoritative OpenConnector inventory
source for Settings, the Connections route, and dynamic authorized-provider
prompt context:

```text
GET <baseUrl>/v1/apps
Authorization: Bearer <runtime-token>
```

The loader validates the standard envelope, applies the same token-origin and
redirect rules as the health check, returns only redacted fields, and maps the
runtime's alias field explicitly:

```ts
connectionName: item.alias
```

It uses a short endpoint-scoped cache with in-flight merging. The embedded
list_apps Agent tool continues to use oo CLI, but contract tests must prove its
connectionName output matches the main-process alias mapping. Do not make the
Renderer parse the raw /v1/apps envelope or choose between API and CLI shapes.

### 9.7 Coordination state

Preserve the current call_action behavior:

- same-action probe merging;
- per-connection authorization circuit breaking;
- maximum action concurrency;
- session isolation;
- connectionName inventory validation.

Add runtime identity to every coordination key so a runtime switch cannot
reuse stale inventory, probe, or block state.

### 9.8 Phase exit criteria

Tests with a mock runtime prove:

- OOMOL commands retain --organization;
- OpenConnector commands never include --organization;
- an OpenConnector alias is exposed by oo as connectionName;
- authenticated and unauthenticated runtimes both work;
- connection_not_found becomes authorization_required;
- invalid_input remains a normal error;
- provider URLs are encoded correctly;
- caches and circuit breakers do not cross endpoints;
- direct /v1/apps inventory maps alias to connectionName and matches oo CLI
  list_apps semantics;
- query_knowledge remains usable while OpenConnector is active.

## 10. Phase 5: align tools, permissions, and prompts

Project rule R7 requires tool availability, permissions, and the system prompt
to change together.

### 10.1 OpenCode configuration

Make connector capability an explicit input to buildOpencodeConfig instead of
deriving it from modelAccess.kind or the selected ModelChoice.

Use the same input for:

- promptCapabilities.connectors;
- the Agent description;
- workspace Link-tool presence;
- Build and Plan prompts.

Pass the active Link runtime kind into permission construction as a separate
input:

- OOMOL retains the existing OO_CLI_BASH_PERMISSION fast path.
- OpenConnector does not reuse that broad allow table. Its four embedded Link
  tools remain available, but direct oo shell commands start at ask.
- No Link runtime retains the current local bash ask behavior.

The ChatService permission context must also know the active Link runtime;
changing only OpenCode's bash table is insufficient because the current local
access policy otherwise auto-allows ordinary commands. While OpenConnector is
active, the policy must:

- never return the oo_cli automatic-allow reason for direct oo commands;
- hard-deny oo connector login, oo connector logout, connector endpoint or
  store reconfiguration, and direct command arguments that reference
  OO_CONNECTOR_TOKEN, OO_API_KEY, or equivalent credential variables;
- treat whole-environment dump commands as credential-sensitive rather than
  ordinary default-allow commands;
- leave any other direct oo invocation behind an explicit permission prompt.

Hard-deny means an OpenCode deny rule or an immediate ChatService rejection,
not a user prompt that can accidentally approve credential reconfiguration.

The existing shell parser and permission tests should be extended rather than
adding a second command parser. These restrictions reduce accidental and
prompt-injection exfiltration inside the trusted sidecar; they are not a
sandbox boundary against a compromised sidecar process.

### 10.2 Workspace identity prompt

For OOMOL:

- preserve the team workspace identity;
- preserve the raw oo organization selector.

For OpenConnector:

- do not claim that the selected OOMOL team scopes Link connections;
- state briefly that Link actions use the configured OpenConnector runtime and
  its runtime-scoped connections.

For no Link runtime:

- retain the current local prompt;
- do not mention Link tools.

### 10.3 Dynamic authorized-provider context

Move AgentManager.buildAuthorizedSystem, authorizedServicesForPrompt, and
listAuthorizedServices from model/cloud runtime ownership to Link runtime
ownership:

- OOMOL retains the current team-scoped hosted /v1/apps lookup.
- OpenConnector reads active services through the normalized private inventory
  loader from Phase 4.
- No Link runtime returns undefined without a lookup.

The authorized-services cache key includes backend kind, normalized endpoint,
and the OOMOL team identity when applicable. Every Link runtime revision,
including endpoint or token changes, cancels or invalidates in-flight loads and
cached results. ModelAccess and ModelChoice must not select this data source.

Add a cross-backend regression: OOMOL has Gmail, OpenConnector does not, the
user is signed in to OOMOL but selects OpenConnector, and the generated system
tail does not claim that Gmail is authorized.

### 10.4 Plan mode

With OpenConnector available, Plan mode may search and inspect contracts but
must not perform Link side effects. Its existing edit restriction remains, and
it receives no OpenConnector direct-oo automatic allow path.

### 10.5 Phase exit criteria

- Tools, permissions, and prompts use one capability source.
- No state exposes tools while the prompt says they are unavailable.
- No state advertises Link tools while the workspace omits them.
- OOMOL direct oo commands retain the existing fast path.
- OpenConnector direct oo commands are never automatically allowed; connector
  login/logout, endpoint/store mutation, and credential-variable expansion are
  denied.
- Permission tests prove direct oo cannot persist a plaintext connector store
  or redirect the inherited token to another endpoint.
- Dynamic authorized-provider context follows LinkRuntime and never reuses an
  OOMOL team cache entry for OpenConnector.
- Every other command still passes through ChatService's local access policy.

## 11. Phase 6: Settings and renderer state

### 11.1 Settings section

Add a separate Link Runtime section rather than placing OpenConnector inside
the OOMOL Account card.

It contains:

- selected runtime and actual active runtime as separate values;
- runtime availability and transient endpoint status as separate values;
- an OOMOL option that is selectable only while signed in;
- an OpenConnector option;
- base URL;
- optional Console URL, defaulting to the base URL;
- runtime token password input;
- token configured status without a secret value;
- Test Connection;
- Save and Use;
- Clear Token;
- Remove Configuration;
- Open Console.

### 11.2 Form semantics

- An empty token while editing preserves the existing token only when baseUrl
  remains on the same normalized origin.
- After save or test submission, clear the token input from renderer state.
- Clear Token is the only endpoint-preserving operation that removes a stored
  token.
- Remove Configuration removes both endpoint and token but does not select
  OOMOL; selected stays openconnector and active becomes none.
- Changing baseUrl origin while a token is stored requires a newly entered
  token or an explicit Clear Token before save; do not silently carry the old
  token to the new endpoint.
- Testing an unchanged saved endpoint may use the saved token in the main
  process only after exact normalized-origin comparison.
- Testing a changed endpoint with no new token is unauthenticated.
- A token-bearing test never follows a cross-origin redirect.
- No error may include the token or a credential-bearing URL.

Settings reads endpoint health through the Phase 1
getOpenConnectorStatus method. It shows checking as local UI state and renders
the returned online, offline, unauthorized, incompatible, or unknown result.
It reloads status after the invalidation events defined in Phase 1 rather than
deriving health from availability or retaining Test Connection output as
permanent state.

### 11.3 Agent restart feedback

After saving and selecting:

- schedule an Agent refresh;
- use the existing starting/restarting status;
- respect the existing scheduler while a generation is active;
- refresh capabilities and connection inventory after recovery;
- retain the saved configuration when startup fails and offer retry.

### 11.4 Localization

Add English source keys and update every existing locale for:

- configured runtime;
- connection test success;
- runtime offline;
- invalid runtime token;
- non-OpenConnector endpoint;
- secure storage unavailable;
- invalid endpoint;
- selected runtime unavailable;
- runtime status unknown, checking, online, unauthorized, and incompatible;
- clear-token and remove-configuration confirmations;
- active OOMOL or OpenConnector runtime.

### 11.5 Phase exit criteria

- A newly typed token exists only in the password input and one IPC request;
  a stored token is never returned to the renderer.
- The form never repopulates an existing token.
- Saving an empty token field does not delete the token.
- Clearing a token still permits an authentication-disabled runtime.
- The Agent returns to ready after a successful runtime change.
- Sign-in and sign-out do not overwrite an explicit OpenConnector selection.
- Removing OpenConnector does not silently switch to OOMOL.
- The UI shows when selected and active differ because a runtime is
  unavailable, without treating transient endpoint downtime as deselection.
- Phase 6 consumes the Phase 1 status contract and has no dependency on a
  later inventory phase.

## 12. Phase 7: connection inventory and authorization UX

### 12.1 Do not reuse the complete OOMOL renderer client

src/lib/connections-client.ts is not an arbitrary connector client. It:

- relies on an httpOnly OOMOL cookie;
- relies on team-scoped headers;
- runs requests in the renderer;
- includes OOMOL usage, execution, federated, OAuth, and callback contracts.

Pointing it at an arbitrary base URL would move the runtime token into the
renderer and mix incompatible management APIs.

### 12.2 Main-process read facade

Reuse the Phase 1 status method and expose only the additional redacted
inventory read needed for the first UI:

```ts
listOpenConnectorApps(): Promise<OpenConnectorAppSummary[]>
```

The app summary contains at most:

```ts
interface OpenConnectorAppSummary {
  service: string
  connectionName: string
  displayName: string
  accountLabel?: string
  authType: string
  isDefault: boolean
  status: "active" | "disconnected"
}
```

The facade delegates to the Phase 4 private main-process /v1/apps loader. It
does not invoke the Renderer client, expose the raw envelope, or assume that
the runtime returns connectionName; the loader explicitly maps alias to
connectionName.

### 12.3 Connections route

Branch by active backend:

- OOMOL keeps the current Connections page and drawer.
- OpenConnector shows endpoint health, the redacted app inventory, an Open
  Console action, and provider-level Manage Connection actions.
- No Link runtime shows configuration choices rather than requiring OOMOL
  sign-in as the only path.

Do not add embedded create, delete, reconnect, OAuth client, or credential
forms in the first release.

### 12.4 Chat authorization

Update the authorization handler:

- OOMOL continues to open the internal drawer and may automatically retry
  after connection readiness.
- OpenConnector uses the structured authUrl and asks the main process to open
  the system browser.
- The original turn remains retryable.
- The first release does not start an unbounded external-flow polling loop.

Suggested authorization from search_actions and authoritative authorization
from call_action must use the same backend-aware handler.

### 12.5 Phase exit criteria

- OpenConnector never opens the OOMOL connection drawer.
- External URLs are limited to http and https by the existing main-process
  boundary.
- Provider services are encoded correctly.
- Browser admin authentication remains owned by OpenConnector.
- Inventory uses the main-process /v1/apps source and maps alias to
  connectionName consistently with Agent list_apps.
- A user can configure a provider externally and retry the original turn.
- The OOMOL drawer and automatic retry behavior do not regress.

## 13. Phase 8: documentation and verification

### 13.1 Reference documentation

Update:

- docs/architecture.md;
- docs/key-decisions.md;
- docs/development.md;
- the relevant root AGENTS.md quick facts.

Document:

- OpenConnector as a Link runtime rather than a sign-in provider;
- the custom-model requirement for signed-out use;
- the single active Link runtime;
- OOMOL team scope versus OpenConnector runtime scope;
- runtime-token storage and process boundaries;
- the credential-bearing sidecar trust model and restricted OpenConnector
  direct-oo policy;
- dynamic authorized-provider context ownership and bundled-Skill gating;
- external OpenConnector credential management;
- the local development startup and smoke sequence.

The code and reference documents become authoritative after implementation;
this plan remains a point-in-time implementation record.

### 13.2 Unit-test matrix

Link runtime storage:

- missing-file migration defaults selected to oomol;
- selected, active, and availability stay distinct;
- first save;
- endpoint update;
- Console URL defaulting and update;
- token update;
- existing-token preservation;
- origin-changing save rejection when it would retain an old token;
- origin-changing save with a new token or after explicit token clear;
- explicit token clear;
- configuration removal without implicit runtime switching;
- write-failure rollback;
- ciphertext contains no plaintext token;
- encrypted credential payload contains and validates its normalized origin;
- persisted baseUrl tampering with unchanged ciphertext makes the runtime
  unavailable and sends no token;
- mode 0600;
- weak Linux storage rejection;
- IPC state redaction;
- saved-token reuse for the exact normalized persisted origin;
- arbitrary new endpoints never receive the saved token;
- cross-origin redirects never receive the saved token;
- URL case, default-port, and trailing-slash normalization cannot bypass the
  same-origin check;
- status kind mapping, short-TTL caching, in-flight merging, and invalidation.

Runtime resolution:

- all model-access, ModelChoice, and Link combinations from section 1;
- a signed-in user selecting a custom model retains oomol ModelAccess;
- sign-in and sign-out;
- backend switching;
- unavailable selected runtime;
- transient endpoint downtime without selection loss;
- independent capability derivation;
- OpenConnector active without a model keeps connectors false and the Agent in
  model_required.

Agent configuration:

- OpenConnector Link prompt;
- four Link tools in an OpenConnector workspace;
- OOMOL direct oo fast permission remains unchanged;
- OpenConnector direct oo receives no automatic allow;
- connector login/logout, endpoint/store mutation, credential-variable
  expansion, and whole-environment dumps are rejected or treated as
  credential-sensitive according to Phase 5;
- OpenConnector cannot create a plaintext oo connector store through an
  automatically approved command;
- unchanged local no-Link runtime;
- Plan mode behavior;
- dynamic authorized-provider context follows LinkRuntime and endpoint-scoped
  cache identity;
- OOMOL Gmail is absent from the system tail when OpenConnector is selected
  and its inventory has no Gmail;
- OOMOL Link workspaces retain all four bundled oo Skills while OpenConnector
  workspaces receive none;
- query_knowledge in an OpenConnector Agent runtime;
- OOMOL Skill registry maintenance while OpenConnector is active.

Tool source:

- backend-specific identity arguments;
- token and no-token headers;
- apps, search, schema, and run;
- connectionName validation;
- authorization error mapping;
- provider URL generation;
- direct /v1/apps envelope parsing and alias-to-connectionName mapping;
- endpoint-scoped caching;
- oo 1.5.1 schema-cache isolation across mock A -> mock B -> mock A;
- optional hosted OOMOL -> OpenConnector -> hosted OOMOL namespace smoke;
- concurrent probe and connection blocking.

Renderer:

- Settings form semantics;
- no token repopulation;
- selected versus active runtime display;
- availability versus transient endpoint status;
- status refresh after configuration, authentication, and Agent events;
- removal keeps selected = openconnector and active = none;
- Connections route branching;
- authorization handler branching;
- separate missing-model and missing-Link messaging.

### 13.3 Real development smoke

Start OpenConnector:

```bash
cd /Users/su/oomol-lab/connect
rtk npm run dev
```

Start Wanta:

```bash
cd /Users/su/oomol-lab/wanta
rtk npm run dev
```

Before feature smoke, repeat the Phase 0 same-OO_DATA_DIR mock A -> mock B ->
mock A schema-cache probe with different schemas for the same action. Verify
the implemented cache namespace follows the recorded endpoint-isolation
result. Run the separate hosted OOMOL namespace smoke only when credentials and
a stable matching action are available.

Scenario A, no-auth action:

- remain signed out of OOMOL;
- configure a custom model;
- configure API base URL http://localhost:3000 and Console URL
  http://localhost:5173 without a runtime token;
- ask for Hacker News top stories;
- verify search, inspect, and call.

Scenario B, runtime token:

- create a runtime token in OpenConnector;
- save it in Wanta;
- verify an invalid old token produces a runtime authentication error rather
  than a provider connection error;
- verify changing the test endpoint without entering a new token does not send
  the saved token;
- verify a cross-origin health redirect does not receive the saved token;
- verify direct oo connector login/logout and commands that expand
  OO_CONNECTOR_TOKEN are not automatically allowed;
- verify no plaintext connector credential is created under OO_CONFIG_DIR;
- update the token and verify Agent recovery.

Scenario C, missing provider connection:

- leave GitHub unconfigured;
- request the current GitHub profile;
- verify the chat authorization issue;
- verify that it opens http://localhost:5173/providers/github;
- configure GitHub in OpenConnector;
- retry and verify success.

Scenario D, OOMOL regression:

- sign in to OOMOL;
- select OOMOL as the Link runtime;
- switch teams and verify the correct --organization value;
- verify the current drawer and automatic retry;
- select OpenConnector and verify that the same team no longer scopes Link
  actions;
- give OOMOL a connected provider absent from OpenConnector and verify the
  dynamic authorized-provider system tail does not mention OOMOL availability;
- while OpenConnector remains active, install, update, and delete an OOMOL
  registry Skill and verify those commands still use the OOMOL account;
- verify the OpenConnector Agent workspace has no bundled oo Skills while an
  OOMOL Link workspace retains all four;
- verify query_knowledge still uses the current sessionKnowledgeBaseIds.

Scenario E, Link available but model missing:

- sign out of OOMOL and remove every custom model;
- keep a usable OpenConnector configuration selected;
- verify active remains openconnector while the Agent is model_required;
- verify RuntimeCapabilities.connectors is false and Chat exposes no
  executable Link affordance;
- verify Settings and Connections still show the OpenConnector configuration
  and its independent runtime status.

### 13.4 Final quality gates

```bash
rtk npm run ts-check
rtk npm run lint
rtk npm run format
rtk npm test
rtk npm run build
```

Because this changes UI and runtime behavior, a successful live npm run dev
verification is mandatory.

## 14. Explicit non-goals

This implementation must not:

- add cloudRuntime.kind = "openconnector";
- put an OpenConnector token in OO_API_KEY;
- return a stored runtime token to the renderer after its one-way input;
- call oo connector login to persist Wanta configuration;
- retain the broad OOMOL direct-oo automatic-allow policy for OpenConnector;
- copy the current bundled oo Skills into an OpenConnector workspace;
- silently select OOMOL when OpenConnector configuration is removed;
- store an OpenConnector admin token;
- copy the full OpenConnector Console;
- turn the OOMOL renderer connection client into an arbitrary endpoint client;
- federate OOMOL and OpenConnector catalogs;
- add a parallel MCP tool path;
- add a main-process oo broker while the credential-bearing sidecar trust model
  remains acceptable;
- bundle or supervise the sibling connect repository;
- upgrade oo 1.5.1 without a demonstrated compatibility need;
- refactor unrelated auth, model, team, billing, or Skill modules.

## 15. Risks and stop conditions

### 15.1 Simultaneous connector runtimes become a requirement

Stop before implementing automatic multi-runtime behavior. Decide:

- source-qualified action identity;
- provider and service collision handling;
- connectionName namespaces;
- authorization destination routing;
- runtime-aware idempotency keys;
- how the model chooses a runtime.

### 15.2 Full in-app credential management becomes a requirement

Stop and design a separate security boundary for:

- OpenConnector admin tokens;
- admin API authorization;
- OAuth callbacks;
- provider credential forms;
- ownership between Wanta and the OpenConnector Console.

This is materially broader than consuming a runtime token.

### 15.3 The real runtime reveals an oo protocol gap

The Phase 0 protocol probe covers the main apps, search, schema, alias,
execution, and endpoint-specific schema-cache paths. Schema-cache isolation
was confirmed by the same-`OO_DATA_DIR` A -> B -> A probe before Agent
environment implementation. If a later real smoke test finds incompatibility in
async actions, transit files, or response envelopes, fix the protocol in oo
CLI or OpenConnector where possible. Do not accumulate one-off compatibility
parsing inside Wanta's embedded tool strings.

### 15.4 The Agent sidecar cannot remain credential-bearing

This plan explicitly trusts the Agent sidecar with OO_CONNECTOR_TOKEN and
hardens model-issued commands without claiming OS-level secret isolation. If
the product requires the sidecar, bash, or OpenCode process to be outside the
credential trust boundary, stop implementation and design a main-process oo
broker with authenticated local IPC, per-call endpoint binding, cancellation,
streaming, and permission propagation. Do not keep the current environment
injection while describing it as broker-equivalent security.

## 16. Definition of done

The feature is complete only when:

- a signed-out user can run the Agent with a custom model;
- the user can configure and select OpenConnector;
- selected, active, availability, and transient endpoint status remain
  distinct, with missing-file migration defaulting selected to OOMOL;
- removing OpenConnector leaves selected = openconnector and active = none
  until the user makes an explicit selection or saves a usable configuration;
- all four Link tools work against OpenConnector;
- OpenConnector may remain active without a model, but Agent connector
  capability stays false until the Agent can actually start;
- query_knowledge continues using sessionKnowledgeBaseIds with OpenConnector
  active;
- OpenConnector calls never carry OOMOL organization identity;
- OOMOL team-scoped connector behavior does not regress;
- OOMOL Skill registry maintenance continues using OOMOL credentials while
  OpenConnector is active;
- the runtime token is encrypted on disk, new input is cleared after one IPC
  request, and the stored token is never returned to the renderer;
- the encrypted credential payload binds token and normalized API origin, and
  an origin mismatch prevents runtime assembly;
- a saved token is never sent to a changed origin or across a cross-origin
  redirect;
- the credential-bearing sidecar trust boundary is documented, OpenConnector
  direct oo has no automatic allow path, and credential/store mutation commands
  are blocked;
- an authentication-disabled runtime works without a token;
- an invalid token, offline runtime, and missing provider connection are
  distinct errors;
- a missing provider connection opens the correct OpenConnector provider page;
- split API and Console origins route health calls and provider pages to the
  correct origins;
- the Connections route shows a sanitized OpenConnector inventory;
- OpenConnector inventory maps /v1/apps alias to connectionName and the dynamic
  authorized-provider prompt follows the active LinkRuntime;
- OpenConnector workspaces contain no bundled oo Skills while OOMOL Link
  workspaces retain the existing bundle;
- tools, permissions, prompts, endpoint-isolated caches, and capabilities
  switch together;
- all quality gates and both-project live smoke scenarios pass;
- reference documentation describes the new ownership boundaries;
- no admin-token, MCP, embedded-runtime, or multi-runtime-federation scope was
  introduced.
