import type { BillingOverviewResult } from "../../electron/chat/common.ts"

import assert from "node:assert/strict"
import { afterEach, test, vi } from "vitest"
import {
  BillingOverviewRequestSupersededError,
  clearBillingOverviewCache,
  getBillingOverviewCacheEntry,
  loadBillingOverviewEntry,
  startBillingOverviewRequest,
} from "./useBillingOverview.ts"

afterEach(() => {
  clearBillingOverviewCache()
  vi.useRealTimers()
})

function emptyBillingOverview(): BillingOverviewResult {
  return {
    balance: null,
    metering: null,
    spend: null,
    subscription: null,
    subscriptionAvailable: true,
    usageSubscription: null,
    usageSubscriptionAvailable: true,
    teamPendingPayment: null,
    teamPendingPaymentAvailable: true,
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

test("normal billing refreshes share the current in-flight request", async () => {
  const pending = Promise.resolve(emptyBillingOverview())
  const entry = { data: null, loadedAt: 0, promise: null }
  let calls = 0
  const request = () => {
    calls += 1
    return pending
  }

  const first = loadBillingOverviewEntry(entry, request)
  const second = loadBillingOverviewEntry(entry, request)

  assert.equal(second, first)
  assert.equal(calls, 1)
  await first
})

test("forced billing refresh supersedes an older in-flight snapshot", async () => {
  let resolveStale!: (value: BillingOverviewResult) => void
  let resolveFresh!: (value: BillingOverviewResult) => void
  const staleData = emptyBillingOverview()
  const freshData = { ...emptyBillingOverview(), usageSubscriptionAvailable: false }
  const stale = new Promise<BillingOverviewResult>((resolve) => {
    resolveStale = resolve
  })
  const fresh = new Promise<BillingOverviewResult>((resolve) => {
    resolveFresh = resolve
  })
  const entry = { data: null, loadedAt: 0, promise: null }

  const staleRequest = loadBillingOverviewEntry(entry, () => stale)
  const staleResult = staleRequest.catch((error: unknown) => error)
  const freshRequest = loadBillingOverviewEntry(entry, () => fresh, { force: true })

  assert.notEqual(freshRequest, staleRequest)
  resolveFresh(freshData)
  await freshRequest
  assert.equal(entry.data, freshData)

  resolveStale(staleData)
  assert.ok((await staleResult) instanceof BillingOverviewRequestSupersededError)
  assert.equal(entry.data, freshData)
})

test("clearing billing cache detaches old account data and in-flight writes", async () => {
  let resolveStale!: (value: BillingOverviewResult) => void
  const staleData = emptyBillingOverview()
  const oldEntry = getBillingOverviewCacheEntry("account-old", 30)
  oldEntry.data = staleData
  oldEntry.loadedAt = Date.now()
  const staleRequest = loadBillingOverviewEntry(
    oldEntry,
    () =>
      new Promise<BillingOverviewResult>((resolve) => {
        resolveStale = resolve
      }),
    { force: true },
  )
  const staleResult = staleRequest.catch((error: unknown) => error)

  clearBillingOverviewCache()
  const nextEntry = getBillingOverviewCacheEntry("account-old", 30)

  assert.notEqual(nextEntry, oldEntry)
  assert.equal(nextEntry.data, null)
  resolveStale(staleData)
  assert.match(String(await staleResult), /cache was cleared/)
  assert.equal(nextEntry.data, null)
})
