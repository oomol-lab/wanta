# Dev Debugging

Use this when the agent needs to start the desktop app, inspect it, and keep working without human
screen sharing.

## Launch

- `corepack pnpm run dev:worktree`
- `VITE_WANTA_ROUTE=settings corepack pnpm run dev:worktree`
- `VITE_WANTA_SMOKE="hello" corepack pnpm run dev:worktree`
- `WANTA_SKIP_PROTOCOL_REGISTRATION=0 corepack pnpm run dev:worktree` only when debugging login
  callback handling; keep this to one active session per machine.

## Auth state modes

- Normal product work: `corepack pnpm run auth:restore`, then launch with `dev:worktree`.
- Login/auth work: `corepack pnpm run auth:clean`, then launch with `dev:worktree`.
- Machine setup or expired snapshot: `corepack pnpm run auth:capture`, sign in, wait for the script
  to save the snapshot, then check `corepack pnpm run auth:status`.

Do not ask the user to describe a logged-in screen before checking whether the current worktree has
the intended auth mode. `auth:status` reports profile and cookie-marker presence without printing
credentials.

## What to inspect

- The Vite terminal output
- Electron main-process logs
- `.wanta-dev/user-data/logs/diagnostics.jsonl` when using `dev:worktree`
- `~/Library/Application Support/wanta/logs/diagnostics.jsonl` only for raw dev or packaged app runs
- the live app window

## macOS inspection helpers

- `osascript` for window/process state
- `screencapture` for a full-screen or region capture
- `cat .wanta-dev/bootstrap.json` for the active worktree port, protocol scheme, and user-data path
- `corepack pnpm run auth:status` for the current worktree auth mode
- `lsof -iTCP:<port> -sTCP:LISTEN` for port conflicts

## Common failure modes

- Electron window never appears
- app stays on the login gate because `auth:restore` was not run, the snapshot is expired, or the
  task intentionally started from `auth:clean`
- the worktree port is already taken
- a stale Electron process is still alive after a stopped session
- login callback does not return to the app because protocol registration is disabled in
  `dev:worktree`

## Debugging rule

Do not ask a human to describe the screen if the machine can already capture it.
