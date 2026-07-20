# Quality-issue ledger

> Status meanings: `hypothesis` only means it is worth measuring; `confirmed` means there is reproducible evidence; `verified` means the fix has passed the full quality gate.
> For the investigation method and priority rules, see [the project-wide quality-improvement plan](../quality-improvement-plan.md).

## Q-2026-001: Server-pushed fresh data can be overwritten by a stale read

- Category: bug | state
- Status: verified
- Area: shell | skills | auth
- User impact: While a background read is still in flight, if an auth-state event or a skill mutation writes updated data, the stale read completing afterward reverts the UI to the old state.
- Evidence: `ResourceStore.setData()` does not advance `requestId`; a new regression test reliably yields `stale` instead of `pushed` on the old implementation.
- Root cause: The shared resource layer only invalidated stale requests on force-refresh and reset, missing authoritative pushes and mutation results.
- Scope: `src/lib/resource-store.ts` and its unit tests.
- Guardrails: Preserve in-flight coalescing for normal reads; the old Promise may still settle for its original caller, but must no longer write the shared snapshot.
- Before metric: 1 deterministic race case fails.
- Target: A stale request that completes after `setData()` must not modify the resource snapshot.
- Verification: 3 regression tests, the full quality gate, production build, and dev-mode startup all pass.
- Risk and rollback: Low; the change only affects eligibility to write the resource snapshot and can be rolled back independently.
- Priority: P1
- Decision: fix

## Q-2026-002: Resource invalidation still reuses an already-stale in-flight request

- Category: bug | state
- Status: verified
- Area: shell | skills
- User impact: When `invalidate()` is called after a skill install, publish, or auth change, a read from before the change can still backfill the cache; the next refresh also reuses the same old Promise.
- Evidence: Two deterministic tests were added; the old implementation does not issue a second read, and a resource with no data stays `loading` forever until the old request completes.
- Root cause: `invalidate()` only set `updatedAt` to null on existing data, without bumping the generation, releasing `inFlight`, or handling the first load.
- Scope: `src/lib/resource-store.ts` and its unit tests.
- Guardrails: Do not cancel the underlying Promise; only block a pre-invalidation request from writing back, and allow a new read to start immediately.
- Before metric: 2 deterministic race cases fail.
- Target: After invalidation a new refresh issues a new request; a completing stale request does not pollute the snapshot; a resource with no data returns to `idle`.
- Verification: 2 regression tests, the full quality gate, production build, and dev-mode startup all pass.
- Risk and rollback: Medium-low; direct callers depending on the old Promise still receive a result, and the shared-snapshot behavior becomes stricter.
- Priority: P1
- Decision: fix

## Q-2026-003: Billing force-refresh reuses a pre-change request

- Category: bug | performance
- Status: verified
- Area: billing
- User impact: On a force-refresh after a top-up, subscription change, payment-dialog close, or re-login, if an old billing request is still in flight, the UI may keep showing the pre-change balance or plan.
- Evidence: `refresh({ force: true })` bypasses the TTL but still runs `entry.promise ?? ...`; call sites explicitly use force after payment, login, and mutations.
- Root cause: Cache freshness and the in-flight request generation were conflated into a single reuse condition.
- Scope: `src/hooks/useBillingOverview.ts` and its unit tests.
- Guardrails: Normal concurrent refreshes keep coalescing; only force creates a new generation; an old request settling must not overwrite the new result.
- Before metric: force and normal refresh both return the same Promise.
- Target: Normal refresh keeps a single request; force returns a new Promise, and the old response must not backfill the cache entry.
- Verification: Two concurrent-ordering unit tests, the full quality gate, production build, and dev-mode startup all pass.
- Risk and rollback: Low; at most one extra billing-aggregation request may be issued, and only on explicit force.
- Priority: P1
- Decision: fix

## Q-2026-004: The initial auth snapshot can overwrite an update event

