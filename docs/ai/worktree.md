# Worktree and Concurrency

Use this when the repo is opened in a fresh worktree and multiple agents may run in parallel.

## Current state

- The repo is not yet isolated by worktree out of the box.
- Dev mode currently shares a fixed Vite port and the default Electron user-data path.
- That means concurrent dev sessions will conflict unless they are coordinated.

## Current shared resources

- Vite dev server port: `5273`
- Electron dev user data: the platform default path under `app.getPath("userData")`
- App protocol registration: the same `wanta-local` scheme in dev

## Current safe assumptions

- One active `npm run dev` per machine is the default safe mode.
- `WANTA_ELECTRON_AUTO_START=0` is useful when you want the build/watch loop without auto-launch.
- Branches should stay short-lived and isolated from `main`.

## What to watch

- Port collisions
- Shared user data
- Shared protocol registration
- Single-instance app behavior
- Any background process that survives a stopped dev session

## Next step for real worktree safety

Introduce a worktree-aware bootstrap that derives per-worktree app state and a collision-free dev
port before launching Electron.
