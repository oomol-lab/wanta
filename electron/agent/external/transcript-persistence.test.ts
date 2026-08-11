import type { AgentEvent } from "../contract/event.ts"
import type { AgentSendOptions, CancelAgentInput, PromptAgentInput } from "../contract/input.ts"
import type { ExternalAgentAdapterOptions } from "./adapter-base.ts"
import type { ExternalAgentRuntimeStatus } from "./status.ts"

import { mkdtemp, readdir, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import { AGENT_PROFILES } from "../contract/profile.ts"
import { ExternalAgentAdapter } from "./adapter-base.ts"
import { mintExternalSessionId } from "./session-id.ts"

// Restart-flow coverage for on-disk transcript persistence: everything an
// adapter emits must survive into a fresh adapter instance pointed at the same
// transcript directory, and deletion must reach the disk too.

class FakeExternalAdapter extends ExternalAgentAdapter {
  public readonly kind = "claude-code"
  public readonly profile = AGENT_PROFILES["claude-code"]

  public constructor(options: ExternalAgentAdapterOptions) {
    super(options)
  }

  public emitForTest(event: AgentEvent): void {
    this.emit(event)
  }

  public runtimeStatus(): Promise<ExternalAgentRuntimeStatus> {
    return Promise.resolve({
      kind: "claude-code",
      displayName: "Claude Code",
      binary: { status: "detected", path: "/fake/claude" },
      login: { status: "logged_in" },
      loginHint: "",
    })
  }

  protected handleStart(): Promise<void> {
    return Promise.resolve()
  }

  protected handleStop(): Promise<void> {
    return Promise.resolve()
  }

  protected handlePrompt(_input: PromptAgentInput, _options?: AgentSendOptions): Promise<void> {
    return Promise.resolve()
  }

  protected handleCancel(_input: CancelAgentInput, _options?: AgentSendOptions): Promise<void> {
    return Promise.resolve()
  }
}

function assistantTurn(sessionId: string, messageId: string, text: string): AgentEvent[] {
  return [
    { event: "messageStarted", data: { sessionId, messageId, role: "assistant" } },
    { event: "messageDelta", data: { sessionId, messageId, partId: `${messageId}:0`, text } },
    { event: "messageCompleted", data: { sessionId } },
  ]
}

describe("external transcript persistence", () => {
  const cleanups: string[] = []

  afterEach(async () => {
    for (const dir of cleanups.splice(0)) {
      await rm(dir, { recursive: true, force: true }).catch(() => undefined)
    }
  })

  async function makeTranscriptDir(): Promise<string> {
    const dir = await mkdtemp(path.join(os.tmpdir(), "wanta-transcripts-"))
    cleanups.push(dir)
    return dir
  }

  it("restores a persisted transcript in a fresh adapter instance", async () => {
    const transcriptDir = await makeTranscriptDir()
    const sessionId = mintExternalSessionId("claude-code")

    const first = new FakeExternalAdapter({ transcriptDir })
    await first.start()
    for (const event of assistantTurn(sessionId, "m1", "persisted reply")) {
      first.emitForTest(event)
    }
    await first.stop()
    expect(await readdir(transcriptDir)).toHaveLength(1)

    const second = new FakeExternalAdapter({ transcriptDir })
    const messages = await second.getMessages(sessionId)
    expect(messages).toHaveLength(1)
    expect(messages[0]?.parts[0]).toMatchObject({ kind: "text", text: "persisted reply" })
    expect(messages[0]?.completedAt).toBeDefined()
    expect(messages[0]?.finishReason).toBe("stop")
    await second.stop()
  })

  it("appends new turns to a restored transcript instead of overwriting it", async () => {
    const transcriptDir = await makeTranscriptDir()
    const sessionId = mintExternalSessionId("claude-code")

    const first = new FakeExternalAdapter({ transcriptDir })
    await first.start()
    for (const event of assistantTurn(sessionId, "m1", "first run")) {
      first.emitForTest(event)
    }
    await first.stop()

    const second = new FakeExternalAdapter({ transcriptDir })
    await second.start()
    // Sending a prompt (not viewing) must hydrate before new events record.
    await second.send({ type: "prompt", sessionId, text: "continue" })
    for (const event of assistantTurn(sessionId, "m2", "second run")) {
      second.emitForTest(event)
    }
    await second.stop()

    const third = new FakeExternalAdapter({ transcriptDir })
    const messages = await third.getMessages(sessionId)
    expect(messages.map((message) => message.id)).toEqual(["m1", "m2"])
    await third.stop()
  })

  it("forgetSession removes the on-disk transcript", async () => {
    const transcriptDir = await makeTranscriptDir()
    const sessionId = mintExternalSessionId("claude-code")

    const first = new FakeExternalAdapter({ transcriptDir })
    await first.start()
    for (const event of assistantTurn(sessionId, "m1", "to be deleted")) {
      first.emitForTest(event)
    }
    first.forgetSession(sessionId)
    await first.stop()
    expect(await readdir(transcriptDir).catch(() => [])).toHaveLength(0)

    const second = new FakeExternalAdapter({ transcriptDir })
    expect(await second.getMessages(sessionId)).toEqual([])
    await second.stop()
  })

  it("stays purely in-memory when no transcript directory is configured", async () => {
    const sessionId = mintExternalSessionId("claude-code")
    const adapter = new FakeExternalAdapter({})
    await adapter.start()
    for (const event of assistantTurn(sessionId, "m1", "ephemeral")) {
      adapter.emitForTest(event)
    }
    expect((await adapter.getMessages(sessionId))[0]?.parts[0]).toMatchObject({ text: "ephemeral" })
    await adapter.stop()
  })
})
