# Worktree and Concurrency

Use this when the repo is opened in a fresh worktree and multiple agents may run in parallel.

## Current state

- `corepack pnpm run bootstrap` derives a per-worktree Vite port and records the worktree Electron
  userData directory.
- `corepack pnpm run dev:worktree` reads `.wanta-dev/bootstrap.json` and launches with that isolated
  environment.
- Ordinary product work starts from the worktree's `./wanta`. If it is missing or empty,
  `dev:worktree` initializes it once from the canonical repo's `./wanta` when available.
- Login/auth work can reset the current worktree to a clean signed-out profile with
  `corepack pnpm run auth:clean`, which clears `./wanta` and leaves a marker so startup does not
  re-initialize it from the canonical repo.

## Current shared resources

- Raw `corepack pnpm run dev` still uses the default Vite port, but its Electron userData path is
  `<repo>/wanta` instead of the platform default.
- Raw `corepack pnpm run dev` may register the `wanta-local` protocol handler.
- The canonical repo's `./wanta` is a one-time initialization source for empty worktree `./wanta`
  directories; it is never used as a shared runtime profile.
- Only one session per machine should enable protocol registration for login callback work.

## Current safe assumptions

- One active `corepack pnpm run dev` per machine is the default safe mode.
- `corepack pnpm run dev:worktree` is the safer default for parallel agent work.
- Existing worktree `./wanta` data is never overwritten by startup.
- `corepack pnpm run auth:clean` is the right starting point for login, logout, callback, and first-run
  behavior.
- `WANTA_ELECTRON_AUTO_START=0` is useful when you want the build/watch loop without auto-launch.
- Branches should stay short-lived and isolated from `main`.

## What to watch

- Port collisions
- Shared user data
- Shared protocol registration
- Missing, signed-out, or expired canonical/current `./wanta` profiles
- Any background process that survives a stopped dev session

## Worktree-safe startup

1. Run `corepack pnpm run bootstrap`.
2. Run `corepack pnpm run auth:clean` only when you intentionally need a signed-out profile.
3. Run `corepack pnpm run dev:worktree`.

If no canonical `./wanta` exists, the worktree still starts normally and shows the login page.
