# Development Guide: Environment, Workflow, Testing, Packaging, and CI

> Related: [architecture.md](architecture.md) (module map) · [conventions.md](conventions.md) (coding conventions)

## 1. Environment Setup

- **Node >= 22.22.2** (matches the minimum of the pinned OpenCode dependency chain; PR CI pins
  Node 24, release CI pins Node 22 in all four jobs that set up Node — compute-version,
  release-mac, release-win, create-release; the fifth job, refresh-cdn-cache, installs no Node at
  all). npm + package-lock.json.
- **All dependency sources are public**: `@oomol/connection` / `@oomol/connection-electron-adapter`
  are published to the public registry (`registry.npmjs.org`); `npm install` **needs no token or
  `.npmrc`** — since the repo went open source, a fresh clone and an external fork's CI both
  install directly (historically this went through the GitHub Packages private registry + a
  `read:packages` PAT; that auth chain was removed once the repo turned public and the packages
  shipped to public npm). If your machine's global `~/.npmrc` still points the `@oomol` scope at
  `npm.pkg.github.com`, it overrides the default public registry — delete that line. Note: the
  postinstall binary/skill download scripts are best-effort (warn only), but dev cannot start
  without `@oomol/connection` — an install failure must not be ignored.
- `npm install`'s postinstall chains the binary/skill download scripts and finally builds the
  custom tool runtime:
  - `scripts/download-electron.ts` → downloads the dev-only Electron copy into `.electron-dist/`
    and rewrites the macOS Info.plist to `com.oomol.wanta-local` / the `wanta-local` scheme (for
    dev deep-links). `ELECTRON_SKIP_BINARY_DOWNLOAD=1` skips it.
  - `scripts/download-oo.ts` → downloads the oo binary into `.oo-bin/` (version pinned by
    `OO_CLI_VERSION` in `scripts/oo-cli.ts`; includes sha512 integrity verification and
    `chmod 0o755`). oo / ripgrep downloads share one policy: 30-second per-request timeout and at
    most 3 request attempts (at most 2 retries); deterministic 4xx is not retried.
    `OO_SKIP_BINARY_DOWNLOAD=1` skips it.
  - `scripts/download-skills.ts` → exports the 4 bundled oo skills (`oo`, `oo-find-skills`,
    `oo-create-skill`, `oo-publish-skill`) to `resources/skills/` via
    `oo skills install --out-dir`, using isolated `OO_CONFIG/DATA/LOG` dirs (`scripts/skills.ts`).
    Best-effort; `OO_SKIP_BINARY_DOWNLOAD=1` skips it.
  - `scripts/download-ripgrep.ts` → downloads ripgrep into `.oo-bin/` (version pinned by
    `RIPGREP_VERSION = "14.1.1"` in `scripts/ripgrep.ts`). It exists because OpenCode's grep tool
    needs `rg` on PATH, and a GUI-launched process cannot assume the system PATH. Best-effort;
    `OO_SKIP_BINARY_DOWNLOAD=1` or `WANTA_SKIP_RIPGREP_DOWNLOAD=1` skips it.
  - `scripts/build-agent-tool-runtime.ts` → uses Rolldown to merge `@opencode-ai/plugin/tool` and
    Zod into `resources/agent-tool-runtime/tool.js`; both dev and the packaged artifact sync it
    into the private workspace, so tool loading does not depend on an npm install succeeding at
    first launch.

## 2. .env Configuration

```bash
cp .env.example .env.local   # .env.local is gitignored
```

- `WANTA_ENDPOINT`: the endpoint apex domain, default `oomol.com`; switch to `oomol.dev` to target
  the dev environment. **Read rules** (`resolveOoEndpoint` in `vite.config.ts`): dev and vitest
  read `.env(.local)` via `loadEnv`; **build deliberately reads no file** (keeps dev domains out of
  release artifacts); both modes honor an explicit environment variable — internal test builds use
  `WANTA_ENDPOINT=oomol.dev npm run build`. Known trap: the `oomol.dev` LLM gateway once returned
  403 "Model disabled" for Auto/`oopilot` (a backend restriction, not a code bug); the dev endpoint
  is mainly for connector integration — on a chat 403, suspect the gateway side first.
