# Network Read Caching and Invalidation Policy

> This doc defines the read-resource boundaries for renderer-direct API calls. The goal is to keep
> multiple pages within the same account, workspace, or team from re-requesting the same data,
> while never letting membership, authorization, or payment changes display stale state.

## 1. Unified principles

1. Caches are partitioned by data identity, never by page appearance. For example, the top-bar
   flyout, the purchase dialog, and the billing detail page share one billing resource; inside that
   resource, team plan/usage and the creator's personal balance must still be kept apart — the
   personal balance must never be interpreted as the team wallet.
2. Cache keys must include the data's permission boundary: account, team, workspace, date range,
   and query conditions.
3. In-flight reads for the same key must be merged into a single Promise.
4. After a successful mutation, invalidate only the affected resources; on network errors keep the
   existing read values, but when authorization expires clear sensitive stale display values.
5. Logs, OAuth polling, uploads, submissions, payments, and speech recognition are real-time state
   or user actions — they do not use the generic read cache.

## 2. Existing resources

| Data domain             | Cache boundary                                                                              | Freshness window                                                                                                                                        | Invalidation after mutation                                                                                                                                                                                                                                                                                                                                          |
| ----------------------- | ------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Skill catalog           | Account, filters, and search term                                                           | 2–10 minutes, max 256 entries                                                                                                                           | Publish targets the public catalog/search and the "my published" catalog (`invalidatePublicSkillCatalog` + `invalidateMyPublishedSkillCatalog`); explicit refresh bumps the per-key generation; auth-state changes clear everything and cancel all in-flight requests (`clearSkillCatalogCache`). Install/uninstall do **not** invalidate the registry catalog cache |
| Team skills             | Account and team                                                                            | 30 seconds in memory, max 50 entries, plus a 24-hour persistent localStorage snapshot (key `wanta.team-skill-cache.v3`) — the only persisted read cache | Team skill add/remove/association changes call `invalidateTeamSkillCache(accountId, teamId)` for targeted invalidation                                                                                                                                                                                                                                               |
| Team workspace overview | Account                                                                                     | 30 seconds, with in-flight merging                                                                                                                      | Local `pendingWorkspaceTeamPatches` overlay with a 120-second TTL bridges mutations until the next fresh read                                                                                                                                                                                                                                                        |
| Connections             | Workspace and request path                                                                  | 30 seconds + ETag / Last-Modified                                                                                                                       | Connect/disconnect/alias mutations clear only the affected `/v1/apps` paths in the current workspace; saving an OAuth Client Config additionally invalidates the global provider list and provider-detail cache keys (and the OAuth client config cache itself)                                                                                                      |
| Billing overview        | Account (creator balance/usage/discount subscription), team (Team plan/usage), stats period | 60 seconds                                                                                                                                              | Force refresh after top-up or any subscription/seat change                                                                                                                                                                                                                                                                                                           |
| Team details            | Account, team, and detail resource                                                          | 60 seconds                                                                                                                                              | Clear that team's resources after member or app-authorization changes                                                                                                                                                                                                                                                                                                |
| Member search           | A single add-member dialog, normalized query term                                           | 60 seconds, max 50 entries                                                                                                                              | Cleared when the dialog closes; old requests cancelled when input changes                                                                                                                                                                                                                                                                                            |
| Avatar images           | Currently signed-in account and the full image URL                                          | Max 128 Blob URLs / 256 failure markers                                                                                                                 | Targeted invalidation on avatar update; full clear on account switch or sign-out                                                                                                                                                                                                                                                                                     |

## 3. Team details resource

`src/lib/team-details-resource.ts` is the shared read layer for team members, member summaries,
provider options, and app authorizations. The team management page's member reads are cached per
account and team, with targeted invalidation after member changes.

After adding/removing members, enabling/disabling a member, or updating/revoking an app
authorization, the team management page calls `invalidateTeamDetailsResource(accountId, teamId)`;
mounted subscribers receive the invalidation notice immediately and re-read. For app-authorization
read-modify-write, if the server returned an ETag, the write carries `If-Match` so the server can
reject concurrent overwrites based on a stale version.

