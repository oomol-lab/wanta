# Project-Wide Quality Improvement Plan

> This document defines Wanta's long-term quality-improvement method, to be executed jointly by
> human developers and code agents such as Codex.
> It is not a requirements list for a one-off "big refactor" but a repeatable process of discovery,
> prioritization, fixing, verification, and retrospective.

## 1. Goals and success criteria

The goal of quality improvement is not to make the code "look tidier," but to continuously lower the
following costs without breaking existing product capabilities:

1. The probability that users hit errors, stalls, data loss, or inconsistent behavior;
2. The time developers spend understanding, modifying, and verifying code;
3. Regression risk caused by unclear state boundaries, duplicate implementations, or dead code;
4. Resource waste across the Electron main process, renderer, network, Agent sidecar, and local
   file system;
5. The proportion of code that cannot be verified through automation and can only be guessed at.

Every optimization task must improve at least one observable metric, and cannot use "more elegant
code" or "shorter files" alone as its completion criterion.

Observable metrics include:

- A stably reproducible defect disappears, plus a new regression test that fails before the fix and
  passes after;
- Reduced latency for cold start, page switching, long-session rendering, streaming message updates,
  or a specific operation;
- Reduced CPU, memory, number of network requests, number of IPC calls, redundant computation, or
  bundle size;
- Reduced number of illegal states, number of state sources, or number of duplicate business-rule
  implementations;
- Files, exports, dependencies, or branches proven unreachable are safely removed;
- Tests, runtime verification, or diagnostic capability added on high-risk paths.

## 2. Core principles

### 2.1 Evidence first, then changes

The following are only investigation signals, not problems in themselves:

- A file is very long;
- A component has many hooks;
- Duplicate strings or similar JSX appear;
- A state machine, reducer, context, cache, abstraction layer, or adapter is used;
- A file is temporarily not statically imported;
- A dependency is large.

An agent must first prove that these signals cause a real defect, performance loss, cognitive
burden, or maintenance risk before proposing a change. Never break product capabilities in pursuit
of line count, abstraction count, test coverage, or bundle numbers.

### 2.2 Verify one primary hypothesis at a time

Each PR should center on one primary problem — for example, "long-session streaming updates trigger
re-renders of unrelated components" — rather than a vague "optimize the Chat module." The fix,
tests, and any necessary small-scope refactor can go in the same PR; unrelated formatting, dependency
upgrades, directory moves, and drive-by cleanups must be split out.

### 2.3 Fix the root cause first

Do not mask problems by adding delays, swallowing errors, retrying unconditionally, caching
globally, memoizing carelessly, duplicating state, or widening permissions. Before fixing, you must
state:

- The trigger conditions;
- The root cause;
- Why existing protections did not catch it;
- The minimal responsibility boundary within which the fix is done;
- How to prevent the same class of problem from recurring.

### 2.4 Preserve behavior unless the task explicitly requires changing it

Pure refactors, de-duplication, and file cleanup must preserve external behavior by default. If you
find that interaction, permissions, security boundaries, data formats, compatibility strategy, or
product capabilities need to change, stop the automatic implementation and submit it as a separate
product or architecture decision.

### 2.5 Do not substitute rewriting for understanding

Whole-domain rewrites justified by "unifying the architecture" are forbidden. Prefer small,
rollback-able changes: add tests, extract pure functions, narrow state ownership, eliminate one
duplicate request, fix one resource leak, delete a set of files proven unreachable.

## 3. Wanta's inviolable boundaries

Before performing any quality improvement, the agent must fully read the root guide (AGENTS.md /
CLAUDE.md — one file under two names via symlink), and read the following according to the scope of
the task:

- `docs/architecture.md`: before modifying the main process, preload, renderer, IPC, or Agent data
  flow;
- `docs/conventions.md`: before modifying any code;
- `docs/development.md`: for run, test, build, and Git workflows;
- `docs/key-decisions.md`: before modifying an existing architecture decision;
- `docs/network-request-caching.md`: before modifying renderer requests, caching, or invalidation
  strategy.

Beyond all the hard rules in the root guide, this plan specifically emphasizes:

