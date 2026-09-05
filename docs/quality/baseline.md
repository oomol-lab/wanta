# Quality Baseline

> This document records the reproducible baseline used for the first round of quality
> optimization. For the long-term method and execution rules, see
> [the whole-project quality optimization plan](../quality-improvement-plan.md).

## 2026-07-18 first-round baseline

Environment:

- macOS Darwin 25.5.0, arm64;
- npm 10.9.4;
- current shell runs Node 22.21.1, below the repo requirement of Node 22.22.2;
- CI uses Node 24, so local results are for spotting regressions while the final merge still
  defers to CI.

Results:

| Check              | Result | Record                                                             |
| ------------------ | ------ | ------------------------------------------------------------------ |
| `npm run ts-check` | pass   | no type errors                                                     |
| `npm run lint`     | pass   | no lint errors                                                     |
| `npm run format`   | pass   | first check covered 774 files                                      |
| `npm test`         | pass   | before changes: 232 test files, 1554 tests                         |
| `npm run build`    | pass   | renderer, main, and preload all built; large-chunk warning present |

Source size is only for scoping the audit, not a quality target:

- about 742 TypeScript/TSX files under `electron/`, `src/`, and `scripts/`;
- about 134,496 lines in total;
- 1 explicit TODO, a known placeholder for the message-feedback API.

## Current verification gaps

- This round had no real account, so login, team switching, connector OAuth, payment return, and
  the Agent conversation golden path were not exercised;
- notifications were not verified against a signed packaged app;
- the September 2026 measurement below covers long-session text streaming; large tool outputs,
  manual scrolling, production-build interaction latency, and multi-process memory curves still
  need separate measurements;
- the current shell's Node version is below the repo minimum and cannot substitute for the Node 24
  CI results.

Later performance findings must stay `hypothesis` until there is same-environment before/after data.

## Results after the first round of fixes

- added 5 regression tests, raising the total from 1554 to 1559;
- `ts-check`, `lint`, `format`, all tests, and the production build pass;
- `npm run dev` starts Vite within 195ms, main/preload build successfully, and the Agent sidecar
  becomes ready normally;
- no new main-process or renderer error logs during the dev-build startup observation window;
- real billing payment return and account/team switching still lack acceptance on a real device
  because no usable test account is available.

## Results after the second round of fixes

- added 2 test files and 7 out-of-order response tests, raising the total from 1559 to 1566;
- `ts-check`, `lint`, `format`, 234 test files, and the production build pass;
- `npm run dev` starts Vite within 322ms, main/preload build successfully, and the Agent sidecar
  becomes ready normally;
- no authentication- or knowledge-base-related errors during the startup observation window; after
  the dev process was ended deliberately, only the expected renderer `clean-exit` was recorded;
- real login callback, account switching, and toggling the knowledge-base beta switch still need
  verification in an account environment.

## Results after the third round of performance fixes

- confirmed the main bottleneck on the first skill inventory is not hashing the 101 skills, but
  agent discovery actually launching third-party CLIs and waiting on `--version` timeout;
- switched to asynchronously checking the executable in the login-shell-merged PATH, no longer
  launching third-party processes for discovery; added 2 regression tests, raising the total from
  1566 to 1568;
- five discovery + scan runs with the cache explicitly reset took 1141–1249ms, and five in-cache
  scans took 50–77ms; the remaining cold-start time comes mainly from resolving the user's login
  shell PATH;
- the real `npm run dev` first inventory scan dropped from the prior three runs' 2097–2154ms to
  610ms, with the following two at 68ms and 65ms; it also correctly discovered Hermes, which the old
  probe timeout had missed, so the final installed-skill count went from 101 to 125;
- `ts-check`, `lint`, `format`, 234 test files, 1568 tests, and the production build pass; the
  dev-build Vite is ready in 198ms, the Agent sidecar becomes ready normally, and there are no
  warn/error diagnostics during the observation window.

## Results after the fourth round of cache-lifecycle fixes

- the billing cache is now cleared when the authenticated identity changes, no longer permanently
  retaining data for historical accounts, teams, and permission combinations after logout or
  account switching;