- Category: bug | state
- Status: verified
- Area: auth
- User impact: At renderer startup, if the auth state changes between `getAuthState` and `authStateChanged`, the old snapshot may briefly or persistently overwrite the new state.
- Evidence: A controlled deferred test proves the old state wins when the event returns first and the initial read returns after; a synchronous event-replay test reliably yields `2 → 1` before the fix.
- Root cause: The initial `getAuthState` and `authStateChanged` each wrote React state directly without a shared generation; an initial failure also left an error behind even after a successful event.
- Scope: `src/hooks/useAuth.ts`, `src/hooks/auth-state-observer.ts`, and their unit tests.
- Guardrails: Do not change the token gating, login callback, or AuthManager boundary.
- Before metric: The event value `2` is overwritten by the late-arriving initial value `1`.
- Target: Any completion order settles on the latest server event.
- Verification: 4 unit tests covering event ordering, errors, and dispose, plus the full quality gate, production build, and dev-mode startup.
- Risk and rollback: Medium; the auth path needs additional real-run verification.
- Priority: P1
- Decision: fix

## Q-2026-005: Knowledge-base list reads lack request-version isolation

- Category: bug | state
- Status: verified
- Area: knowledge
- User impact: When rapidly toggling the beta switch, refreshing, or receiving back-to-back change events, an old list response may overwrite the new list, and the state-update path still runs after unmount.
- Evidence: Two deferred list requests settle in the order new-first, old-last; the old implementation has no condition preventing the last-arriving old list from writing.
- Root cause: Every `load()` call wrote items/error/loading directly, and the effect cleanup only cancelled the event subscription without invalidating an already-started request.
- Scope: `src/hooks/useKnowledgeBases.ts`, `src/hooks/knowledge-base-list-observer.ts`, and their unit tests.
- Guardrails: When beta is off, must not request or inject knowledge bases; on error, preserve the existing recovery semantics.
- Before metric: The old list, old error, and post-unmount result all have a state-write path.
- Target: Only the last read of the currently enabled generation may update state.
- Verification: 3 unit tests covering out-of-order, errors, and dispose, plus the full quality gate, production build, and dev-mode startup.
- Risk and rollback: Medium-low.
- Priority: P2
- Decision: fix

## Q-2026-006: The billing cache lacks cleanup on auth switch

- Category: performance | maintainability
- Status: verified
- Area: billing | auth
- User impact: Billing data is correctly isolated by account and workspace, but after logout and account switching the old balances remain in renderer module memory, growing continuously under long-lived multi-account use.
- Evidence: `overviewCache` is an unbounded module-level Map whose key includes account, workspace, team name, and permission together; an auth change clears the connector, skill, avatar, and team caches, but the old account's billing entry and data have no eviction path.
- Root cause: The billing cache correctly implemented read isolation but was not wired into the lifecycle of the global auth identity; the TTL only decides whether to reuse data, and never deletes the Map entry.
- Scope: `src/hooks/useBillingOverview.ts`, `src/components/AppDataProvider.tsx`, and unit tests.
- Guardrails: Cleanup must not trigger duplicate payments or interpret a personal balance as a team balance.
- Before metric: Each historical account/team/permission combination permanently retains at least one scope Map, and the old data is still readable by its original key after logout.
- Target: After logout or an account change, no old-account billing data is retained.
- Verification: The billing cache is cleared wholesale when the auth identity changes; a regression test proves that after cleanup the same key returns a brand-new empty entry, and an in-flight request settling before cleanup cannot backfill the new cache. The full quality gate, production build, and dev-mode startup pass; constrained by the current account environment, the account-switch interaction has not yet been exercised on a real machine.
- Risk and rollback: Low.
- Priority: P2
- Decision: fix

## Q-2026-007: The renderer cost of streaming updates in long sessions is unquantified

