# Skill Catalog Caching Design

> Related: [architecture.md](architecture.md) (renderer direct-request boundary) ·
> [team-skills-plan.md](team-skills-plan.md) (team Skill configuration and runtime activation)

## Goals

The Skills page, the team page, and connector recommendations consume the same class of
registry / search data. Caching must be handled centrally in the request client — not maintained
per page with `useState + useEffect` — otherwise page switches produce duplicate requests, and the
detail of the same package gets fetched repeatedly through different entry points.

The cache goals are:

- While an entry is fresh, consumers reuse it; concurrent consumers share the in-flight promise.
  Explicit invalidation and TTL expiry allow a new request.
- The public market, the team market, Provider recommendations, and exact-package-name lookups
  reuse the same package detail.
- Only explicit changes — a user-initiated refresh, a successful publish — force-bypass or
  invalidate the cache.
- Account-private "my published" lists and package details must be isolated per account; they must
  never be reused from the public cache or from another account.
- Installed Skills are a local filesystem inventory and do not enter the catalog cache; their
  correctness continues to be guaranteed by the main-process watcher plus a short-TTL resource.

## Layering and ownership

```text
Pages / dialogs / Provider recommendations
          │
          ▼
src/lib/skills-catalog-client.ts / provider resolution / maintainer client
          │
          ▼
src/lib/skill-catalog-cache.ts
  - keyed cache
  - in-flight dedup
  - TTL / targeted invalidation
  - capacity cap (256 entries)
          │
          ├── search.<endpoint> (public list, search, my published)
          └── registry.<endpoint> (package detail)
```

The cache lives in `skill-catalog-cache.ts`, shared by the catalog, Provider resolution, and
account-scoped maintainer clients. These requests all go directly from the
renderer using the httpOnly session cookie; no main-process forwarding is introduced, and no token
is brought into the renderer.

## Cache scope and TTL

| Data                                   | key scope                                                             |                              TTL | Notes                                                                                                                                                     |
| -------------------------------------- | --------------------------------------------------------------------- | -------------------------------: | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Public market list / pagination        | `public:list:{next,size}`                                             |                            5 min | Shared by the Skills page and the team market                                                                                                             |
| Public market search                   | `search:skills:{query,next,size}`                                     |                            2 min | Search input changes quickly                                                                                                                              |
| Public package detail                  | `public:package:{name,version}`                                       |                           10 min | Shared by exact-package-name lookup, search completion, and Provider recommendations                                                                      |
| My published list                      | `my:{accountId}:{next}`                                               |                            2 min | Account-isolated in-memory cache only                                                                                                                     |
| My published package detail            | `account:{accountId}:package:{name,version}`                          |                           10 min | Never reused across accounts                                                                                                                              |
| Provider → package resolution          | `public:provider:{service,providerDisplayName}`                       |                           10 min | A "package not found" result is kept as a 24 h negative cache                                                                                             |
| Team Skill configuration               | `accountId + teamId`                                                  | 30 s freshness / 24 h local hold | See `useTeamSkills.ts`                                                                                                                                    |
| Local installed Skill inventory        | global resource + main-process scan cache                             |                            5 min | Proactively invalidated on watcher changes; TTL is the fallback for missing directories                                                                   |
| Installed Skill registry version check | auth snapshot + inventory fingerprint (`createVersionReportCacheKey`) |                           30 min | Main-process cache in `SkillServiceImpl.checkSkillVersions` with in-flight dedup; the renderer `skillVersions` resource mirrors it (30 min `staleTimeMs`) |

## Page loading and supplemental details

`useSkillCatalog` owns the Skills page's browse, search, and my-published pagination. Successful
empty results settle as `ready`; only a new query, an explicit retry, or cache invalidation starts
another load. Completed pages survive tab switches. Abandoned requests release their shared-request
consumer, and cancelled pending requests are never reused by new consumers, including StrictMode
remounts. A failed refresh keeps the previous rows and exposes an error for retry.