- cleanup uses a Map detach: an in-flight request from before cleanup, even if it later succeeds,
  can only write back into the already-detached old entry and cannot pollute the new account's cache
  under the same key;
- added 1 regression test, raising the total from 1568 to 1569; `ts-check`, `lint`, `format`, 234
  test files, and the production build pass;
- `npm run dev` is ready in 200ms, main/preload and the Agent sidecar start normally, and there are
  no new warn/error diagnostics during the observation window; the current account environment
  cannot exercise a real account-switch interaction.

## Fifth round performance hypothesis re-review

- thumbnails are generated uniformly by the main process as 160×160 PNGs; the renderer loads only
  near-viewport items and keeps at most 128; the data URLs for solid-color, gradient, checkerboard,
  and incompressible-noise samples are 714, 1914, 886, and 120410 characters respectively;
- 128 extreme-noise thumbnails are about 14.7 MiB of ASCII payload, while common compressible
  samples total about 0.09–0.23 MiB; with no evidence of heap/GC anomalies, raising the byte budget
  would increase the scroll-reload cost, so Q-2026-008 is marked rejected;
- the current real skill inventory is 42 groups, 143367 bytes of JSON; the same normalize +
  stringify two-sided comparison used by the renderer, run 1000 times, has a median of 1.809ms, p95
  of 2.277ms, and max of 2.731ms;
- a 10x synthetic inventory is 420 groups, 1204830 bytes; across 200 comparisons the median is
  16.482ms, p95 is 17.041ms, and max is 20.085ms; neither scale reaches the 50ms long-task
  threshold, so Q-2026-009 is marked rejected;
- both items only update evidence and the decision, with no runtime code changed for the sake of a
  theoretical number.

## Sixth round production artifact first-open re-review

- used the production renderer, a real logged-in workspace, and a fixed 13.2 kB XLSX (3 sheets, 16
  SKUs, 13 columns), with the Chromium cache disabled and a full cold page reload before each
  sample;
- the 5 timings from clicking the artifact to the first canvas of the Univer preview appearing were
  641.5, 570.6, 687.3, 691.7, and 583.4ms, with a median of 641.5ms and a worst of 691.7ms;
- the Univer-related JS chunk was decoded 4,967,993 bytes, encoded 1,368,949 bytes, transfer
  1,369,249 bytes each time, with a resource duration of 117.8–139.1ms; the CSS was decoded 83,587
  bytes, encoded 12,866 bytes, with a resource duration of 9–28ms;
- the renderer heap single-run delta was about 0.09–31.04 MiB, too affected by GC to draw a stable
  memory conclusion from this short test;
- the current real samples' production cold open are all below 700ms, and the build warning itself
  does not prove a perceptible performance problem, so Q-2026-010 is marked rejected; oversized
  workbooks and PDFs are still measured separately per the runbook when a real slow scenario
  appears, and Univer is not deleted, downgraded, or replaced on that basis;
- after the conclusions were written in, `ts-check`, `lint`, `format`, 234 test files, 1569 tests,
  and the production build all pass.

## 2026-09-05: long-session streaming and sidebar invalidation

The measured issue is unnecessary sidebar rendering during assistant text updates.
Four callback props changed identity on each parent render: login, task management,
pointer resize start, and keyboard resize. Stable callbacks now preserve the existing
memoized sidebar boundary. Resize callbacks retain their collapsed/width dependencies;
keyboard updates continue to use functional state updates.

### Reproducible scenario

- Apple M1 Pro, 32 GiB RAM, macOS 26.6.2 arm64, Node 22.22.2;
- Electron 43.4.1 / Chromium 150.0.7871.224, development build, cache enabled,
  DevTools window closed, viewport 1080 × 720 CSS pixels at DPR 2;
- the real AppShell, sidebar, ChatArea, ChatTimeline, turn rows and composer run in
  Electron with identical React Profiler wrappers before and after;
- an in-memory service fixture replaces only session/chat data, with 200 historical
  messages (100 user/assistant pairs; 93,180 text characters), Markdown, no images,
  no artifacts, and one sidebar task;
- each turn emits 625 cumulative text updates at 32 ms intervals, producing 10,000
  characters over 20 seconds; scripted textarea input runs every 250 ms;
