import assert from "node:assert/strict"
import { afterEach, test, vi } from "vitest"
import { AgentRefreshScheduler } from "./agent-refresh-scheduler.ts"

afterEach(() => {
  vi.useRealTimers()
})

test("runtime refresh remains pending instead of interrupting a long generation", async () => {
  vi.useFakeTimers()
  let busy = true
  const refresh = vi.fn(async () => undefined)
  const scheduler = new AgentRefreshScheduler({
    canRefresh: () => true,
    isBusy: () => busy,
    isQuitting: () => false,
    refresh,
  })

  scheduler.schedule("skills changed", 0)
  await vi.advanceTimersByTimeAsync(60_000)
  assert.equal(refresh.mock.calls.length, 0)

  busy = false
  await vi.advanceTimersByTimeAsync(2_000)
  assert.equal(refresh.mock.calls.length, 1)
  scheduler.dispose()
})