1. Do not add synchronous file-system APIs in the Electron main process;
2. Do not hardcode the endpoint or expose credentials to the renderer;
3. Do not break the closed loop between OpenCode permission ask and Wanta's two-tier permission UI;
4. When adjusting Agent capabilities, you must synchronously check all three places: tools,
   permission, and system prompt;
5. Do not upgrade pinned OpenCode, oo CLI, and updater-related versions as part of ordinary cleanup;
6. Do not delete, downgrade, or replace the Univer spreadsheet preview and its required
   dependencies;
7. Do not delete files required for dynamic loading, build scripts, packaging resources, CI,
   deep-link, protocol registration, or runtime binaries just because of static-scan results;
8. Use English for all human-readable Git text, Chinese for code comments, and English for code
   identifiers, logs, and system prompts.

## 4. Work products

Quality improvement does not start by editing code straight from search results. On first execution,
establish the following lightweight products; do not pre-create empty files when there is no content:

```text
docs/quality/
  baseline.md          current reproducible quality and performance baseline
  findings.md          ledger of confirmed problems and hypotheses to verify
  decisions.md         quality-related decisions to keep long-term
  runbooks/            only reusable measurement or reproduction runbooks
```

Each problem in `findings.md` uses the following template:

```md
## Q-YYYY-NNN: short, verifiable problem title

- Category: bug | performance | state | duplication | dead-code | maintainability
- Status: hypothesis | confirmed | selected | fixing | verified | rejected
- Area: chat | agent | auth | connections | skills | billing | update | shell | build
- User impact: the impact a user can observe; when there is no user impact, write the development or runtime cost
- Evidence: reproduction steps, failing test, profile, trace, logs, or call counts
- Root cause: do not fill in as fact before it is confirmed
- Scope: the responsibility boundary expected to change
- Guardrails: capabilities and invariants this task must not break
- Before metric: data before the fix
- Target: a goal whose pass or fail can be decided
- Verification: automated tests, quality gates, and runtime verification method
- Risk and rollback: main risks and rollback method
- Priority: P0 | P1 | P2 | P3
- Decision: fix | defer | reject, with the rationale recorded
```

Do not record data that has only static guesses, without reproduction or measurement, as
`confirmed`. Keep a short conclusion for hypotheses proven false and mark them `rejected`, to avoid
later agents re-investigating.

## 5. Full execution phases

### Phase 0: Confirm the workspace and guardrails

Actions:

1. Read the applicable docs and the current Git status;
2. Confirm you are not overwriting the user's uncommitted changes;
3. Create a one-off temporary branch from the latest `main`; if you are already on a conforming task
   branch, do not create another branch;
4. Write down this round's investigation scope, non-goals, and the behavior changes allowed;
5. For tasks touching security, permissions, credentials, update, data migration, or product
   interaction, first list the invariants that must hold.

Exit condition: the scope is clear, the workspace is safe, the required docs have been read, and no
product decision is disguised as code cleanup.

### Phase 1: Establish a reproducible baseline

At minimum run:

```bash
npm run ts-check
npm run lint
npm run format
npm test
npm run build
```

Record Node/npm versions, the Git commit, the platform, command results, and the number of tests.
When the baseline fails, do not pass off pre-existing failures as this round's regression; register
them first, then decide whether to fix them as a separate task.

When UI or runtime is involved, additionally record:

- Time from cold start to the main window becoming interactive, at least 5 runs, reporting the median
  and the worst case;
- Stable reproduction steps for the target page or interaction;
- React Profiler, Chromium Performance trace, network panel, or process sampling evidence;
- CPU/memory attribution for the main process, renderer, and sidecar respectively;
- The account, data scale, session length, and build mode used for measurement, but never record
  credentials.

Exit condition: others can reproduce the same baseline from the record, and know the measurement
error and environment differences.

### Phase 2: Build a system map and audit per domain

Investigate domain by domain along responsibility boundaries; do not randomly clean up by file
extension or file length. Suggested order:

1. Chat data flow: SSE events → main-process translation → IPC → renderer state → timeline/artifact
   rendering;