- each condition has five runs, discards run zero as warm-up, and measures five seconds
  before and after the streaming window; heap is sampled again 30 seconds after all runs;
- input latency is dispatch-to-next-animation-frame for scripted textarea input,
  excluding the final draft-clear event. It is a scheduling proxy, **not native-input INP**.
  Percentiles use the nearest-rank method.

The fixture bypasses model latency and main-process chat IPC, so this measures renderer
behavior rather than provider throughput or end-to-end request latency. It does not modify
backend chat history. Existing runtime/account setup is used only to load the app shell.

### Before/after results

Values below are measured during each 20-second streaming window. Aggregate durations are
medians of the four valid runs. Profiler subtree durations are inclusive and must not be
summed across nested components.

| Metric                                            |    Before |      After | Interpretation                                                      |
| ------------------------------------------------- | --------: | ---------: | ------------------------------------------------------------------- |
| Sidebar Profiler updates per run                  |   626–627 |        1–2 | Token-driven invalidation removed; real status/clock updates remain |
| Sidebar cumulative render time, median            |  719.7 ms |    4.25 ms | 99.4% reduction in this subtree                                     |
| AppShell subtree cumulative render time, median   | 5067.2 ms | 4739.45 ms | 6.5% reduction in inclusive React render work                       |
| Historical turn Profiler updates during streaming |         0 |          0 | Existing turn identity/memoization remains effective                |
| Scripted input-to-frame p95, median across runs   |   14.2 ms |   13.15 ms | Variable; insufficient to claim a general typing improvement        |
| Animation-frame interval p95, median across runs  |    9.1 ms |     9.8 ms | No overall frame-latency improvement established                    |
| Long tasks over 50 ms during streaming            |         0 |          0 | This fixture did not reproduce a severe stall                       |

Per-run render data, in milliseconds:

| Valid run | Sidebar before | Sidebar after | AppShell before | AppShell after |
| --------- | -------------: | ------------: | --------------: | -------------: |
| 1         |          719.2 |           6.2 |          5078.8 |         4736.0 |
| 2         |          721.9 |           2.7 |          5071.5 |         4768.9 |
| 3         |          718.1 |           5.6 |          5062.9 |         4727.9 |
| 4         |          720.2 |           2.9 |          5021.2 |         4742.9 |

The active timeline continues to do most rendering work. Its commit frequency and cumulative
cost increased after the sidebar fix, while inclusive AppShell render time decreased. Do not
translate the sidebar percentage into a whole-app speedup or claim that smooth-text rendering
has been optimized. The current measurements justify removing callback-induced invalidation,
not replacing the timeline with a virtual list or adding blanket memoization.

### Evidence and remaining coverage

Local raw artifacts are under `.wanta-dev/quality/chat-perf/` and intentionally excluded from
Git: `baseline-confirm.json`, `after-fixed.json`, their `*-summary.json` files, CPU profiles,
Chromium traces, `environment.json`, archived baseline source, and the fixture/collector.
The collector uses only profiling commands over loopback CDP. `diagnostic.json` records prop
names and change counts, without serializing prop values. Prop-identity diagnostics established that all four callbacks must be stable to preserve
the memo boundary.

Full-duration React/RAF/long-task samples were saved. Chromium tracing reached its buffer
limit and retained only the beginning of the run, so it is not evidence for a full-duration
layout/paint/GC comparison. Memory observations are not a leak diagnosis. Native keyboard
latency, manual scroll interaction, large tool results, larger sidebar inventories and
production-build profiles remain separate follow-up scenarios.

Validation includes a React hook regression covering stable callbacks on unrelated renders,
dragging from a keyboard-updated width, Shift+Arrow/Home/End behavior, width persistence and
collapsed-state guards. No changes were made to text batching, message identity, Markdown
semantics or artifact presentation.

## 2026-09-05: active Markdown renderer identity

This round starts after the sidebar fix and isolates MessageResponse preprocessing,
MessageStreamdown rendering, and Chromium layout/paint work. It uses the same 200-message,
93,180-character history, 625 updates over 20 seconds, 10,000-character output and scripted
input scenario described above. There are five runs per condition; run zero is warm-up.
These are separate paired measurements, not percentages to multiply with the sidebar result.

