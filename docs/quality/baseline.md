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

| Check              | Result | Record                                                              |
| ------------------ | ------ | ------------------------------------------------------------------- |
| `npm run ts-check` | pass   | no type errors                                                      |
| `npm run lint`     | pass   | no lint errors                                                      |
| `npm run format`   | pass   | first check covered 774 files                                       |
| `npm test`         | pass   | before changes: 232 test files, 1554 tests                          |
| `npm run build`    | pass   | renderer, main, and preload all built; large-chunk warning present  |

Source size is only for scoping the audit, not a quality target:

- about 742 TypeScript/TSX files under `electron/`, `src/`, and `scripts/`;
- about 134,496 lines in total;
- 1 explicit TODO, a known placeholder for the message-feedback API.

## Current verification gaps

- This round had no real account, so login, team switching, connector OAuth, payment return, and
  the Agent conversation golden path were not exercised;
- notifications were not verified against a signed packaged app;
- long-session React Profiler, Chromium Performance traces, and multi-process memory curves have
  not yet been collected;
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
