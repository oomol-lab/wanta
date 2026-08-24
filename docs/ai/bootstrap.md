# Bootstrap

This is the repeatable bootstrap path for a fresh checkout after the human has already prepared the
machine-level prerequisites.

## Preconditions

- Node.js `>=22.22.2`
- pnpm `11.23.0` via `corepack`
- screen recording permission on macOS if visual verification will be needed
- any required hardware or OS permissions already granted by the operator

## Steps

1. Run `corepack pnpm run bootstrap`.
2. Run `corepack pnpm run dev:worktree` for worktree-aware development. If the current worktree's
   `./wanta` userData is missing or empty, it is initialized once from the canonical repo's
   `./wanta` when that source exists and is non-empty.
3. For login, sign-in, sign-out, auth persistence, or first-run work, run
   `corepack pnpm run auth:clean` to start with a clean signed-out dev profile. Delete `./wanta`
   when you want `dev:worktree` to initialize from the canonical repo again.
4. If the checkout is partially initialized, rerun `corepack pnpm run bootstrap`; it is idempotent.
5. Run the quality gate when needed:
   - `corepack pnpm run ts-check`
   - `corepack pnpm run lint`
   - `corepack pnpm run format`
   - `corepack pnpm test`
   - `corepack pnpm run build`

## Dev userData

- Source `corepack pnpm run dev` uses `<repo>/wanta` as the complete Electron userData directory.
- `corepack pnpm run dev:worktree` uses `<worktree>/wanta` as the complete Electron userData
  directory, never the canonical repo's directory directly.
- `dev:worktree` copies the canonical repo's `./wanta` only when the target `./wanta` is missing or
  empty. Existing worktree state is never overwritten.
- The old `~/wanta-dev/login-state` and `~/wanta-dev/login-user-data` auth snapshot flow is retired;
  new development commands do not create, read, or depend on `~/wanta-dev`.

`corepack pnpm run auth:status` now reports only the current checkout's `./wanta`. `auth:clean`
removes and recreates that directory with a small marker so `dev:worktree` preserves the intentionally
signed-out profile. `auth:capture`, `auth:save`, and `auth:restore` are deprecated.

## Dev launch

- Worktree-aware default: `corepack pnpm run dev:worktree`
- Source-checkout dev: `corepack pnpm run dev`
- Headless renderer startup only: `corepack pnpm run dev:no-electron`
- Disable Electron auto-start when you want the Vite process without an app window:
  `WANTA_ELECTRON_AUTO_START=0 corepack pnpm run dev`
- Login capture, sign-in callback, and protocol-handler debugging require the dev protocol handler:
  `WANTA_SKIP_PROTOCOL_REGISTRATION=0 corepack pnpm run dev:worktree`. Use only one such session per
  machine.

## Known initialization outputs

- `.electron-dist/`
- `.oo-bin/`
- `resources/skills/`
- `resources/agent-tool-runtime/`
- `.wanta-dev/bootstrap.json`
- `.wanta-dev/env.sh`
- `wanta/`

The generated worktree env isolates the dev session by setting:

- `WANTA_DEV_SERVER_PORT`
- `WANTA_SKIP_PROTOCOL_REGISTRATION=1`
- `WANTA_USER_DATA_DIR`

If any of these are missing after bootstrap, rerun `corepack pnpm run bootstrap` before debugging the app.
