import type { AgentEvent } from "../contract/event.ts"

import { describe, expect, it } from "vitest"
import { ExternalTranscriptRecorder } from "./transcript.ts"

const sessionId = "wanta-ext:claude-code:22222222-2222-4222-8222-222222222222"

function recordAll(recorder: ExternalTranscriptRecorder, events: AgentEvent[]): void {
  for (const event of events) {
    recorder.record(event)
  }
}

describe("ExternalTranscriptRecorder", () => {
  it("restore round-trips a recorded session through the flattened snapshot", () => {
    const recorder = new ExternalTranscriptRecorder()
    recordAll(recorder, [
      { event: "messageStarted", data: { sessionId, messageId: "m1", role: "user" } },
      { event: "messageDelta", data: { sessionId, messageId: "m1", partId: "m1:0", text: "hi" } },
      { event: "messageStarted", data: { sessionId, messageId: "m2", role: "assistant" } },
      { event: "messageReasoningDelta", data: { sessionId, messageId: "m2", partId: "m2:0", text: "hmm" } },
      { event: "messageDelta", data: { sessionId, messageId: "m2", partId: "m2:1", text: "hello" } },
      { event: "messageCompleted", data: { sessionId } },
    ])
    const snapshot = recorder.messages(sessionId)

    const restored = new ExternalTranscriptRecorder()
    restored.restore(sessionId, snapshot)
    expect(restored.has(sessionId)).toBe(true)
    expect(restored.messages(sessionId)).toEqual(snapshot)
  })

  it("restore never overrides live in-memory state", () => {
    const recorder = new ExternalTranscriptRecorder()
    recordAll(recorder, [
      { event: "messageStarted", data: { sessionId, messageId: "live", role: "assistant" } },
      { event: "messageDelta", data: { sessionId, messageId: "live", partId: "live:0", text: "live text" } },
    ])
    recorder.restore(sessionId, [{ id: "stale", role: "assistant", parts: [], createdAt: 1 }])
    expect(recorder.messages(sessionId).map((message) => message.id)).toEqual(["live"])
  })

  it("attaches usage reports to the latest assistant message, parking early ones", () => {
    const recorder = new ExternalTranscriptRecorder()
    const usage = {
      total: 100,
      input: 50,
      output: 50,
      reasoning: 0,
      cache: { read: 0, write: 0 },
      contextWindow: 200_000,
    }
    // Reported before any assistant message exists: parked, then applied.
    recorder.record({ event: "usageUpdated", data: { sessionId, tokenUsage: usage } })
    recorder.record({ event: "messageStarted", data: { sessionId, messageId: "a1", role: "assistant" } })
    expect(recorder.messages(sessionId)[0]?.tokenUsage).toEqual(usage)

    const updated = { ...usage, total: 200 }
    recorder.record({ event: "usageUpdated", data: { sessionId, tokenUsage: updated } })
    expect(recorder.messages(sessionId)[0]?.tokenUsage).toEqual(updated)
  })
})
