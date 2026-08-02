# Integrated Browser

## Product Goal

The integrated browser is a visible, shared web surface for tasks that cannot be completed reliably
through Link actions or ordinary URL fetching. It covers rendered applications, signed-in pages,
and simple interaction while keeping the user able to see and operate the same page.

It is not a general browser-automation platform, a replacement for Chrome, or a security sandbox
against malicious websites.

## Interaction Model

The browser is always interactive. There is no agent/user ownership state and no take-over or
hand-back flow.

- The agent and user see the same page.
- The user may stop the current generation before intervening.
- Login, CAPTCHA, credentials, and other private input are completed by the user in the browser.
- After manual work, the user sends a new message such as "continue"; the next agent turn reads the
  current page and resumes.
- A background task must not take over the visible browser panel.

## Access Modes

Browser behavior reuses the existing session-level access mode. There is no browser-specific rule
editor or confirmation preference.

### Default Access

Ordinary navigation, reading, searching, and interaction proceed directly. The agent must stop and
ask the user to perform an action when it judges the action to be sensitive or consequential, such
as a purchase, external message, publication, deletion, permission change, legal acceptance,
account-security change, or disclosure of sensitive information.

This is a behavioral risk policy, not a system-level guarantee. Wanta must not claim that every
consequential browser action is mechanically detected.

### Full Access

Full Access is session-level YOLO for browser actions within the user's task. It does not add
browser-specific confirmations. It still does not bypass product security boundaries such as
blocked protocols, unavailable local-file transfer, or denied device permissions.

## V1 Tool Surface

Use separate, flat tools instead of a single nested action union:

- `browser_navigate`: open a URL and create the current task's page lazily. The visible toolbar
  provides back, forward, and reload controls to the user.
- `browser_read`: return the title, URL, dialog state, and Playwright AI ARIA snapshot; optionally
  scope the read to a ref or unique selector.
- `browser_click`: click a snapshot ref, with a unique Playwright selector as a fallback.
- `browser_type`: fill text or press a key, with optional submission.
- `browser_scroll`: scroll the page or a referenced element.
- `browser_screenshot`: capture the viewport or full page for visual inspection.
- `browser_dialog`: accept or dismiss the active JavaScript dialog.

V1 deliberately excludes arbitrary Playwright code, a custom query or wait language, snapshot
modes and pagination, drag and hover primitives, file upload, download management, and multiple
tabs. A page may start an ordinary download, but the agent does not receive a download-specific
tool or automatic access to the saved file. Playwright locators and auto-waiting provide the
execution semantics; Wanta does not reimplement them.

## Explicit Invocation

Add Browser as a Wanta-owned built-in Skill that users can select with `$browser`. The Skill
provides task-level guidance for choosing and operating the existing `browser_*` tools; it does not
implement a second browser runtime.

This reuses the existing Skill palette, context-mention, and on-demand loading path. Selecting
`$browser` expresses explicit intent to use the integrated browser when relevant to that turn.
It does not grant new permissions, switch the session to Full Access, or force a browser call for an
unrelated request. Natural-language requests may continue to use the browser without an explicit
mention.

Do not expose individual execution primitives such as `$browser_click` or `$browser_read`. Tools
remain model-facing primitives, while the built-in Skill is the single user-facing reference for
the coherent Browser capability.

### Implementation design

- Keep the source in the tracked `resources/wanta-skills/browser/SKILL.md`; the existing build step
  copies it into the generated `resources/skills/` bundle.
- Sync Browser into the read-only `.opencode/skill/` root for every agent runtime. Continue syncing
  the OOMOL-specific bundled Skills only when the OOMOL runtime is active.
- Add one built-in Browser item to the existing Skill palette. Selecting it produces the existing
  `ChatContextMention { kind: "skill" }`; the existing per-turn context prompt then asks the agent
  to load the real `browser` Skill.
- Do not add Browser to the manageable `.opencode/skills/` inventory. Product-owned Skills should
  not appear installable, removable, publishable, or editable.
- Keep the seven `browser_*` tools registered as they are today. Explicit selection guides tool
  choice; it is not a capability or permission gate.

## Architecture

