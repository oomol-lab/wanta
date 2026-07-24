# Bootstrap

This is the repeatable bootstrap path for a fresh checkout after the human has already prepared the
machine-level prerequisites.

## Preconditions

- Node.js `>=22.22.2`
- pnpm `9.14.4` via `corepack`
- screen recording permission on macOS if visual verification will be needed
- any required hardware or OS permissions already granted by the operator

## Steps

1. Run `corepack pnpm run bootstrap`.
2. For ordinary product work, restore the machine-level signed-in snapshot:
   `corepack pnpm run auth:restore`.
3. For login, sign-in, sign-out, auth persistence, or first-run work, use a clean signed-out
   worktree profile instead: `corepack pnpm run auth:clean`.
4. If the checkout is partially initialized, rerun `corepack pnpm run bootstrap`; it is
   idempotent. Re-run `auth:restore` or `auth:clean` after bootstrap if you need to reset the
   current worktree profile.
5. Run the quality gate when needed:
   - `corepack pnpm run ts-check`
   - `corepack pnpm run lint`
   - `corepack pnpm run format`
   - `corepack pnpm test`
   - `corepack pnpm run build`

## Machine-level login snapshot

Use this only when `auth:restore` reports that the machine login snapshot is missing or incomplete.
It is a machine setup step, not a normal worktree task.

1. Run `corepack pnpm run auth:capture`.
2. Sign in through the Electron window.
3. Wait for the script to detect the login, stop the dev app, and save the snapshot.
4. Check it with `corepack pnpm run auth:status`.

The snapshot is stored outside the repo at `~/wanta-dev/login-state`. The temporary capture profile
is `~/wanta-dev/login-user-data`. These directories contain Electron session data and must not be
committed, copied into a worktree, or printed in logs. The script only checks for the
`oomol-token` cookie name marker; it never prints the token value.

## Dev launch

- Worktree-aware default: `corepack pnpm run dev:worktree`
- Raw dev server only: `corepack pnpm run dev`
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
- `.wanta-dev/user-data`

The generated env isolates the dev session by setting:

- `WANTA_DEV_SERVER_PORT`
- `WANTA_SKIP_PROTOCOL_REGISTRATION=1`
- `WANTA_USER_DATA_DIR`

If any of these are missing after bootstrap, rerun `corepack pnpm run bootstrap` before debugging the app.