- Category: performance
- Status: hypothesis
- Area: chat
- User impact: May manifest as jank while typing, scrolling, or streaming output.
- Evidence: The main process already coalesces at 32ms and the renderer also buffers events; the current static structure cannot prove that unrelated components still commit.
- Root cause: Unconfirmed; do not blindly memoize based on this.
- Scope: The full path from chat SSE to `ChatTimeline`.
- Guardrails: Preserve the accumulated full-text part, the stable partId, Enter-sends-only, and the artifact hierarchy.
- Before metric: To be collected — commit counts, long tasks, and heap curves for a fixed long session.
- Target: Establish a budget first, then choose optimizations.
- Verification: React Profiler, a Chromium trace, and before/after on the same fixture.
- Risk and rollback: High; do not implement before measuring.
- Priority: P2
- Decision: defer

## Q-2026-008: The thumbnail cache has only an entry cap, no byte budget

- Category: performance
- Status: rejected
- Area: chat
- User impact: 128 data-URL thumbnails could occupy a fair amount of renderer heap in image-heavy sessions.
- Evidence: The main process always compresses thumbnails to a 160×160 PNG, and the renderer keeps at most 128 entries and loads only for near-viewport images. For a deterministic image sample, a single data URL is: solid color 714 chars, gradient 1914 chars, checkerboard 886 chars, incompressible noise 120410 chars; 128 extreme-noise thumbnails total about 14.7 MiB of ASCII payload, while common compressible graphics are only about 0.09–0.23 MiB.
- Root cause: The hypothesis does not hold; the cache already has three upper bounds — size normalization, on-demand loading, and a 128-entry LRU — and no evidence of unbounded growth or of reaching a long-session heap bottleneck was observed.
- Scope: The artifact thumbnail cache.
- Guardrails: Do not reduce image-preview clarity or remove the image gallery.
- Before metric: The total data-URL character count for 128 160×160 incompressible-noise PNGs is about 14.7 MiB; compressible samples are two orders of magnitude lower.
- Target: Add a byte budget only when a profile of a genuinely image-heavy session proves this bounded cache causes heap pressure or GC jank.
- Verification: Encoded-size measurement is complete; if reopened later, collect renderer heap, GC, and cache hit rate per the chat performance runbook.
- Risk and rollback: No code change this round, so no rollback risk; rashly lowering the budget could instead cause repeated IPC and PNG encoding while scrolling.
- Priority: P3
- Decision: reject

## Q-2026-009: Background resource comparison may repeatedly deep-serialize a large inventory

- Category: performance | duplication
- Status: rejected
- Area: shell | skills
- User impact: The per-minute background refresh may incur unnecessary JSON serialization and sorting cost on the renderer main thread.
- Evidence: Reproducing the renderer's comparison path with the current real skill inventory: 42 groups, 143367 bytes JSON, median 1.809ms / p95 2.277ms / max 2.731ms over 1000 comparisons; scaled up to 420 groups, 1204830 bytes, median 16.482ms / p95 17.041ms / max 20.085ms over 200 comparisons.
- Root cause: The hypothesis does not hold; the current once-per-minute ~2ms comparison does not form a 50ms long task, and even at 10x the data it stays below the long-task threshold.
- Scope: `src/components/AppDataProvider.tsx`.
- Guardrails: Must not introduce spurious whole-tree updates via shallow comparison.
- Before metric: Current inventory p95 2.277ms; 10x inventory p95 17.041ms.
- Target: Redesign only when a single comparison reaches 50ms, or a profiler proves it accumulates into perceptible jank on a high-frequency path.
- Verification: Sampled one by one after warm-up in the same process, with the 10x data scale additionally verified; memoization, hashing, and a server-side version field are not implemented.
- Risk and rollback: No code change this round, so no rollback risk; keeping the deep comparison avoids spurious React updates caused merely by an `updatedAt` change.
- Priority: P3
- Decision: reject

## Q-2026-010: A large lazy-loaded chunk may cause noticeable first-open latency

