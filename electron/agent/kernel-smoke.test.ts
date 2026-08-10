import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { expect, test } from "vitest"
import { AgentManager } from "./manager.ts"
import { OpencodeAgentAdapter } from "./opencode-adapter.ts"

// Opt-in smoke against the real opencode sidecar (no LLM call, no login):
// verifies the adapter assembly end to end — start, event-stream attach,
// session CRUD passthrough, stop/teardown. Skipped unless WANTA_KERNEL_SMOKE=1
// so CI and normal test runs never spawn a sidecar.
//
//   WANTA_KERNEL_SMOKE=1 pnpm exec vitest run electron/agent/kernel-smoke.test.ts

const enabled = process.env["WANTA_KERNEL_SMOKE"] === "1"

test.runIf(enabled)(
  "opencode adapter drives a real sidecar through the contract lifecycle",
  { timeout: 120_000 },
  async () => {
    const repoRoot = path.resolve(import.meta.dirname, "..", "..")
    const rootDir = await mkdtemp(path.join(tmpdir(), "wanta-kernel-smoke-"))
    const manager = new AgentManager({
      linkRuntime: null,
      modelAccess: { kind: "local" },
      opencodeBinPath: path.join(repoRoot, "node_modules/opencode-ai/bin/opencode.exe"),
      bundledToolRuntimePath: path.join(repoRoot, "resources/agent-tool-runtime/tool.js"),
      rootDir,
      customModels: [
        {
          id: "smoke-model",
          providerId: "openai-compatible",
          providerName: "Smoke",
          baseUrl: "http://127.0.0.1:9/v1",
          apiKey: "smoke-test-key",
          modelName: "smoke",
          displayName: "Smoke",
          supportsImages: false,
          supportsToolCalls: true,
        },
      ],
      defaultModel: { kind: "custom", id: "smoke-model" },
    })
    const adapter = new OpencodeAgentAdapter(manager)
    const events: string[] = []
    adapter.onEvent((event) => events.push(event.event))
    try {
      await adapter.start()
      expect(adapter.isReady()).toBe(true)
      expect(adapter.url).toMatch(/^http:\/\/127\.0\.0\.1:/)

      const created = await adapter.createSession("Kernel smoke session")
      expect((await adapter.listSessions()).some((session) => session.id === created.id)).toBe(true)
      await adapter.renameSession(created.id, "Kernel smoke renamed")
      expect((await adapter.listSessions()).find((session) => session.id === created.id)?.title).toBe(
        "Kernel smoke renamed",
      )
      await adapter.deleteSession(created.id)
      expect((await adapter.listSessions()).some((session) => session.id === created.id)).toBe(false)
    } finally {
      await adapter.stop()
      await rm(rootDir, { recursive: true, force: true }).catch(() => undefined)
    }
  },
)
