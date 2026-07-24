# Task dependency policy

Wanta Default Access decides dependency permissions from execution scope, package source, and
concrete side effects rather than package popularity. The agent can combine shell variables,
pipelines, redirections, and package-manager syntax in many equivalent ways; maintaining a growing
allowlist of familiar package names does not create a reliable security boundary and causes ordinary
document, spreadsheet, PDF, image, and data work to stop repeatedly.

The executable sources of truth are
[`electron/chat/command-risk.ts`](../electron/chat/command-risk.ts),
[`electron/chat/dependency-policy.ts`](../electron/chat/dependency-policy.ts),
[`electron/chat/permission-request.ts`](../electron/chat/permission-request.ts), and
[`electron/chat/project-dev-command.ts`](../electron/chat/project-dev-command.ts).

## Automatic approval boundary

Python installs qualify when all of these conditions hold:

- The executable is the exact interpreter in the active turn's private `.wanta-python` environment.
- The command uses `python -m pip install` with direct PyPI requirements.
- Ordinary package names, extras, version constraints, and safe convenience flags are accepted.
- Package popularity is irrelevant, and Wanta does not add or pin a version.
- Requirements files, editable installs, system/user Python, alternative indexes, URLs, Git sources,
  local paths, `--user`, `--break-system-packages`, and unknown flags do not qualify.

Node.js installs qualify when all of these conditions hold:

- The command uses npm, pnpm, yarn, or bun and explicitly targets either the active turn process
  directory or the user-selected project.
- The operation directly installs one or more standard-registry package specifiers.
- Ordinary versions and safe save/lockfile flags are accepted. Wanta does not add or pin a version.
- Package popularity is irrelevant: an unfamiliar registry package follows the same rule as `xlsx`,
  `marked`, or `pdf-lib`.
- No-argument installs, global installs, alternative registries, user config, Git/URL/local sources,
  aliases, and unknown flags do not enter the automatic direct-install path. A no-argument install in
  a selected project can still receive a task-scoped approval.

Package runners such as `npx`, `npm exec` / `npm x`, `pnpm dlx`, `yarn dlx`, and `bunx` / `bun x`
are ordinary local execution under Default Access. Wanta does not maintain per-runner exceptions for
`--version`, `--help`, conversion, or formatting arguments. They still stop when the command crosses
an independent protected boundary. The classifier separates the runner's own options and selected
package from the arguments passed to the resulting executable. A Markdown input path, stylesheet,
PDF output path, or an executable-specific `--registry` argument therefore cannot be mistaken for a
local package source or package-manager registry override.

## Explicit dependency confirmation boundaries

The following continue through confirmation:

- Global or system package changes.
- Custom registries, alternative Python indexes, user package-manager configuration, and
  Git/URL/local package sources.
- Package publishing.
- Explicitly high-cost Node runtime installs: `playwright`, `@playwright/test`,
  `playwright-chromium`, `playwright-firefox`, `playwright-webkit`, `puppeteer`, and `canvas`.
- Any dependency command that also touches credentials, sensitive application data, broad
  home/system roots, privilege escalation, destructive deletion, deployment, or another protected
  boundary.

This short confirmation set is based on material install/runtime effects, not a claim that every
other package is reviewed or safe. High-cost packages can download browser payloads, invoke native
toolchains, or consume substantial cache and disk space. Direct standard-registry installs of
`playwright-core` and `puppeteer-core` in a bounded task or selected project are ordinary because
the library packages do not install a browser payload. The `playwright-core` package-runner path
remains protected because its CLI can explicitly install browsers.

## Shell composition

Variables, pipes, redirections, `head`, `tail`, and `grep` are not risk categories by themselves.
The policy classifies dependency operations independently from command composition and verifies the
bounded install target before automatic approval. Package-manager option values such as a cache,
target, report, store, or project directory are also kept separate from package specifiers. For
example, both of these are ordinary:

```bash
cd <task-directory> && npm install marked
```

```bash
SCRIPT_DIR="<task-directory>"
cd "$SCRIPT_DIR" && npm install marked 2>&1 | tail -5
```

An output pipeline into a shell, a mismatched variable target, an outside directory, or an alternate
package source does not inherit that approval.

The same structural rule applies to non-dependency risk checks. Wanta identifies the executable and
its operation in each top-level shell segment instead of searching every quoted argument for words
such as `sudo`, `git push`, or `npm publish`. Those words in a report filename, search expression, or
inline program are data; the actual operations remain confirmation boundaries.

## Security model

Default Access is a product risk policy, not an operating-system sandbox. Once an agent can run
ordinary Python, Node.js, and shell code, package-name matching cannot prevent equivalent behavior
from being expressed another way. The policy therefore aims to:

- Keep ordinary task work smooth.
- Stop clear scope crossings and high-impact operations.
- Describe genuine risk accurately in the UI.
- Avoid implying that a familiar-package allowlist provides process isolation.

True containment requires a separate OS-level task sandbox that restricts filesystem, credential,
network, and child-process access. Structured dependency and document-conversion tools can further
reduce shell ambiguity, but they are architectural follow-up work rather than a property of this
string-level permission layer.

## Maintenance

Do not add package-specific automatic-approval entries to solve a new agent command spelling.
Instead, determine whether the operation stays inside the task/private-project boundary and uses the
standard package source. Add a package-specific confirmation only when it has a concrete,
documented install/runtime cost that materially differs from ordinary packages.

Changes to this policy require synchronized updates to the permission classifier, task/project
parsers, prompt/process guidance, renderer copy, architecture/convention documents, and end-to-end
permission round-trip tests.