2. Agent lifecycle: sidecar start/stop, session, permission, tool calls, team switching;
3. Auth and security boundaries: cookie/session token, login redirect, logout, expiry, and log
   redaction;
4. Connections/Skills/Billing request layer: caching, in-flight coalescing, invalidation, error
   mapping, and races;
5. App shell and page state: navigation, current session, panels, dialogs, drafts, and derived
   state;
6. Update, notification, Git, knowledge, and build/release paths;
7. scripts, resources, CI, dependencies, and the packaging manifest.

For each domain, first draw a text map of "single source of state/data → transformations →
consumers → side effects → cleanup," then check for problems. The audit phase records findings only
by default and does not make bulk modifications.

Exit condition: important state and side effects have clear owners, and problems can be mapped to a
responsibility boundary rather than merely pointing at one large file.

### Phase 3: Bug focus

Key checks:

- Async races: an old request overwrites a new one; late responses write back after
  team/account/session switches;
- Lifecycle: subscriptions, timers, AbortController, listeners, workers, object URLs, sidecar, and
  temporary resources not cleaned up;
- Error paths: errors swallowed, loading never ending, cancellation treated as failure, failure
  treated as success;
- State recovery: restart, logout, token expiry, window hide/restore, system sleep/wake;
- Boundary inputs: empty values, large files, long sessions, duplicate events, out-of-order events,
  incomplete tool output;
- Permission and security: the ask/reply loop, external-link protocols, sensitive paths, log
  redaction, the renderer credential boundary;
- Platform differences: paths, protocols, notifications, processes, and packaging behavior on
  macOS, Windows, Linux;
- Data consistency: cache invalidation, optimistic-update rollback, persistence atomicity, and
  version compatibility.

The fix order is fixed: stable reproduction → minimal failing test → root-cause fix → target test →
related-domain tests → full quality gate → necessary real-app verification.

If you cannot reproduce automatically, you must provide repeatable manual steps, diagnostic logs, or
a trace; you may not claim a bug is fixed based on reading code alone.

### Phase 4: Performance focus

Determine the performance budget and scenario first, then profile. Do not add `useMemo`,
`useCallback`, caching, virtualization, concurrency, or workers first and then look for a reason.

#### Rendering performance

Check:

- When streaming tokens arrive, which components re-render, and whether it spreads to unrelated
  sessions, the sidebar, artifacts, or the settings page;
- Whether context values, selectors, or array/object derivations cause whole-tree invalidation;
- Whether effects re-subscribe, re-request, or re-construct expensive objects due to unstable
  dependencies;
- Whether long sessions, images, PDF, DOCX, Mermaid, Shiki, and Univer previews are scheduled by
  visibility;
- Whether list keys, component boundaries, and cache lifecycles are correct;
- Whether long tasks over 50 ms appear during user input, scrolling, and animation.

Use memo only when profiling proves the benefit; the memo's comparison cost, invalidation frequency,
and readability must be counted in the result. Do not trade a downgraded Univer feature for a
performance number.

#### Non-rendering performance

Check:

- Whether the main-process event loop is blocked by synchronous I/O, oversized JSON, compression,
  diff, or file traversal;
- Whether renderer network requests are duplicated, serialized, missing in-flight coalescing, or
  using the wrong TTL/invalidation scope;
- Whether IPC transfers data that is too large, too frequent, or repeatedly serialized;
- Whether Agent SSE translation, session snapshots, artifact scanning, and persistence repeat full
  work;
- Whether the sidecar, workers, previewers, caches, and object URLs have memory growth or leaks;
- Whether startup loads large modules not needed by the current route, and whether they can be
  lazy-loaded without changing behavior;
- Whether build artifacts unexpectedly include runtime dependencies or platform binaries more than
  once.

Performance PRs must give before/after under the same environment, same scenario, and same data
scale. At minimum report the raw data, the aggregation method, and functional-correctness
verification; a single lucky snapshot cannot prove an optimization holds.

### Phase 5: State and over-engineering focus

Classify state first:

- Source state: facts from user input, the server, the main process, or persistence;
- Derived state: can be purely computed from source state;
- Ephemeral UI state: local state such as expansion, focus, hover, transient dialogs;
- Process state: async process state such as requests, streaming tasks, updates, permissions;
- Cached state: data kept for performance but that must have explicit invalidation rules.

