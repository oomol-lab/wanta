import type { AgentEvent } from "../contract/event.ts"
import type { ExternalAgentAdapter } from "./adapter-base.ts"

import { mkdtemp, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { expect, test } from "vitest"
import { AcpAgentAdapter } from "../acp/adapter.ts"
import { ACP_AGENT_REGISTRY } from "../acp/registry.ts"
import { probeExternalAgent } from "./probe.ts"
import { mintExternalSessionId } from "./session-id.ts"

// Opt-in smoke against the REAL local agent binaries (no fakes):
//
//   WANTA_BYOA_SMOKE=1 pnpm exec vitest run electron/agent/external/byoa-smoke.test.ts
//
// Each case passes when the adapter either completes a real turn with visible
// assistant text, or surfaces a clean sign-in error carrying the login hint —
// both outcomes prove the spawn transport and protocol mapping work against the
// installed binary. Skipped by default so CI never spawns user CLIs or spends
// user quota.

const enabled = process.env["WANTA_BYOA_SMOKE"] === "1"

interface SmokeOutcome {
  completed: boolean
  assistantText: string
  authError: string | undefined
  events: AgentEvent[]
}

async function runSmokeTurn(adapter: ExternalAgentAdapter, sessionId: string, prompt: string): Promise<SmokeOutcome> {
  const events: AgentEvent[] = []
  let completed = false
  let authError: string | undefined
  adapter.onEvent((event) => {
    events.push(event)
    if (event.event === "messageCompleted") {
      completed = true
    }
    if (event.event === "agentError" && /sign-in|sign in|login|authentication/iu.test(event.data.message)) {
      authError = event.data.message
    }
  })
  await adapter.start()
  try {
    await adapter.send({ type: "prompt", sessionId, text: prompt })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    if (/sign-in|sign in|login|authentication/iu.test(message)) {
      return { completed: false, assistantText: "", authError: message, events }
    }
    throw error
  }
  const deadline = Date.now() + 120_000
  while (Date.now() < deadline && !completed && !authError) {
    await new Promise((resolve) => setTimeout(resolve, 250))
  }
  const assistantText = events
    .filter((event): event is Extract<AgentEvent, { event: "messageDelta" }> => event.event === "messageDelta")
    .map((event) => event.data.text)
    .join("\n")
  return { completed, assistantText, authError, events }
}

/** Optionally record outcomes for the operator (WANTA_BYOA_SMOKE_OUT=<file>). */
async function reportOutcome(kind: string, outcome: SmokeOutcome): Promise<void> {
  const target = process.env["WANTA_BYOA_SMOKE_OUT"]
  if (!target) {
    return
  }
  const { appendFile } = await import("node:fs/promises")
  await appendFile(
    target,
    `${JSON.stringify({
      kind,
      completed: outcome.completed,
      authError: outcome.authError ?? null,
      assistantTextPreview: outcome.assistantText.slice(0, 200),
      eventKinds: [...new Set(outcome.events.map((event) => event.event))],
    })}\n`,
  )
}

function expectUsableOutcome(outcome: SmokeOutcome, loginHint: string): void {
  if (outcome.authError) {
    expect(outcome.authError).toContain(loginHint)
    return
  }
  expect(outcome.completed).toBe(true)
  expect(outcome.assistantText.length).toBeGreaterThan(0)
}

test.runIf(enabled)(
  "claude-code adapter completes a real ACP turn via claude-agent-acp",
  { timeout: 180_000 },
  async () => {
    const scratchRootDir = await mkdtemp(path.join(os.tmpdir(), "wanta-byoa-smoke-claude-"))
    const registration = ACP_AGENT_REGISTRY["claude-code"]
    const probeOptions = { extraBinDirectories: [path.join(process.cwd(), "node_modules", ".bin")] }
    const adapter = new AcpAgentAdapter({
      kind: "claude-code",
      registration,
      probe: () => probeExternalAgent("claude-code", probeOptions),
      scratchRootDir,
    })
    try {
      const status = await adapter.runtimeStatus()
      if (status.binary.status !== "detected") {
        console.warn("[byoa-smoke] claude-agent-acp bridge not detected; smoke degraded to probe-only")
        return
      }
      const outcome = await runSmokeTurn(
        adapter,
        mintExternalSessionId("claude-code"),
        "Reply with exactly the two words: SMOKE OK. Do not use any tools.",
      )
      expectUsableOutcome(outcome, "sign in")
      if (outcome.completed) {
        expect(outcome.assistantText).toMatch(/SMOKE OK/iu)
      }
      await reportOutcome("claude-code", outcome)
    } finally {
      await adapter.stop()
      await rm(scratchRootDir, { recursive: true, force: true }).catch(() => undefined)
    }
  },
)

test.runIf(enabled)(
  "codex adapter completes a real ACP turn via the codex-acp bridge",
  { timeout: 180_000 },
  async () => {
    const scratchRootDir = await mkdtemp(path.join(os.tmpdir(), "wanta-byoa-smoke-codex-"))
    const registration = ACP_AGENT_REGISTRY["codex"]
    // codex-acp is npm-distributed; dev resolves it from node_modules/.bin like create.ts does.
    const probeOptions = { extraBinDirectories: [path.join(process.cwd(), "node_modules", ".bin")] }
    const adapter = new AcpAgentAdapter({
      kind: "codex",
      registration,
      probe: () => probeExternalAgent("codex", probeOptions),
      scratchRootDir,
    })
    try {
      const status = await adapter.runtimeStatus()
      if (status.binary.status !== "detected") {
        console.warn("[byoa-smoke] codex-acp bridge not detected; smoke degraded to probe-only")
        return
      }
      const outcome = await runSmokeTurn(
        adapter,
        mintExternalSessionId("codex"),
        "Reply with exactly the two words: SMOKE OK. Do not use any tools.",
      )
      expectUsableOutcome(outcome, registration.loginHint)
      if (outcome.completed) {
        expect(outcome.assistantText).toMatch(/SMOKE OK/iu)
      }
      await reportOutcome("codex", outcome)
    } finally {
      await adapter.stop()
      await rm(scratchRootDir, { recursive: true, force: true }).catch(() => undefined)
    }
  },
)

test.runIf(enabled)("grok adapter completes a real ACP turn with the installed CLI", { timeout: 180_000 }, async () => {
  const scratchRootDir = await mkdtemp(path.join(os.tmpdir(), "wanta-byoa-smoke-grok-"))
  const registration = ACP_AGENT_REGISTRY["grok"]
  const adapter = new AcpAgentAdapter({
    kind: "grok",
    registration,
    probe: () => probeExternalAgent("grok"),
    scratchRootDir,
  })
  try {
    const status = await adapter.runtimeStatus()
    if (status.binary.status !== "detected") {
      console.warn("[byoa-smoke] grok binary not detected; smoke degraded to probe-only")
      return
    }
    const outcome = await runSmokeTurn(
      adapter,
      mintExternalSessionId("grok"),
      "Reply with exactly the two words: SMOKE OK. Do not use any tools.",
    )
    expectUsableOutcome(outcome, registration.loginHint)
    if (outcome.completed) {
      expect(outcome.assistantText).toMatch(/SMOKE OK/iu)
    }
    await reportOutcome("grok", outcome)
  } finally {
    await adapter.stop()
    await rm(scratchRootDir, { recursive: true, force: true }).catch(() => undefined)
  }
})
