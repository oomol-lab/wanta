# Cloud workflows

Wanta embeds Console's shared `@oomol-lab/open-flow/workbench` runtime, pinned to
`0.1.0-beta.59`, with the matching `effect` peer dependency. The sidebar entry is
immediately below Knowledge. The route supports the shared workflow catalog,
designer, publications, runs and variables; execution remains in Open Flow Cloud.

## Host boundary

`src/routes/Flows/host.ts` implements the WorkbenchHost contract. HTTP requests use
`oomolFetch`, the existing HttpOnly session cookie and `openFlowBaseUrl` from the
single endpoint source. The host accepts Request objects without losing their
body, headers or cancellation, fixes `x-oo-team-name` to the active team's name,
rejects other origins and rejects redirects. Knowledge's team-ID header must not
be substituted for this team-name header.

There are independent catalog and per-flow WSS subscriptions with readiness,
bounded reconnect backoff, event validation and resynchronization after reconnect.
The host handles beta.52's `flows.changed`, `flow.created`, `draft.changed`,
`run.created`, `run.changed` and `access.changed` events. Disposing the host aborts
requests, closes sockets, clears reconnect timers and dismisses its notification.

External authorization resolves the final HTTP(S) URL before invoking the existing
`chat.openExternalUrl` host capability. It does not open an intermediate blank
window. When OOMOL Link is active, connection configuration opens Wanta's Connections
page; with a different Link runtime it opens the current team's OOMOL Console
connections page without changing the selected runtime.

## UI and lifecycle

Navigation is controlled by WorkbenchLocation in React state; Wanta does not import
Console's router. Hash hrefs keep internal links inside both Vite and file renderers.
Run-source selection is retained in the location. The current team's workspace is
kept mounted, hidden and inert when visiting another Wanta page, so returning from
Connections preserves the selected flow and lets editor blur-triggered saves finish.
Switching team/account or losing cloud access removes the old instance.

Preference keys include deployment origin, account ID and team ID. Theme and
language follow Wanta without recreating the editor; unsupported package languages
(currently Spanish) use English. All Wanta-owned copy covers the eight app locales.
Paused teams are gated. Creation is disabled in non-writable workspaces, and the
host rejects all mutations there using the shared API error shape; other permission
checks remain enforced by the cloud service.

The route import fallback and the shared workbench startup gate use the same list
skeleton. The startup overlay follows beta.52's direct busy `main` element through
a scoped CSS `:has()` selector, so it remains visible until the workbench is ready
and disappears for loaded content or error/retry UI.

The route and shared styles load lazily. Vite prebundles the workbench in development
to avoid a first-visit dependency-optimization reload. A small scoped catalog CSS
adaptation switches to the shared compact columns at 1000px of available workspace
width, preventing fixed metadata tracks from overlapping actions beside the sidebar.

The shared code editor saves on blur and supports its own explicit save command.
Keeping the workspace alive protects same-team page transitions, but app termination
and team changes are not a transactional save guarantee. Do not claim otherwise
without adding a supported shared-workbench lifecycle contract.

## Verification

Relevant tests cover HTTP Request preservation, credentials, origin checks,
read-only errors, cancellation, notification events, reconnect cleanup, preferences,
scope remounts, language changes and the cloud route gate. Existing knowledge and
connection client tests run with the changed HTTP transport.

Runtime verification uses both Vite's Electron app and the production build loaded
from `dist/index.html` with file:// in an isolated Electron profile. This checks
the actual built renderer and lazy assets; it does not replace signed installer or
cross-platform distribution validation.

Agent editing of the selected flow is a separate integration. No iframe messaging
bridge or new Agent context is introduced by this migration.