My-published records that already contain a normalized Skill list render directly, without registry
fan-out. Records without Skill metadata still need a package-info read to distinguish Skills from
other package types. These supplemental reads retain the 20-record limit and concurrency cap of 10,
use the listed version, and inherit `forceRefresh`. Failed supplements reject the page rather than
silently dropping entries or caching an incomplete success. Valid non-Skill package details remain
excluded. New work is not scheduled after a supplemental worker fails.

Maintainer details share in-flight reads and a 30-second cache keyed by account, package, and version.
Explicit retry bypasses that entry; invitations invalidate affected maintainer entries without
refreshing or closing the catalog containing the invitation dialog. Unscoped callers remain uncached.

## Provider recommendation resolution

Team recommendations are not a separate remote list: they are computed from the currently
connected Providers, package resolution results, team configuration, and the local inventory.

- Each Provider first tries the conventional package name `oo-{service}`.
- Only when the conventional package does not match does resolution fall back to market search;
  the search stops as soon as it yields a package that exactly matches the service or Skill name —
  it does not unconditionally run the remaining keyword searches.
- Provider resolution processes at most 4 candidates concurrently, to avoid amplifying registry
  request spikes on team switches.
- The UI does not wait for all Providers to resolve: existing team configuration and
  already-resolved recommendations render immediately; unfinished items show only progress and a
  lightweight loading row.

Once the server provides a batch Provider → package resolver, that endpoint should be preferred
over the client-side heuristic fallback; the client resolution logic is kept as a compatibility
degradation path.

## Invalidation rules

- Skill published successfully: invalidate the current account's "my published" list and private
  package details, plus public market, search, and Provider resolution entries. Shared invalidation
  revisions notify mounted catalog and Provider consumers; an unchanged search query still reloads.
- Sign-in, sign-out, or account switch: clear the entire session-level catalog cache, so no
  package response that may be permission-dependent is ever shown to another account. Provider
  resolution and account-scoped maintainer entries share this same cleanup lifecycle.
- Installing, updating, or deleting a local Skill: only update `skillInventory`; do not invalidate
  the market catalog.
- External agent or Wanta runtime Skill file changes: the main-process watcher immediately
  invalidates the inventory scan cache and broadcasts the change; when nothing changed it does not
  re-recurse and re-hash every Skill.
- Skill version report: watcher-detected inventory changes and auth state changes both call
  `invalidateVersionReport`; the renderer `skillVersions` resource is invalidated on the
  `skillInventoryChanged` event. While the Skills page is visible, the version-report resource
  reloads after invalidation and deduplicates in-flight checks. There is no permanent page-level
  once-only check flag; initial failures wait for retry/re-entry or a subsequent invalidation.
- Team configuration create/update/delete: invalidate the current team's configuration cache; do
  not invalidate public market data.
- Connector set changes: the Provider recommendation layer recomputes per candidate provider key;
  public package details keep being reused.
- Explicit user refresh: the caller passes `forceRefresh` and the client re-requests that key.
- Force refresh and targeted invalidation bump the corresponding key's generation; requests
  started before the invalidation may still return to their original caller, but must not write
  back into the shared cache. `forceRefresh` never reuses an in-flight promise from an older
  generation.
- Besides TTL expiry and targeted invalidation, entries have a third exit path: the cache is
  capped at 256 entries (`skillCatalogCacheMaxEntries`). When a write exceeds the cap, the oldest
  entries in Map insertion order are evicted, and an evicted key's generation is cleaned up
  alongside when it has no pending request.

## Non-goals

- The public market list is not persisted to disk. Freshness of the public catalog matters more
  than reuse across restarts; duplicate requests from page switches and multiple entry points are
  solved by the session-level shared cache.
- "Opening a page" is not a force-refresh trigger. Opening the Market tab only reads the cache;
  the network is hit only on cache expiry, query change, or explicit refresh.
- Team Skill artifact/runtime sync is not mixed into the catalog cache. That layer depends on the
  `resolved` artifact, checksums, and a main-process private directory, and belongs to later
  runtime-sync work.
