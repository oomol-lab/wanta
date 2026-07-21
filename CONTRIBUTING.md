# Contributing to Wanta

Thank you for helping improve Wanta. This guide covers the repository workflow; the deeper
architecture and safety rules live in [docs/architecture.md](docs/architecture.md) and
[docs/conventions.md](docs/conventions.md).

## Before You Start

- Use Node.js 22.22.2 or newer and npm 10.9.4.
- Run `npm install`; no private registry token or repository `.npmrc` is required.
- For substantial behavior or UI changes, open an issue first so scope and product behavior can be
  agreed before implementation.
- Report suspected vulnerabilities privately according to [SECURITY.md](SECURITY.md), not in a
  public issue.

## Development Workflow

1. Sync the latest `main` branch.
2. Create a short-lived branch with a descriptive name such as `fix/session-recovery` or
   `feat/local-model-provider`.
3. Keep each pull request focused on one coherent outcome.
4. Add or update tests when behavior changes.
5. Update the relevant architecture, development, or decision documentation when a contract
   changes.
6. Run the complete quality gate before opening the pull request:

```bash
npm run ts-check
npm run lint
npm run format
npm test
npm run build
```

Use `npm run lint:fix` and `npm run format:fix` for mechanical fixes. Do not bypass a failing check
or commit generated content from ignored build directories.

After the pull request is merged, delete the short-lived branch locally and from the remote.

## Runtime and UI Verification

Run `npm run dev` for changes that affect Electron startup, preload/IPC, runtime switching, Agent
behavior, permissions, sessions, models, or the renderer. Exercise the changed flow in the real
desktop application and describe the result in the pull request. Include screenshots or a short
recording for visible UI changes where they make review easier.

Wanta uses [OpenCode](https://github.com/anomalyco/opencode) as its Agent engine. The OpenCode
packages are pinned together at version 1.17.13 because their APIs are not treated as stable. Do not
upgrade `opencode-ai`, `@opencode-ai/sdk`, or `@opencode-ai/plugin` independently.

## Important Safety Boundaries

- Never expose OOMOL session tokens or custom model API keys to the renderer.
- Do not add synchronous filesystem APIs to the Electron main process.
- Derive OOMOL service URLs from `electron/domain.ts`; do not hard-code deployment domains.
- Keep Connector tools, permissions, and system prompts aligned when changing Agent capabilities.
- Preserve the OpenCode `permission.asked` approval flow for risky local operations.
- Do not write oo CLI state into user-global Agent directories; keep the complete `OO_*` isolation
  environment and `OO_SKILLS_SYNC_DISABLED=1`.
- Keep relative TypeScript imports explicit with the `.ts` extension.
- Do not remove or replace the Univer spreadsheet preview without explicit product approval.

Review [docs/conventions.md](docs/conventions.md) before touching authentication, credentials,
permissions, Connector tools, binary preparation, branding, or release workflows.

## Pull Request Expectations

A pull request should explain:

- the user-visible or engineering problem;
- the chosen solution and important tradeoffs;
- the tests and runtime verification performed;
- security, migration, compatibility, or release implications;
- documentation updated as part of the change.

Human-readable Git text—branch names, commit messages, pull request titles and descriptions,
comments, tags, and release notes—must be written in English.

## License

Unless explicitly stated otherwise, contributions intentionally submitted to this repository are
licensed under the [Apache License, Version 2.0](LICENSE), without additional terms or conditions.
