# Dev Debugging

Use this when the agent needs to start the desktop app, inspect it, and keep working without human
screen sharing.

## Launch

- `corepack npm run dev`
- `VITE_WANTA_ROUTE=settings corepack npm run dev`
- `VITE_WANTA_SMOKE="hello" corepack npm run dev`

## What to inspect

- The Vite terminal output
- Electron main-process logs
- `~/Library/Application Support/wanta/logs/diagnostics.jsonl`
- the live app window

## macOS inspection helpers

- `osascript` for window/process state
- `screencapture` for a full-screen or region capture
- `lsof -iTCP:5273 -sTCP:LISTEN` for port conflicts

## Common failure modes

- Electron window never appears
- app stays on the login gate because no model or account is configured
- port `5273` already taken
- a stale Electron process is still alive after a stopped session

## Debugging rule

Do not ask a human to describe the screen if the machine can already capture it.
