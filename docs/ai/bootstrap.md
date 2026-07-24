# Bootstrap

This is the repeatable bootstrap path for a fresh checkout after the human has already prepared the
machine-level prerequisites.

## Preconditions

- Node.js `>=22.22.2`
- npm `10.9.4` via `corepack`
- screen recording permission on macOS if visual verification will be needed
- any required hardware or OS permissions already granted by the operator

## Steps

1. Run `corepack npm install`.
2. Run `corepack npm run predev`.
3. If the checkout is partially initialized, rerun `corepack npm install`; it is idempotent.
4. Run the quality gate when needed:
   - `corepack npm run ts-check`
   - `corepack npm run lint`
   - `corepack npm run format`
   - `corepack npm test`
   - `corepack npm run build`

## Dev launch

- Default: `corepack npm run dev`
- Headless renderer startup only: `corepack npm run dev:no-electron`
- Disable Electron auto-start when you want the Vite process without an app window:
  `WANTA_ELECTRON_AUTO_START=0 corepack npm run dev`

## Known initialization outputs

- `.electron-dist/`
- `.oo-bin/`
- `resources/skills/`
- `resources/agent-tool-runtime/`

If any of these are missing after install, rerun the install step before debugging the app.