- `WANTA_OO_BIN` (optional; a process environment variable, not read from .env files): overrides
  the oo binary path, `WANTA_OO_BIN=/abs/path/to/oo npm run dev`. When set, it only skips the
  oo-binary existence/version check in the predev guard; the guard still fails on a missing
  ripgrep binary and still auto-exports the bundled skills.
- `WANTA_PACKAGE_ASSETS_BASE_URL` (optional): overrides the package-assets base URL, injected as
  the `__PACKAGE_ASSETS_BASE_URL__` define, default `https://package-assets.<endpoint>`.
  `vite.config.ts` reads it from `process.env` only; `vitest.config.ts` reads it via `loadEnv`.

## 3. Day-to-Day Development

```bash
npm run dev    # predev runs scripts/check-oo.ts first (three checks, see below)
               # vite dev server on port 5273; vite-plugin-electron starts the main process too
npm run dev:no-electron
               # only starts vite + the electron bundle watch, without auto-launching Electron;
               # for code-side debugging that needs no UI window
```

- The predev guard (`scripts/check-oo.ts`) checks three things: the oo binary is present AND its
  version marker matches `OO_CLI_VERSION`, ripgrep is present in `.oo-bin/` (both fatal — the
  guard exits with an error), and the bundled skills in `resources/skills/` are complete (auto
  re-export, non-fatal).
- vite dev server is fixed at port `5273` with `strictPort=true`: if an existing `npm run dev`
  holds the port, the new dev process fails outright instead of silently moving to `5274+` and
  launching a second Electron. To temporarily disable Electron auto-start, you can also use
  `WANTA_ELECTRON_AUTO_START=0 npm run dev`.
- When `.electron-dist` exists, vite automatically sets `ELECTRON_OVERRIDE_DIST_PATH`, so dev uses
  the Electron copy with the `wanta-local` scheme (the menu bar shows the dev identity) — required
  for the browser-login round trip to hit the dev instance.
- dev userData lives at `~/Library/Application Support/wanta` (macOS); agent data under its
  `agent/` (workspace / isolation / oo-store).
- Code changes must go through a temporary branch + PR: first align local `main` with
  `origin/main`, then cut a one-off branch from `main` (e.g. `codex/<task>`, `ci/<task>`,
  `fix/<task>`). Once the change is done and passes the quality gate, push the temporary branch
  and open a PR to `oomol-lab/wanta:main`; land it by merging the PR. Never commit or push
  directly on `main`. After the PR merges, sync the latest `main`, delete the local temporary
  branch, and delete the same-named temporary branch on the fork/remote. All human-readable text
  in Git operations must be English — commit messages, branch names, PR titles, PR descriptions,
  PR reviews/comments, tags/release notes.
- Quality gate after any change, all four green:
  `npm run ts-check && npm run lint && npm run format && npm test`.

## 4. Testing

- `npm test` = `vitest run`; `vitest.config.ts` includes `electron/**/*.test.ts`,
  `src/**/*.test.ts`, `scripts/**/*.test.ts`, environment node, and injects `__OO_ENDPOINT__` and
  `__PACKAGE_ASSETS_BASE_URL__` via the same loadEnv mechanism as vite (test assertions derive
  from `ooEndpoint`; never hardcode a domain, so local and CI both pass deterministically).
- Tests are colocated with the source (`*.test.ts` next to the module it covers, ~240 files across
  `electron/`, `src/`, and `scripts/` — see the source tree). Most are pure-function unit tests,
  with noted exceptions — e.g. `scripts/renderer-boundary.test.ts` scans the `src/` tree on disk
  to enforce the renderer→electron import allowlist.
