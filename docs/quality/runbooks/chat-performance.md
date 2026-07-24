# Chat and Artifact Performance Measurement Runbook

> For reviewing Q-2026-007 (long-session streaming render) and Q-2026-010 (large preview first open).
> Both depend on a real renderer and a real session or artifact; bundle size or static reading must
> not substitute for runtime evidence.

## 1. Fixed environment record

Before each measurement, record:

- Git commit, macOS/Windows/Linux version, CPU architecture, Node/npm version;
- dev or production bundle, whether DevTools is open, whether Chromium cache is enabled;
- account type and workspace type of the login, but do not record the account identifier, cookie, or
  token;
- session message count, visible message count, total text character count, image count, and
  artifact count;
- PDF file byte size / page count, workbook byte size / sheet count / non-empty cell count.

Within the same before/after round you must use the same device, build mode, account, workspace, and
input files. Close other high-load applications; the first sample is used only for warm-up and does
not count toward the summary.

## 2. Q-2026-007: long-session streaming updates

### Scenario

1. Run `corepack pnpm run dev` and confirm the Agent sidecar is ready;
2. Open a session with at least 200 messages and scroll to the newest message;
3. Prepare a read-only request that reliably outputs at least 3000 Chinese characters or 6000 English
   characters and lasts at least 20 seconds;
4. Record the 5 seconds before streaming begins, the full duration of output, and the 5 seconds after
   completion, separately;
5. Run at least 5 times, discard the first warm-up run, and report the median, p95, and worst value of
   the remaining samples.

### React Profiler

Record and export the profile, and check at minimum:

- the commit counts of `AppShell`, sidebar, composer, `ChatTimeline`, the current turn, and the
  artifact panel;
- whether sidebar/settings/artifact subtrees with no data change commit along with every batch of
  tokens;
- the median, p95, and maximum of a single commit duration;
- whether part keys stay stable, and whether unexpected remounts of message/part occur.

### Chromium Performance

Enable Screenshots and Memory, and record:

- the count, duration, and call stacks of long tasks greater than 50ms;
- scripting/layout/paint time;
- Interaction latency during input-box typing and scrolling;
- the renderer JS heap value before streaming, at peak, and 30 seconds after completion;
- GC count and single pause duration.

Only when the profile points to a definite root cause in a component, selector, serialization, or
layout may you change code. Do not add a global memo based solely on commit count, and do not change
the accumulated full-text part, the stable partId, Enter-to-send-only, or the artifact hierarchy.

## 3. Q-2026-010: large preview first open

### Build and samples

1. Run `corepack pnpm run build` and use the production renderer bundle;
2. Prepare fixed PDF, XLSX, and CSV samples; the workbook test must preserve Univer's full rendering
   and interaction;
3. For each sample category, record file size and structural scale; do not use data containing private
   information or credentials;
4. Before each cold test, close the artifact preview and disable the Chromium cache; for hot tests keep
   the cache; run each at least 5 times.

### Collection points

Starting from clicking the preview card, mark timestamps at each of these states:

- dynamic import request start and completion;
- JavaScript parse/evaluate completion;
- preview RPC/worker start and completion;
- first visible content paint;
- time-to-interactive when the PDF becomes scrollable and the workbook allows cell selection;
- renderer heap before opening, at first visible, at interactive, and 30 seconds after closing.

Also record the Network, Performance trace, and chunk names. Distinguish download, parse/evaluate,
worker data preparation, and component rendering; do not attribute the total time entirely to chunk
size.

## 4. Judgment and archiving

- Raw trace/profile files may contain local paths or business content; by default put them under
  `.wanta-dev/quality/` and do not commit them;
- In `docs/quality/baseline.md` record only the redacted scenario, raw values, summary method, and
  conclusion;
- When a perceptible threshold is not reached or there is no stable root cause, mark the finding
  `rejected` or keep it `defer`;
- When confirming a problem, first record the before state and the target, then make the minimal change,
  and retest using the exact same scenario;
- The Univer preview must not be removed, downgraded, replaced, or turned into a read-only table in
  exchange for performance numbers.