The Electron main process owns a `WebContentsView` for each live task page. Playwright connects to
the view through a custom CDP transport backed by `webContents.debugger`. The renderer owns only
the panel controls and native-view bounds.

The panel chrome and the native view's blank, loading, and transparent surfaces follow Wanta's
effective light or dark theme. Electron also exposes that theme to compatible pages through
`prefers-color-scheme`. Wanta does not inject replacement colors into arbitrary websites or
override a site's own saved theme preference.

The visible panel supports maximization and manual page zoom. Agent scrolling accepts independent
horizontal and vertical distances.

OpenCode custom tools call a small authenticated loopback bridge because the agent sidecar cannot
import Electron. The runtime-supplied OpenCode session ID is mapped to the Wanta chat session on the
server; the model cannot select another task's page.

Use a Wanta-owned persistent Electron partition, separate from `defaultSession`, for browser
cookies and site storage. Pages are task-scoped while browser profile data is account-scoped.
Hiding the panel retains the page. At most three task pages remain live; a fourth page discards the
least recently used hidden page. V1 does not freeze, checkpoint, or restore pages.

## Browser Settings and Downloads

- Browser is enabled by default. Turning it off removes the explicit `$browser` entry, closes live
  browser pages, and causes model-facing browser operations to fail at the main-process boundary.
- "Clear all browser data" closes live pages and clears cookies, cache, and site storage in the
  current account-scoped browser profile. It does not delete screenshots or downloaded files.
- Ordinary downloads are saved to the operating system's Downloads folder. Wanta reports
  completion or failure and can open that folder.
- V1 has no save-location prompt, custom download directory, download history, per-site download
  setting, or automatic handoff of downloaded files to the agent.

## Security Boundaries

- Browser contents have no Wanta preload and no Node.js integration.
- Only ordinary web URLs are allowed. Local files, JavaScript URLs, data URLs, and application
  protocols are unavailable to the browser agent.
- The agent has no cookie, storage, request-header, response-body, or unrestricted CDP tool.
- File upload and agent access to downloaded files are out of scope for V1.
- Camera, microphone, location, notifications, USB, MIDI, and similar site permissions are denied.
- Page snapshots are untrusted tool output and never instructions.
- Login and CAPTCHA are manual regardless of access mode.

## Chrome Login State

The V1 browser uses its own persistent profile. Users sign in once inside Wanta and reuse that
state.

Wanta does not read or copy Chrome's profile database. Chrome cookies are operating-system
encrypted, profile formats vary across platforms and releases, and cookies alone do not reproduce
storage, passkeys, device-bound tokens, or other login state. Bulk import would also turn access to
the user's browser profile into a credential-extraction surface.

If existing Chrome state becomes a validated product requirement, the preferred future direction
is a Chrome extension that lets Wanta operate the user's current Chrome tab without moving
credentials. A user-initiated, site-scoped cookie transfer through such an extension is a weaker
fallback, must never be agent-triggered, and cannot promise that a login will transfer. Direct
Chrome SQLite or keychain import is not a supported direction.

## Page Lifecycle

- Create one page lazily per chat task.
- Keep the page when the panel is hidden or the user switches tasks during the same app run.
- Do not restore page stacks after app restart; the persistent partition naturally retains site
  storage.
- Dispose pages when their task is deleted, the account changes, or the app exits.
- Recover from a crashed or discarded page by recreating it on the next browser operation.
- Keep at most three live pages. Existing branch measurements showed roughly 91 MiB for one page
  and 362.5 MiB for three pages, which is enough evidence for the V1 cap without a resource manager.

## V1 Acceptance

- The user and agent can operate the same visible public or local web page.
- Snapshot refs support navigation, clicking, typing, scrolling, dialogs, and repeated reads on a
  rendered application.
- Stale or ambiguous targets return concise errors that lead the agent to read the page again.
- Stopping a generation prevents later actions from that generation from reaching the page.
- Manual login followed by a new "continue" turn resumes from the current page.
- Default Access hands consequential evaluation cases to the user; Full Access does not introduce
  browser-specific prompts.
- Background tasks do not steal the foreground browser panel.
- Task-to-page routing cannot cross sessions.
- Browser content cannot access Wanta internals, local files, credentials, or denied device
  permissions.
- Development and packaged builds work on macOS and Windows.