- Category: performance
- Status: rejected
- Area: build | chat
- User impact: On first opening a spreadsheet, the large Univer chunk may cause a user-perceptible wait or a renderer memory spike.
- Evidence: In a production renderer, with the Chromium cache disabled, the same logged-in workspace, and a fixed 13.2 kB XLSX (3 sheets, 16 SKUs, 13 columns), the Univer preview was opened for the first time 5 times, each after a full-page cold reload; using click-artifact-to-first-preview-canvas as an interactivity proxy, timings were 641.5, 570.6, 687.3, 691.7, and 583.4ms, median 641.5ms, worst 691.7ms. The corresponding JS chunk was, each time, decoded 4,967,993 bytes, encoded 1,368,949 bytes, transfer 1,369,249 bytes, with a resource duration of 117.8–139.1ms.
- Root cause: The hypothesis does not hold; the production build's chunk-size warning does not translate into a first-open wait exceeding 1 second in the current real-workbook scenario, and the chunk's resource duration is only part of the end-to-end time, so the remaining time cannot be attributed to download or chunk-splitting strategy.
- Scope: The Vite chunk graph and the Univer artifact-preview dynamic import; no runtime code was changed this round.
- Guardrails: Univer's full-workbook rendering and interaction must not be removed, downgraded, or replaced.
- Before metric: For the fixed sample, production cold-open median 641.5ms, worst 691.7ms; JS resource duration worst 139.1ms.
- Target: No optimization for the current scenario; reopen only when a fixed large-workbook or PDF sample stably exceeds 1 second, or a trace points to a clear parse/evaluate, worker, RPC, or rendering bottleneck.
- Verification: Collected 5 consecutive cold samples on the production bundle via the Chrome DevTools Protocol, with the cache disabled, a full-page reload each time, and waiting for the Univer canvas. The single-shot delta of `performance.memory` is markedly affected by GC (about 0.09–31.04 MiB) and cannot serve as a stable conclusion; future large-file investigations should still collect a full trace and post-close heap per the runbook.
- Risk and rollback: This round only updates evidence and the decision, so there is no code-rollback risk; the sample scale does not represent very large workbooks or PDFs, so those scenarios still need separate measurement when real feedback appears.
- Priority: P3
- Decision: reject

## Q-2026-011: Cold-start skill-inventory scan takes over two seconds

- Category: performance
- Status: verified
- Area: skills | shell
- User impact: On logged-in startup, the skill inventory or the UI that depends on it may be slow to become ready, while the main process simultaneously bears a lengthy file-scan workload.
- Evidence: Across three pre-change dev-mode startups, the full inventory scan took 2097–2154ms; a segmented benchmark shows the skill file scan needs only 32–52ms, while full agent discovery took 2381–2425ms. The old probe concurrently ran `--version` for every candidate CLI; under startup contention Hermes hit the 1500ms timeout and was wrongly judged not installed.
- Root cause: To decide whether an executable exists, agent discovery actually launched every third-party CLI; this both introduced process cold-start and timeout cost and wrongly coupled "the command exists" to "the version subcommand must succeed within 1.5 seconds".
- Scope: `electron/agents/catalog.ts` and its unit tests.
- Guardrails: Preserve login-shell PATH merging, Windows `PATHEXT`, agent ordering, skill-root discovery rules, same-name priority, and watcher behavior; the main process continues to use only async fs.
- Before metric: Actual cold start 2097–2154ms with 63 external skills; the old segmented benchmark's worst case was 2425ms and missed the installed Hermes.
- Target: The actual dev-mode cold-start inventory scan is under 1 second, and third-party CLIs are no longer launched to discover agents.
- Verification: The new implementation checks the absolute path or PATH via async executable access, and covers two regression tests, "does not launch an invalid program" and "PATH hit vs. miss"; five cold discovery + scan benchmarks were 1141–1249ms, five warm scans were 50–77ms; the real dev-mode first inventory scan was 610ms and subsequently 65–68ms, correctly discovering Hermes (125 final entries). The full quality gate, production build, and dev-mode startup all pass, with no warn/error diagnostics during the startup observation window.
- Risk and rollback: Low to medium; an executable that exists but has broken dependencies is still treated as installed, though the corresponding agent still errors on actual invocation; can be rolled back independently to version-subprocess probing.
- Priority: P2
- Decision: fix
