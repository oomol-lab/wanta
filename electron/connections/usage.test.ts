import assert from "node:assert/strict"
import { test } from "vitest"
import { normalizeUsageSummary } from "./usage.ts"

test("normalizeUsageSummary reads connector wrapped usage responses", () => {
  const summary = normalizeUsageSummary(
    {
      days: 7,
      data: [
        { date: "2026-06-01", totalCount: 2, successCount: 1, errorCount: 1 },
        { date: "2026-06-01", calls: 3, errors: 1 },
        { date: "2026-06-02", calls: 4, successCount: 4 },
      ],
    },
    {
      data: [
        {
          service: "gmail",
          totalCount: 5,
          successCount: 4,
          errorCount: 1,
          trend: [{ date: "2026-06-02", calls: 5, errors: 1 }],
        },
      ],
    },
  )

  assert.equal(summary.days, 7)
  assert.equal(summary.calls, 9)
  assert.equal(summary.success, 7)
  assert.equal(summary.errors, 2)
  assert.equal(summary.recent?.date, "2026-06-02")
  assert.equal(summary.services[0]?.service, "gmail")
})

test("normalizeUsageSummary orders providers by recent call date before volume", () => {
  const summary = normalizeUsageSummary(
    [],
    [
      { service: "older", calls: 100, trend: [{ date: "2026-06-01", calls: 100 }] },
      { service: "newer", calls: 1, trend: [{ date: "2026-06-02", calls: 1 }] },
    ],
  )

  assert.deepEqual(
    summary.services.map((item) => item.service),
    ["newer", "older"],
  )
})
