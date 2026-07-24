# Worktree and Concurrency

Use this when the repo is opened in a fresh worktree and multiple agents may run in parallel.

## Current state

- `corepack pnpm run bootstrap` derives a per-worktree Vite port and Electron user-data directory.
- `corepack pnpm run dev:worktree` reads `.wanta-dev/bootstrap.json` and launches with that isolated
  environment.
- Ordinary product work can restore a machine-level signed-in snapshot with
  `corepack pnpm run auth:restore`.
- Login/auth work can reset the current worktree to a clean signed-out profile with
  `corepack pnpm run auth:clean`.

## Current shared resources

- Raw `corepack pnpm run dev` still uses the default Vite port and the platform default Electron user-data
  path.
- Raw `corepack pnpm run dev` may register the `wanta-local` protocol handler.
- The machine-level login snapshot at `~/wanta-dev/login-state` is shared read-only input for
  worktrees; each worktree restores it into its own `.wanta-dev/user-data`.
- Only one session per machine should enable protocol registration for login callback work.

## Current safe assumptions

- One active `corepack pnpm run dev` per machine is the default safe mode.
- `corepack pnpm run dev:worktree` is the safer default for parallel agent work.
- `corepack pnpm run auth:restore` replaces only the current worktree's generated user-data directory.
- `corepack pnpm run auth:clean` is the right starting point for login, logout, callback, and first-run
  behavior.
- `WANTA_ELECTRON_AUTO_START=0` is useful when you want the build/watch loop without auto-launch.
- Branches should stay short-lived and isolated from `main`.

## What to watch

- Port collisions
- Shared user data
- Shared protocol registration
- Expired machine login snapshots
- Any background process that survives a stopped dev session

## Worktree-safe startup

1. Run `corepack pnpm run bootstrap`.
2. Run `corepack pnpm run auth:restore` for normal work, or `corepack pnpm run auth:clean` for auth
   work.
3. Run `corepack pnpm run dev:worktree`.

If `auth:restore` fails, the machine has not been prepared or the saved session expired. Run
`corepack pnpm run auth:capture` once with human sign-in, then restore again in the worktree.
