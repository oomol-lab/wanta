import assert from "node:assert/strict"
import { afterEach, test, vi } from "vitest"
import { GenerationRegistry } from "./generation-registry.ts"

afterEach(() => vi.useRealTimers())

test("starting a new generation aborts and replaces the previous generation", () => {
  const registry = new GenerationRegistry()
  const first = registry.begin("session-1").generation
  const second = registry.begin("session-1")

  assert.equal(first.controller.signal.aborted, true)
  assert.equal(second.previous?.id, first.id)
  assert.equal(registry.get("session-1")?.id, second.generation.id)
})

test("late generation cleanup cannot remove a replacement generation", () => {
  const registry = new GenerationRegistry()
  const first = registry.begin("session-1").generation
  const second = registry.begin("session-1").generation

  assert.equal(registry.clear("session-1", first.id), undefined)
  assert.equal(registry.get("session-1")?.id, second.id)
})

test("watchdogs only fire while their generation remains current", () => {
  vi.useFakeTimers()
  const registry = new GenerationRegistry()
  const timedOut = vi.fn()
  const first = registry.begin("session-1").generation
  registry.scheduleAcknowledgementWatchdog("session-1", first.id, 100, timedOut)
  registry.begin("session-1")

  vi.advanceTimersByTime(100)
  assert.equal(timedOut.mock.calls.length, 0)
})
