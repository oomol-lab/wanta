# Wanta AI Guide

> Thin entry point for AI agents. Read only the subdoc that matches the current task.

## What this is

Wanta is OOMOL's Electron desktop AI-agent chat client.

## AI Constitution

- Read only the subdoc that matches the current task.
- Keep setup deterministic and repeatable.
- Treat worktree isolation and concurrent agents as first-class concerns.
- Keep Electron dev observable by the machine, not by human narration.
- Preserve credential, endpoint, branding, and runtime-boundary rules.

## When to read what

- [docs/ai/bootstrap.md](docs/ai/bootstrap.md): fresh checkout, install, and repeatable initialization
- [docs/ai/worktree.md](docs/ai/worktree.md): worktree isolation and concurrent-agent behavior
- [docs/ai/dev-debugging.md](docs/ai/dev-debugging.md): Electron dev startup, logs, screenshots, and local bug inspection
- [docs/development.md](docs/development.md): human-facing development workflow and environment details
- [docs/architecture.md](docs/architecture.md): process split, agent kernel, and IPC layout
- [docs/conventions.md](docs/conventions.md): code conventions and security baseline
- [docs/project-overview.md](docs/project-overview.md): product overview and system context
