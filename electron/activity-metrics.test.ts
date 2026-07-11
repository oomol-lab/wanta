import { afterEach, describe, expect, it, vi } from "vitest"
import { ActivityMetrics } from "./activity-metrics.ts"

afterEach(() => {
  vi.useRealTimers()
})

describe("ActivityMetrics", () => {
  it("aggregates counts into one bounded snapshot", () => {
    let now = 100
    const onFlush = vi.fn()
    const metrics = new ActivityMetrics(onFlush, { maxKeys: 2, now: () => now })

    metrics.record("message.updated")
    metrics.record("message.updated", 2)
    metrics.record("message.part.updated")
    metrics.record("session.status")
    now = 250
    const snapshot = metrics.flush()

    expect(snapshot).toEqual({
      counts: { "message.part.updated": 1, "message.updated": 3, other: 1 },
      durationMs: 150,
      total: 5,
    })
    expect(onFlush).toHaveBeenCalledOnce()
    expect(metrics.flush()).toBeNull()
  })

  it("flushes on the configured interval", () => {
    vi.useFakeTimers()
    const onFlush = vi.fn()
    const metrics = new ActivityMetrics(onFlush, { flushIntervalMs: 1_000 })

    metrics.record("event")
    vi.advanceTimersByTime(999)
    expect(onFlush).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1)
    expect(onFlush).toHaveBeenCalledOnce()
  })
})