- **Real-run verification** uses the manual smoke scripts under `.wanta-dev/` (gitignored, not
  packaged, not covered by lint/format/tsc): `agent-smoke.ts` (headless golden path),
  `chat-stream-smoke.ts`, `connections-smoke.ts`, `r4-smoke.ts`, `system-probe.ts` (verifies
  body.system is append-not-replace), `spike.mjs`. Run:
  `OO_API_KEY=... node --experimental-strip-types .wanta-dev/xxx.ts` (smoke scripts construct
  `AgentManager` directly, no browser login; the `AgentManager` option is now `authToken` and
  takes the session token — the env var name stays `OO_API_KEY` purely as oo-cli's external
  contract; the gateway authenticates uniformly). **A fresh clone has none of these scripts**
  (they exist only on the original dev machine): when missing, write your own by constructing
  `AgentManager` directly per [architecture.md §2](architecture.md) (`electron/agent/` is
  electron-free).
- **UI real-machine verification bypasses** (dev-only env vars, harmless in production):
  `VITE_WANTA_SMOKE` (auto-sends one message once AppShell is ready, `AppShell.tsx`),
  `VITE_WANTA_ROUTE=settings` (also supports `knowledge` and other AppShell pages),
  `VITE_WANTA_LOCALE` (forces the locale, `src/i18n/i18n.ts`); pair with macOS `screencapture` for
  screenshot evidence. Electron 42's macOS native notifications require a valid app signature; the
  ad-hoc dev signature of `.electron-dist/Electron.app` cannot be used for notification
  acceptance — the settings page marks this and disables test notifications there. Use a CI-signed
  artifact or a locally packaged app with a valid Apple Development / Developer ID signature to
  cover: allow/deny notification; whether a test result's unique ID can be confirmed in
  `Notification.getHistory()`; the copy for the case where the notification center received it but
  the banner is suppressed by Focus/Do Not Disturb or a screen-sharing policy; sound; foreground /
  non-foreground task conditions; the click-back-to-task path. Note that "delivered to the
  notification center" still does not mean the user necessarily saw a banner.
- **Known verification gaps** (per session records these were never exercised on a real machine —
  do not assume them verified while debugging): real bash/edit/external_directory calls under the
  permission prompt UI, the real visual result of the ai-elements migration (no display was
  available at the time), and the browser-login round trip with a real account (needs a human
  login).

## 5. Lint / Format / Type Check

- `npm run lint` = `oxlint .` (`.oxlintrc.json`: correctness=error; `react/only-export-components`
  error, but overridden off for the two vendored dirs `src/components/ui/**` and
  `src/components/ai-elements/**`; ignorePatterns includes `.wanta-dev`).
- `npm run format` = `oxfmt --check .` (`.oxfmtrc.json`: printWidth 120, **no semicolons**, double
  quotes, trailingComma all, sortImports with type imports first, sortTailwindcss recognizing
  cn/clsx/cva).
