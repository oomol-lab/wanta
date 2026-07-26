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

- Normal product work: launch with `dev:worktree`; an empty worktree `./wanta` initializes once from
  the canonical repo's `./wanta` when available.
- Login/auth work: `corepack pnpm run auth:clean`, then launch with `dev:worktree`.
- There is no machine-level `~/wanta-dev` auth snapshot. If no canonical `./wanta` exists or its
  login has expired, sign in in the current checkout's own `./wanta` profile.

Do not ask the user to describe a logged-in screen before checking whether the current worktree has
the intended auth mode. `auth:status` reports profile and cookie-marker presence without printing
credentials.

When login state is suspect, run `corepack pnpm run auth:status` first. It reports the current
checkout's `./wanta` profile, cookie marker, and cookie expiry without printing credentials.

## What to inspect

- The Vite terminal output
- Electron main-process logs
- `wanta/logs/diagnostics.jsonl` when using `dev` or `dev:worktree`
- `~/Library/Application Support/wanta/logs/diagnostics.jsonl` only for packaged app runs
- the live app window

## macOS inspection helpers

- `osascript` for window/process state
- `screencapture` for a full-screen or region capture
- `cat .wanta-dev/bootstrap.json` for the active worktree port, protocol scheme, and user-data path
- `corepack pnpm run auth:status` for the current worktree auth mode and saved cookie expiry
- `lsof -iTCP:<port> -sTCP:LISTEN` for port conflicts

## Common failure modes

- Electron window never appears
- app stays on the login gate because the canonical/current `./wanta` is missing, signed out, or
  expired, or the task intentionally started from `auth:clean`
- the worktree port is already taken
- a stale Electron process is still alive after a stopped session
- login callback does not return to the app because protocol registration is disabled in
  `dev:worktree`

## Debugging rule

Do not ask a human to describe the screen if the machine can already capture it.