The instrumentation preserves each component's existing memoization behavior. In particular,
ordinary function components are profiled without adding a memo boundary. Exploratory runs
with additional wrapper memoization were discarded. Only `message-before-exact` and
`message-after-exact` are used below. Chromium tracing covers the complete first valid
before/stream/after window, instead of tracing the entire campaign and filling its buffer.
React, frame and input records cover all runs.

### Confirmed cause and minimal fix

MessageResponse created a new `components` object on every render. Streamdown 2.5.0 derives
an inline-code wrapper function from that object's identity; the generated function then
changes the component map passed to its memoized Markdown blocks. Consequently, even
finished paragraphs with unchanged content fail their renderer comparison and are parsed
again. The installed Streamdown implementation and the runtime measurements both support
this mechanism.

The merged component map is now memoized on the caller's `components` override. It remains
stable across text updates while explicit override changes still take effect. This does not
change the smoothing timer/step, Markdown normalization, code-language routing, image policy,
Mermaid safety controls, text batching or message identity. Preprocessing costs were small
relative to Markdown rendering and did not justify a new text cache or worker in this round.

### Measured results

Cumulative durations below are medians of four valid 20-second streaming windows. Profiler
subtree durations are inclusive; MessageResponse and MessageStreamdown must not be added to
AppShell. Input is the scripted dispatch-to-next-frame proxy, not native keyboard INP.

| Metric                                   |     Before |      After |
| ---------------------------------------- | ---------: | ---------: |
| MessageStreamdown subtree render time    |  2875.0 ms |   789.3 ms |
| MessageResponse subtree render time      | 2999.45 ms |   942.1 ms |
| AppShell subtree render time             | 4925.75 ms | 2890.25 ms |
| Input-to-frame p95, median across runs   |   11.75 ms |     7.4 ms |
| Frame-interval p95, median across runs   |     9.2 ms |    9.05 ms |
| Historical-turn updates during streaming |          0 |          0 |
| Long tasks over 50 ms during streaming   |          0 |          0 |

The Markdown subtree's cumulative render time decreased by 72.5%; inclusive AppShell render
work decreased by 41.3% in this development fixture. These are renderer-work measurements,
not provider-response speedups or production-build guarantees. The amount and rate of input
text remained unchanged.

| Valid run | Markdown before | Markdown after | AppShell before | AppShell after |
| --------- | --------------: | -------------: | --------------: | -------------: |
| 1         |       2818.3 ms |       801.0 ms |       4916.2 ms |      2976.9 ms |
| 2         |       3081.0 ms |       774.9 ms |       5145.8 ms |      2881.3 ms |
| 3         |       2915.1 ms |       789.5 ms |       4935.3 ms |      2845.6 ms |
| 4         |       2834.9 ms |       789.1 ms |       4859.0 ms |      2899.2 ms |

The complete representative trace provides an important qualification:

| First valid stream window        |          Before |           After |
| -------------------------------- | --------------: | --------------: |
| Layout count / cumulative time   | 416 / 174.24 ms | 571 / 322.69 ms |
| Paint count / cumulative time    |  974 / 72.85 ms | 1346 / 122.0 ms |
| Minor GC count / cumulative time | 109 / 191.34 ms |  59 / 133.27 ms |

Smoothing updates became more frequent as rendering became cheaper. Layout and paint work
increased rather than disappearing; the large reduction was in Markdown rendering. There
are still roughly 600 invocations per run where the text passed to Markdown has not changed,
and preprocessing continues to run. Their remaining cost needs measurement at larger input
sizes before further restructuring. Native input, large code/tool results, manual scrolling,
and production-build profiles remain follow-up scenarios.

Evidence is local under `.wanta-dev/quality/message-perf/`: the accepted JSON samples, summaries,
representative Chromium traces, full CPU profiles, archived baseline source, and fixture/collector.
Raw artifacts are excluded from Git. A regression test verifies stable component identity across
text changes, explicit inline-code overrides, default image-renderer retention, and restoration
of defaults when the override is removed.

The normal development app also passed a live smoke check with a heading, inline code,
a fenced JSON block, the code-copy control, a two-item list, and the return to idle after
completion. Full validation passed 2996 tests with four skips, TypeScript, lint and formatting.