Handling rules:

1. Do not keep a second copy of derived state by default, to avoid an effect synchronizing two
   facts;
2. Put ephemeral UI state in the smallest common owner; do not lift it to global;
3. Do not two-way sync server state with a local copy unless the edit-draft and commit boundaries
   are explicitly defined;
4. A cache must state its key, TTL, in-flight coalescing, invalidation, capacity, and
   account/team/session isolation;
5. Use effects for external side effects, not for derivations that can be done in render, event
   handlers, or pure functions;
6. Use a reducer for related state driven by multiple events within one domain, not as a general
   remedy for "the file is too big";
7. Use a state machine only when there are finite named states, explicit events, constrained
   transitions, and illegal combinations already pose a risk;
8. Do not cram an entire page into one giant state machine, and do not wrap simple boolean UI into a
   state-machine framework;
9. Before deleting an abstraction, confirm it is not a process, security, platform, vendor, or
   test-double boundary.

State refactors must list the illegal combinations or synchronization chains before the refactor,
and the state table/transition table after. If you cannot point out which illegal states or side
effects were reduced, do not proceed.

### Phase 6: Duplication focus

Handle duplication in three categories:

1. Rule duplication: the same business decision, error mapping, permission rule, or state transition
   implemented in multiple places; highest priority;
2. Behavior duplication: multiple hooks/components independently doing the same request, caching,
   submission flow, or lifecycle;
3. Appearance duplication: similar JSX, styles, and copy; share only when the semantics and
   evolution direction are consistent.

Before extracting a shared implementation, answer:

- Do they share the same business invariant, or do they just look similar now?
- Will future changes need to be synchronized?
- Is the correct home for the shared layer a pure function, domain model, hook, component, service,
  or vendored UI?
- Does the new abstraction reduce caller knowledge, or does it just concentrate conditionals into a
  more complex do-everything component?

Do not build do-everything components driven by many boolean parameters, a cross-domain `utils.ts`
junk drawer, or a thin wrapper with a single caller and no test value. Intentional duplication is
allowed: code with different security boundaries, platform implementations, vendor adapters, or
diverging future evolution.

### Phase 7: Redundant files, exports, and dependencies focus

Before deletion you must complete a "reachability proof," checking at least:

- TypeScript static import/export and entry files;
- Dynamic imports, string paths, Electron preload/worker/worklet, OpenCode embedded tool source;
- `package.json` scripts, Vite/Vitest/electron-builder config;
- `.github/workflows`, scripts, resources, protocols, icons, packaging extraResources;
- Tests, docs, manual smoke, release, and platform-specific paths;
- npm packages' runtime `require`, peer dependencies, and native modules;
- The reason the file is kept in Git history.

Delete in small batches committed separately, and run the full quality gate and `npm run build`.
When UI, packaging, platform resources, or runtime dynamic loading are involved, you must also
perform the corresponding real-app or packaging verification.

"No reference found by the current search" is not sufficient evidence. When you cannot prove it is
safe, mark the item `hypothesis` and do not delete it.

### Phase 8: Prioritization and selection

Handle the following mandatory priorities first:

- P0: security/credential leak, data corruption, unrecoverable loss, permission bypass, release
  blocker;
- P1: common crashes, core-flow errors, obvious stalls/leaks, cross-account or cross-team
  contamination;
- P2: evidenced maintenance risk, duplicate rules, local performance problems, and high-probability
  regression points;
- P3: low-impact cleanup, naming, file layout, and complexity with no near-term pressure to change.

Ordinary items can be sorted with the following dimensions, each scored 1–5:

- Impact: the impact of a single occurrence;
- Frequency: how often it occurs;
- Reach: the range of users or code paths affected;
- Confidence: the credibility of the evidence;
- Effort: implementation and verification cost;
- Change risk: the risk that the fix itself introduces a regression.

Ordering reference value: `Impact × Frequency × Reach × Confidence ÷ (Effort + Change risk)`. This
value is only for comparison and does not override P0/P1 security and correctness judgments.

