## Summary

<!-- Explain the user-visible or engineering outcome. -->

## Verification

<!-- List automated checks and real runtime/UI verification. -->

- [ ] `corepack pnpm run ts-check`
- [ ] `corepack pnpm run lint`
- [ ] `corepack pnpm run format`
- [ ] `corepack pnpm test`
- [ ] `corepack pnpm run build`
- [ ] Runtime/UI verification completed or not applicable

## Safety and Compatibility

- [ ] Local BYOK and signed-in OOMOL modes were considered separately.
- [ ] No credential was exposed to the renderer, logs, fixtures, screenshots, or committed files.
- [ ] Agent tools, permissions, and system prompts remain aligned, or the change does not affect them.
- [ ] Migration, packaging, endpoint, and update implications were considered.
- [ ] Relevant documentation and tests were updated.
