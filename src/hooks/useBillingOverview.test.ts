import type { BillingOverviewResult } from "../../electron/chat/common.ts"

import assert from "node:assert/strict"
import { afterEach, test, vi } from "vitest"
import { startBillingOverviewRequest } from "./useBillingOverview.ts"

afterEach(() => {
  vi.useRealTimers()
})

function emptyBillingOverview(): BillingOverviewResult {
  return {
    balance: null,
    metering: null,
    spend: null,
  }
}

test("billing overview in-flight cache is released after a renderer-side timeout", async () => {
  vi.useFakeTimers()
  const entry = { data: null, loadedAt: 0, promise: null }
  const stuck = startBillingOverviewRequest(entry, () => new Promise<BillingOverviewResult>(() => undefined), 10)

  await vi.advanceTimersByTimeAsync(10)

  await assert.rejects(stuck, /Billing overview request timed out/)
  assert.equal(entry.promise, null)

  const nextData = emptyBillingOverview()
  const next = await startBillingOverviewRequest(entry, async () => nextData, 10)

  assert.equal(next, nextData)
  assert.equal(entry.data, nextData)
  assert.equal(entry.promise, null)
})