- `npm run ts-check` = `tsgo -p tsconfig.json --incremental false` (TypeScript native preview,
  `@typescript/native-preview`; the flag overrides tsconfig's `incremental: true`). tsconfig:
  strict, verbatimModuleSyntax, module Preserve, allowImportingTsExtensions, noEmit; include is
  src / electron / scripts / vite.config.ts / electron-builder.ts.

## 6. Packaging / Signing / Notarization / Auto-Update

```bash
npm run build:mac     # = build:app + prepare:binaries + electron-builder --mac (also build:win / build:linux / build:electron)
```

- `scripts/prepare-binaries.ts`: copies three binaries into `resources/bin/` and chmods 755 —
  opencode (`node_modules/opencode-ai/bin/opencode.exe`, this exact filename on all platforms), oo
  (from `.oo-bin/`, downloaded on the spot if missing), and ripgrep (`rg`, placed in the same
  `resources/bin/` dir, which `AgentManager` prepends to PATH so OpenCode's grep tool finds it).
  It also exports the bundled skills and rebuilds the custom tool runtime.
- `electron-builder.ts`: appId / productName / protocols derive from `electron/branding.ts`; asar;
  output `release/${version}`; files only dist + dist-electron (excluding map/d.ts, **no electron/
  sources or tests**); extraResources include `resources/bin → bin`, `resources/skills → skills`,
  and `resources/agent-tool-runtime → agent-tool-runtime`; the `sqlite3` native module is unpacked
  from asar (used by the exactly pinned `wiki-graph@0.3.0`); afterPack
  `scripts/electron-builder-after-pack.cjs` (deletes the ~20MB LICENSES.chromium.html; the hook is
  .cjs because electron-builder's require hook does not support .ts). mac dmg+zip arm64; win nsis
  x64 (signtool certificate fingerprint); linux AppImage.
- **Signing/notarization can only happen in CI**; local builds produce unsigned artifacts only
  (mac certificates, Apple ID, and the win USB certificate all live in CI secrets). macOS
  notarization requires **every executable** inside the app to be signed with Hardened Runtime —
  the oo, opencode, and rg under `Resources/bin` are all in scope; any newly bundled binary (or a
  changed extraResources layout) must be added to the signing/notarization scope, or notarization
  fails.
- Auto-update (`electron/update/`: common.ts contract + node.ts implementation + channel.ts /
  policy.ts pure functions): electron-updater generic provider, feed =
  `https://static.<ep>/release/apps/wanta/<platform>/<arch>`; packaged builds only. First check
  after startup at a random 5–15 s delay; stable checks every 2 hours, beta every 1 hour (±12.5%
  jitter); on wake from sleep (Windows/macOS/Linux), or when the window returns to the foreground
  with more than 30 minutes since the last successful check, a catch-up check runs after a random
  10–30 s / 3–10 s delay respectively. Once an update is found it downloads in the background;
  when the download completes with the window in the background, a native notification is sent
  and Windows gets a "Restart and update" tray item; with the window in the foreground and the
  Agent idle, the update dialog shows; no dialog while a task is running, and the user can
  postpone for 4 hours. A normal quit still installs a downloaded update. `autoDownload=false` —
  the Wanta state machine controls the download explicitly, and `autoInstallOnAppQuit=true` is
  armed only after a download starts. **Dual channel**: stable pulls `latest*.yml`, beta pulls
  `beta*.yml`; the channel is passed via the `channel` field of `setFeedURL` (**never the
  `autoUpdater.channel` setter** — it silently flips `allowDowngrade` to true), with an explicit
  `allowDowngrade=false` (switching beta back to stable converges at the next stable release by
  default; never auto-downgrade). Channel merge rule:
  `user setting ?? (own version contains -beta ? beta : stable)` (`channel.ts`), persisted in
  settings.json under the `updateChannel` key. Update scheduling, check results, native
  notifications, and tray install failures all go to the diagnostics log.
- `generateUpdatesFilesForAllChannels: true` in `electron-builder.ts`: a stable build also emits
  `beta*.yml` (pointing at that stable), so beta users converge immediately after a stable
  release; the generic provider derives the channel from the `-beta.N` version suffix
  automatically (detectUpdateChannel is on by default). `electron-builder` and `electron-updater`
  are **exactly pinned** (channel behavior is version-sensitive; before upgrading, verify the
  GenericProvider/PublishManager channel logic is unchanged).

## 7. CI (.github/workflows/)

- **pr.yml** (PR → main, ubuntu, Node 24): npm ci (no registry auth — @oomol packages come from
  public npm; sets `ELECTRON_SKIP_BINARY_DOWNLOAD=1` + `OO_SKIP_BINARY_DOWNLOAD=1` to skip binary
  downloads) → lint → format → ts-check → test → build. The test step sets
  `ELECTRON_OVERRIDE_DIST_PATH` as a defensive guard against the electron stub downloading a
  binary.
- **release.yml** (workflow_dispatch, inputs channel stable/beta + expected_version +
  version_bump): `compute-version` (version math in `scripts/release-version.ts`, vitest-covered —
  stable auto-bump **filters out all beta tags**; beta baseline = max(latest stable's patch+1,
  highest existing beta baseline), N increments) → `release-mac` (macos-latest: import
  certificates, sign + notarize, `npm version` rewrite, build:mac, channel-yml validation, rclone
  upload to Aliyun OSS `oomol-static-cn-prod/release/apps/wanta`, OIDC) + `release-win`
  (self-hosted Windows x64 runner + USB certificate; **do not rely on system tools like tar being
  present**) → `create-release` (tag + GitHub release, stable `--latest` / beta `--prerelease`) →
  `refresh-cdn-cache` (refreshes pointers per channel: stable refreshes all 4 latest\*+beta\*,
  beta refreshes only the 2 beta\*). No linux release job. Secret names are copied from oo-desktop
  (`MACOS_CERTIFICATE` / `MACOS_CERTIFICATE_PWD` / `APPLEID` / `APPLEID_PASS` / `APPLE_TEAM_ID`
  etc.); do not invent your own. Release size metadata (`scripts/release-size.ts`,
  vitest-covered): release-mac and release-win each collect installer/app-bundle sizes into a
  `release-size-<platform>-<arch>.json` artifact, and create-release renders them into a Downloads
  table in the release notes — the release hard-fails if any platform's metadata is missing or its
  version mismatches.
- **Dual-channel release discipline**: the rclone upload is an include allowlist — a beta release
  never touches `latest*.yml` (that is the guard rail for the stable pointer); a stable release
  also uploads + refreshes `beta*.yml` (converging beta users), **unless** compute-version yields
  `refresh_beta=false` (this stable is below the highest existing beta baseline; skip the beta
  pointer to prevent regression); mac/win each have a hard channel-yml validation step (a missing
  file / wrong version fails loudly before upload). The generic provider hard-errors on a missing
  channel yml (`ERR_UPDATER_CHANNEL_FILE_NOT_FOUND`, no fallback), so once the beta channel opens,
  `beta*.yml` must always exist in both platform directories. Before the first beta, a stable with
  the channel-aware updater must already have shipped. The whole workflow serializes in the
  `release` concurrency group (concurrent dispatches would compute the same version and race-write
  OSS).

## 8. Special Directory Quick Reference (all gitignored, except resources/ itself)

| Directory                       | Role                                                                                   | Producer                                                             |
| ------------------------------- | -------------------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| `.oo-bin/`                      | oo + ripgrep (`rg`) binaries shared by dev and packaging                               | postinstall `scripts/download-oo.ts` + `scripts/download-ripgrep.ts` |
| `.electron-dist/`               | dev-only Electron copy (wanta-local scheme)                                            | postinstall `scripts/download-electron.ts`                           |
| `resources/bin/`                | pre-packaging binary staging (→ extraResources)                                        | `scripts/prepare-binaries.ts`                                        |
| `resources/skills/`             | bundled oo skills export (→ extraResources; re-ensured by predev and prepare-binaries) | postinstall `scripts/download-skills.ts` (`scripts/skills.ts`)       |
| `resources/agent-tool-runtime/` | self-contained runtime for custom tools (→ extraResources)                             | `scripts/build-agent-tool-runtime.ts`                                |
| `.wanta-dev/`                   | manual smoke / experiment scripts, outside every toolchain                             | handwritten                                                          |
| `dist/` `dist-electron/`        | vite build output (renderer / main+preload)                                            | `npm run build`                                                      |
| `release/`                      | electron-builder output                                                                | `npm run build:*`                                                    |

## 9. Upgrade Notes

- Upgrading oo: change only `OO_CLI_VERSION` in `scripts/oo-cli.ts` (the `.version` marker
  triggers a re-download). The binary inside oo's upstream tarball has no +x bit; any path that
  uses that binary from node_modules directly must chmod it itself — do not fall back to the
  npm-dependency approach.
- Upgrading ripgrep: change only `RIPGREP_VERSION` in `scripts/ripgrep.ts` (pinned, currently
  `14.1.1`); the download scripts pick it up in postinstall/predev. Remember `rg` ships in
  `resources/bin` and is inside the macOS signing/notarization scope.
- Upgrading OpenCode: bump `opencode-ai` / `@opencode-ai/sdk` / `@opencode-ai/plugin` together at
  the **same version**, and run the `.wanta-dev/` smoke scripts first (upstream makes no API
  stability promise).
- `opencode-ai` must stay in **devDependencies** (build-time only, so prepare-binaries can take
  the binary; runtime uses the extraResources copy); putting it in dependencies would duplicate
  ~100MB of platform binaries into app.asar — do not "fix" this when tidying dependencies.
- Upgrading vendored ai-elements: compare against `.claude/skills/ai-elements/references/` and
  `skills-lock.json`; note this repo carries a trimmed version (see
  [key-decisions.md §8](key-decisions.md)).
