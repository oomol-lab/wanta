# Integrated Browser Implementation Memory

Read [../integrated-browser.md](../integrated-browser.md) before changing the feature.

## Current Goal

Deliver the smallest reviewable V1 on `feat/integrated-browser`. Do not reuse the
`browser-use-development` branch as an implementation base; it remains research material only.

## Decisions That Must Survive Context Compaction

- Use `WebContentsView` owned by Electron main.
- Use stable `playwright-core` rather than a custom DOM, AX, locator, or wait implementation.
- Connect Playwright to `webContents.debugger` through its public `ConnectOverCDPTransport`.
- Keep browser input available to the user at all times.
- Reuse Default Access and Full Access; do not add browser permission UX or match rules.
- Default Access consequential-action handling is an agent behavioral policy, not a hard guarantee.
- Login, credentials, and CAPTCHA are manual and resume in a new user turn.
- Use separate flat tools. Do not add arbitrary Playwright code or a query DSL in V1.
- Expose the tool group through one real Wanta-owned built-in `browser` Skill so users can select
  `$browser`; do not turn individual tools into references or add another plugin abstraction.
- Use a dedicated persistent browser partition; never import Chrome profile data.
- Keep the localhost bridge small: one runtime credential, runtime session binding, bounded input,
  cancellation, and a concise error set.
- Prefer deleting scope over adding compatibility layers.

## Verified Evidence

- The published `playwright-core@1.62.0` types expose
  `chromium.connectOverCDP(ConnectOverCDPTransport)`.
- The same package exposes `page.ariaSnapshot({ mode: "ai" })`, including AI refs and iframe
  snapshots.
- VS Code uses this transport shape but also carries multi-tab, global page tracking, shared-process,
  browser-history, emulation, and permission infrastructure that Wanta does not need.
- Electron 42.4.0 is the version pinned by this repository.
- OpenCode custom tools bypass built-in permission gates, so access-mode behavior belongs in the
  dynamic prompt and tool contract.
- The repository already treats browser profiles, cookies, and keychains as sensitive paths.

## Completed Transport Probe

A disposable Electron 42.4.0 probe connected `playwright-core@1.62.0` to one sandboxed
`WebContentsView` and completed an AI ARIA snapshot, input fill, and button click.

Directly forwarding the root transport connected but exposed no page. The minimum working relay
synthetically handles `Browser.getVersion`, `Browser.setDownloadBehavior`, and the root
`Target.setAutoAttach`, announces one page session, and forwards page commands and events through
`webContents.debugger`. It does not need VS Code's general multi-target CDP proxy.

Synthetic transport responses must be delivered asynchronously; synchronous re-entrant responses
violate a Playwright connection assertion.

## Implementation Order

1. Add the main-process browser domain and pure contracts.
2. Add a thin authenticated sidecar bridge and session binding.
3. Materialize the flat custom tools.
4. Add the generic right-panel host and browser controls.
5. Connect task visibility, bounds, stop cancellation, and cleanup.
6. Add focused unit and integration tests.
7. Run typecheck, lint, tests, build, and machine-observable Electron acceptance.

## Scope Guard

Stop and ask before adding any of the following:

- Multiple tabs or popup-preserving OAuth.
- File upload, download history, custom download paths, or automatic agent access to downloaded
  files.
- Chrome extension or login-state transfer.
- Persistent page restore across app restarts.
- Browser-specific confirmation UI, domain rules, or a second reviewer.
- Arbitrary page JavaScript or Playwright code.
- More than one page per task.
- A lifecycle state machine beyond live, hidden, crashed, and disposed.

## Progress

- Product and architecture requirements documented.
- Chrome login-state conclusion documented.
- Explicit `$browser` invocation is implemented as one tracked Wanta-owned `browser` Skill plus an
  existing-style built-in palette item. It reuses Skill context mentions and on-demand loading;
  Browser is synchronized for every runtime while OOMOL-specific Skills remain OOMOL-only.
- Browser settings provide a default-on global switch, current-profile data clearing, and a
  shortcut to the system Downloads folder. Disabling Browser closes live pages, hides the explicit
  `$browser` entry, and rejects browser tools at the main-process boundary.
- Ordinary page downloads use the system Downloads folder and emit completion/failure notifications
  with a shortcut to reveal the folder. There is no download history, path picker, per-site rule, or
  automatic agent access to downloaded files.
- Playwright AI snapshot refs may be top-level (`e36`) or frame-sequence-prefixed (`f1e36`).
  Targeted Browser operations preserve either form as an `aria-ref`; they never treat a prefixed ref
  as a CSS selector.
- Feature branch created.
- Runtime transport probe passed and was removed.
- Main-process browser domain, single-page Playwright relay, and three-page LRU cap implemented.
- Authenticated loopback control bridge and seven flat OpenCode tools implemented.
- Browser tools are available in both OOMOL/OpenConnector and local runtimes.
- Renderer service, shared right-panel host, visible browser controls, and active-task routing
  implemented.
- The registered Browser service is a renderer-only facade for controls and user-initiated settings
  actions; page ownership, account profile selection, agent execution, and cleanup stay on the
  unregistered `BrowserManager`.
- Format, lint, production app build, and all 2,028 tests pass. The real predev export also copies
  the tracked Browser Skill into the generated `resources/skills/` bundle byte-for-byte.
- Electron 42.4.0 dev startup, sidecar startup, authenticated loopback listener, diagnostics, and
  shutdown cleanup pass. Automated visual inspection was intentionally not run under the repository
  instruction; the right-panel/native-view appearance remains a human review item.
- Human testing found that the browser inherited the artifact panel's narrow 300 px preference and
  that window growth mutated the saved panel width while a CSS transition made the native view
  chase the renderer layout. Browser and artifact widths are now independent, the browser defaults
  to 480 px when the window permits it, window resize only clamps the visible width, and browser
  layout does not animate across the native-view boundary.
- An Electron 42 probe verified that a sandboxed `WebContentsView` observes Wanta's
  `nativeTheme.themeSource` both at creation and after live light/dark changes. A second real-path
  probe against `hyrious.me` found that `playwright-core.connectOverCDP()` changes the attached page
  from dark to light despite the nominal `no-override` context default. Calling
  `page.emulateMedia({ colorScheme: null })` after connection restores Electron theme inheritance.
  The native view also applies Wanta's background color for blank, loading, and transparent content.
  Arbitrary websites are not force-restyled.
