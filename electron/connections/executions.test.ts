import assert from "node:assert/strict"
import { test } from "vitest"
import { normalizeConnectionExecutionLogs } from "./executions.ts"

test("normalizeConnectionExecutionLogs keeps renderer-safe fields", () => {
  const summary = normalizeConnectionExecutionLogs({
    data: [
      {
        action: "send_email",
        errorCode: "rate_limited",
        executionId: "exec-1",
        finishedAt: "2026-06-01T00:00:02.000Z",
        service: "gmail",
        startedAt: "2026-06-01T00:00:00.000Z",
        status: "error",
        rawPayload: { secret: "hidden" },
      },
    ],
    nextCursor: "cursor-2",
  })

  assert.equal(summary.nextCursor, "cursor-2")
  assert.deepEqual(summary.items, [
    {
      action: "send_email",
      durationMs: 2000,
      errorCode: "rate_limited",
      finishedAt: "2026-06-01T00:00:02.000Z",
      id: "exec-1",
      service: "gmail",
      startedAt: "2026-06-01T00:00:00.000Z",
      status: "error",
    },
  ])
})

test("normalizeConnectionExecutionLogs rejects malformed rows", () => {
  const summary = normalizeConnectionExecutionLogs([{ executionId: "missing-fields" }])

  assert.deepEqual(summary.items, [])
})
