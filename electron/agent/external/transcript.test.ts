import type { AgentEvent } from "../contract/event.ts"

import { describe, expect, it } from "vitest"
import { createClaudeTurnTranslator } from "../claude/translator.ts"
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

  it("stores the real per-block claude emission as one text and one reasoning part", () => {
    // End-to-end regression for the duplicated-reply defect: the translator's
    // authoritative upserts must land on the streamed part ids, leaving the
    // recorder with exactly one part per content block.
    const translator = createClaudeTurnTranslator(sessionId)
    const recorder = new ExternalTranscriptRecorder()
    const frames = [
      { type: "stream_event", event: { type: "message_start", message: { id: "msg_1" } } },
      {
        type: "stream_event",
        event: {
          type: "content_block_start",
          index: 0,
          content_block: { type: "thinking", thinking: "", signature: "" },
        },
      },
      {
        type: "stream_event",
        event: { type: "content_block_delta", index: 0, delta: { type: "thinking_delta", thinking: "pondering" } },
      },
      {
        type: "assistant",
        message: { id: "msg_1", content: [{ type: "thinking", thinking: "pondering", signature: "" }] },
      },
      {
        type: "stream_event",
        event: { type: "content_block_start", index: 1, content_block: { type: "text", text: "" } },
      },
      {
        type: "stream_event",
        event: { type: "content_block_delta", index: 1, delta: { type: "text_delta", text: "Hello there" } },
      },
      { type: "assistant", message: { id: "msg_1", content: [{ type: "text", text: "Hello there" }] } },
      { type: "result", subtype: "success", is_error: false, result: "done" },
    ]
    for (const frame of frames) {
      recordAll(recorder, translator.translate(frame as never))
    }

    const messages = recorder.messages(sessionId)
    expect(messages).toHaveLength(1)
    const parts = messages[0]?.parts ?? []
    expect(parts.map((part) => part.kind)).toEqual(["reasoning", "text"])
    const textOccurrences = parts.filter((part) => part.kind === "text" && (part.text ?? "").includes("Hello there"))
    expect(textOccurrences).toHaveLength(1)
  })
})