Select at most 1–3 mutually independent items that can be fully verified per round. Leave unselected
items in the ledger; do not expand the PR to "finish them while you're at it."

### Phase 9: Implementation loop

Execute each selected item in this order:

1. Establish or confirm the failing evidence;
2. Add the test closest to the root-cause level first;
3. Do the minimal implementation that meets the target;
4. Run the target test and related-domain tests;
5. Review the diff; remove debug code, unrelated formatting, and incidental changes;
6. Run `ts-check`, `lint`, `format`, `test`, and the necessary `build`;
7. For UI/runtime changes, run `npm run dev` for real-app verification and keep logs, screenshots,
   or trace evidence;
8. Update the finding's before/after, risk, verification, and decision;
9. Commit in English; form an independently rollback-able commit after each phase completes;
10. Push the temporary branch and merge into `main` via PR; delete the temporary branch after merge.

Exit condition: the problem has evidence, the fix has verification, external behavior changes are
documented, the rollback boundary is clear, and all gates pass.

### Phase 10: Retrospective and hardening

After the PR merges, determine why the problem entered the codebase:

- Which layer of test or runtime verification was missing?
- Are docs, invariants, or the API unclear?
- Can CI block the same class of problem at low false-positive and low-maintenance cost?
- Do we need to add diagnostics, a performance budget, or dev-time assertions?

Only harden gates that stably catch the same class of problem. Do not stack fragile lint rules,
snapshots, or global abstractions for a one-off problem.

## 6. This repository's first baseline and investigation starting point

Read-only baseline results from 2026-07-18 in the current workspace:

- `npm run ts-check`: passing;
- `npm run lint`: passing;
- `npm run format`: passing, 774 files checked;
- `npm test`: 232 test files, 1554 tests, all passing;
- `npm run build`: passing; Vite warns about several large chunks, which should be a measurement
  starting point rather than a direct conclusion to split bundles;
- About 742 TypeScript/TSX files under `electron/`, `src/`, `scripts/`, totaling about 134,496 lines;
- Only 1 explicit TODO found, in reserved logic of the message-feedback API.

This shows that the first quality-improvement pass should not start from "making existing gates
green," but from runtime evidence, complex data flows, boundary conditions, and long-term
maintenance risk.

The following files can serve as first-round investigation entry points, but must not be refactored
directly just because of their size or hook count:

- `electron/chat/node.ts`: about 1846 lines, sits at the chat-orchestration and multi-kind
  side-effect boundary;
- `src/components/app-shell/AppShell.tsx`: about 1820 lines, contains a lot of page-level state and
  coordination logic;
- `electron/agent/manager.ts`: about 1168 lines, manages sidecar, session, and event lifecycles;
- `src/hooks/useChat.ts`: about 1125 lines, an important boundary for renderer chat state and events;
- `electron/session/node.ts`, `electron/skills/node.ts`, `src/routes/Skills/index.tsx`,
  `src/routes/Chat/TurnOutputs.tsx`: suitable for checking responsibility aggregation, async races,
  and duplicate rules.

We recommend the first round do audit only, output the top 10 evidenced findings, and do no
large-scale refactor. Priority scenarios:

1. Renderer commits, long tasks, and memory growth during continuous streaming output in long
   sessions;
2. Late async results when switching session/team/account quickly;
3. Subscription and resource release on sidecar restart, logout, task stop, and window exit;
4. In-flight coalescing, cache isolation, and targeted invalidation for Connections/Skills/Billing
   requests;
5. Ownership of source state, derived state, and process state in AppShell/useChat;
6. Loading and cleanup of each artifact previewer when invisible, switching, and being destroyed;
7. package/build/runtime file reachability and duplicate packaging, while explicitly protecting
   Univer and the pinned dependencies.

## 7. Agent autonomy boundaries

The agent may implement autonomously:

- Bug fixes with stable reproduction and a clear expected result;
- Local performance optimizations with before/after profiles;
- Small-scope pure refactors that preserve behavior and have sufficient test coverage;
- Redundant-code cleanup for which a full reachability proof is complete;
- Adding tests, diagnostics, and docs.