## 4. Connector first paint and OAuth

The connector catalog treats the global `/v1/providers` (without a team header) as first-paint
critical data; the team-scoped `/v1/apps` is read concurrently with the catalog, but a permission
denial or transient failure must never clear the public provider grid. In that case the UI keeps a
searchable, filterable read-only catalog and marks the team connection status as `forbidden` /
`unavailable` — an empty array must never masquerade as "confirmed not connected". `/v1/usage/daily`
and `/v1/usage/services` are filled in in the background and must not block the catalog skeleton
from finishing.

When `/v1/apps` succeeds, the team connection summary is shown to current team members, decoupled
from connection-management permission; only write operations — connect, reconnect, disconnect, and
configure — are gated by the management permission. When the read is denied or temporarily
unavailable, members must see an explicit status message; it must not be silently hidden as an
unknown state.

Once a workspace has a successful summary, a partial Apps refresh failure must keep the last
confirmed connection accounts and provider states, updating only the degradation marker; a
transient error must never wipe existing connections from the UI. When switching workspaces,
reusing that stale summary is forbidden.

Connector GETs keep the 30-second cache, ETag / Last-Modified conditional requests, and in-flight
merging; the public provider catalog uses a global cache key, while team resources such as Apps
remain isolated per workspace. On auth-state changes, `clearConnectorCache()` must be called to
prevent team-workspace in-memory results from being reused across accounts. The OAuth Client
Config is an account-level short-lived resource, invalidated immediately after saving the config;
before an OAuth authorization starts, only the active App baseline for the current service is
read — the full catalog and usage are not re-fetched.

A force refresh must not simply reuse an arbitrary old request, or a stale response may be
accepted after a mutation; refreshes from the same UI carry the same `refreshGeneration` and merge
in-flight requests, while a new mutation uses a new generation. App Detail uses the same 30-second
short cache and in-flight merging as the catalog; execution logs remain force-refreshed to keep
audit information fresh.

The Skill catalog likewise maintains a generation per cache key. Publish, explicit refresh, or
targeted invalidation disqualifies in-flight requests of the old generation from writing to the
cache, so a stale response cannot re-pollute the public catalog or the account's private catalog
after a mutation. Public search uses the search response directly, without reading registry
details package by package; "my published" fetches at most 20 packages per page and cancels old
detail-completion requests on page change, refresh, or component unmount. Multiple same-key Skill
reads with an `AbortSignal` still share one underlying request: a caller's cancel only ends its own
wait, and the underlying fetch is aborted only after the last consumer leaves; the full clear on an
auth switch, however, actively cancels all old requests.

## 5. Avatar images

`src/lib/avatar-image-cache.ts` provides an in-renderer Blob URL LRU and in-flight merging for
authenticated avatars on OOMOL domains; ordinary reads let Chromium use its HTTP cache, and only
the targeted refresh after an avatar's content has definitely changed bypasses the HTTP cache.
Avatar requests use a short timeout; after an active fetch fails, loading is handed directly to
`<img>` for a short period, so every component mount does not repeat a failing fetch.

When `CachedAvatarImage` hits the Blob cache it stays visible directly — a cached image must never
be hidden first while waiting for a new `load` event. When the authenticated account changes or the
user signs out, both the avatar image cache and the team details resource must be cleared, to
prevent protected-URL results from being reused across accounts.

## 6. Checklist for new read code

- Does a resource layer for this data domain already exist? If so, reuse it — never start another
  `fetch` inside a page component.
- Does the key isolate account and team/workspace?
- Will multiple components mounting at once cause duplicate requests?
- Do the list, the count, and the detail really need the same full dataset? If only a count is
  needed, prefer a lightweight server-side field or endpoint.
- After a mutation succeeds, which resources must be invalidated? Put the invalidation and the
  mutation in the same success branch.
