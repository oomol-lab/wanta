import { afterEach, describe, expect, it, vi } from "vitest"
import { ChatStreamEventBuffer, coalesceBufferedStreamEvent } from "./stream-event-buffer.ts"

afterEach(() => {
  vi.useRealTimers()
})

function delta(text: string, increment?: string) {
  return {
    event: "messageDelta" as const,
    data: {
      sessionId: "session-1",
      messageId: "message-1",
      partId: "part-1",
      text,
      ...(increment === undefined ? {} : { delta: increment }),
    },
  }
}

describe("coalesceBufferedStreamEvent", () => {
  it("keeps only the latest cumulative text snapshot", () => {
    expect(coalesceBufferedStreamEvent(delta("Hello"), delta("Hello world", " world"))).toEqual(
      delta("Hello world", " world"),
    )
  })

  it("combines providers that emit only deltas", () => {
    expect(coalesceBufferedStreamEvent(delta("", "Hello"), delta("", " world"))).toEqual(delta("", "Hello world"))
  })
})

describe("ChatStreamEventBuffer", () => {
  it("emits at most one update per part in a flush window", () => {
    vi.useFakeTimers()
    const emit = vi.fn()
    const buffer = new ChatStreamEventBuffer(emit, { delayMs: 32 })

    buffer.enqueue(delta("H", "H"))
    buffer.enqueue(delta("Hello", "ello"))
    vi.advanceTimersByTime(31)
    expect(emit).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1)

    expect(emit).toHaveBeenCalledTimes(1)
    expect(emit).toHaveBeenCalledWith(delta("Hello", "ello"))
  })

  it("flushes control boundaries immediately and can discard stale work", () => {
    vi.useFakeTimers()
    const emit = vi.fn()
    const buffer = new ChatStreamEventBuffer(emit)

    buffer.enqueue(delta("first"))
    buffer.flush()
    expect(emit).toHaveBeenCalledWith(delta("first"))

    buffer.enqueue(delta("stale"))
    buffer.clear()
    vi.runAllTimers()
    expect(emit).toHaveBeenCalledTimes(1)
  })
})