The agent must pause and request a product or architecture decision to:

- Delete, replace, or downgrade a product capability;
- Change permission, security, credential, data-retention, or external-link policy;
- Change user-visible interaction, compatibility behavior, or error-recovery semantics when the
  requirement does not specify it;
- Introduce a new state-machine framework, global state library, cache framework, or large
  dependency;
- Do a wide cross-domain rewrite, data migration, protocol change, or public-contract change;
- When it cannot prove a file/dependency is unreachable in both runtime and packaged form;
- When verification needs a real account, signed artifact, specific platform, or external service
  that the current environment does not have.

## 8. Master prompt to hand directly to Codex

```text
You are running an evidence-driven quality-improvement loop in the Wanta repository.

First read the root guide in full, and read docs/architecture.md,
docs/conventions.md, docs/development.md, docs/key-decisions.md according to the task scope; when
request caching is involved, also read docs/network-request-caching.md. Strictly preserve all the
security, permission, version, and Univer product boundaries in them.

This round, audit first; unless I have explicitly named a confirmed problem, do not immediately do a
wide refactor.

Execution flow:
1. Check the Git status and current branch; do not overwrite the user's changes.
2. Run and record the ts-check, lint, format, test, build baseline.
3. For the given domain, draw the data/state sources, transformations, consumers, side effects, and cleanup paths.
4. Investigate the five categories bug, performance, state, duplication, dead-code, but treat static signals only as hypotheses.
5. For each finding, give reproduction or measurement evidence, user impact, root-cause confidence, change boundary, risk, verification method, and priority.
6. Output the top 10 findings by priority; mark those with insufficient evidence as hypothesis, never write them as confirmed.
7. Select only 1-3 items with a complete verification loop to implement. For each item, establish failing evidence or a before metric first, then do the minimal fix.
8. Do not upgrade dependencies on the side, format globally, introduce do-everything abstractions, memoize blindly, rewrite whole domains, or delete files based only on the absence of static references.
9. After changes, run the target test, related-domain tests, ts-check, lint, format, test, and the necessary build; UI/runtime changes must be verified in the real app with npm run dev.
10. Report changed files, before/after, all verification results, unverified risks, and suggested next-round tasks.

The completion criterion is not "the code is cleaner," but that one evidenced problem has disappeared, regression protection has been established, and existing capabilities have not regressed.
```

## 9. Single-task prompt

```text
Work on finding <ID>; do not expand to other cleanups.

Before starting:
- Re-check whether the finding's evidence and current code still hold;
- List this task's invariants and the responsibility boundary allowed to change;
- If the workspace has user changes, get out of the way first;
- If a product, permission, security, or architecture decision is needed, stop and explain.

While implementing:
- Bug: add a regression test that fails before the fix first;
- Performance: record before with the same scenario first, then measure after with the same method;
- State: list the duplicate facts, illegal combinations, or effect synchronization chains removed;
- De-duplication: prove that what is shared is a business invariant, not just similar code;
- Deletion: give static, dynamic, build, CI, resource, and runtime reachability proofs.

Do only the minimal fix and preserve external behavior. When done, run the target test, related tests, the four quality gates, and the necessary build/dev verification.
Finally report the root cause, changes, before/after, tests, runtime evidence, risk, and rollback method.
```

## 10. Review checklist

The reviewer or a second agent should independently answer:

- Is the problem's evidence reproducible, or is it only a subjective code preference?
- Do the root cause and the change's level match?
- Is there a smaller, safer fix?
- Would the test fail against the old implementation, and does it test only implementation details?
- Is the performance data same-environment, same-scenario, same-scale, and does it include error
  margins?
- Does it add duplicate state, hidden side effects, an unbounded cache, a leak, or a race?
- Does it wrongly delete a dynamic/build/platform path, or break boundaries such as Univer,
  permissions, credentials, endpoint, or pinned versions?
- Does the PR mix in unrelated formatting, upgrades, renames, or directory moves?
- Did it actually run all gates the repo requires and the necessary real-app verification?
- Does the finding record its conclusion to avoid later re-investigation?

Only when all the above questions have clear answers is the optimization task complete.
