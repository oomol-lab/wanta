import assert from "node:assert/strict"
import { test } from "vitest"
import { isAbortErrorMessage, UserStopTracker } from "./user-stop-tracker.ts"

test("isAbortErrorMessage recognizes controlled stop errors only", () => {
  assert.equal(isAbortErrorMessage("Aborted"), true)
  assert.equal(isAbortErrorMessage("AbortError"), true)
  assert.equal(isAbortErrorMessage("AbortError: The operation was aborted."), true)
  assert.equal(isAbortErrorMessage("The operation was aborted."), true)
  assert.equal(isAbortErrorMessage("Task failed"), false)
  assert.equal(isAbortErrorMessage("Remote service cancelled the request"), false)
})

test("UserStopTracker only consumes abort-shaped failures for marked sessions", () => {
  const tracker = new UserStopTracker()
  tracker.mark("session-1")

  assert.equal(tracker.consumeAbort("session-1", "Task failed"), false)
  assert.equal(tracker.consumeAbort("session-2", "Aborted"), false)
  assert.equal(tracker.consumeAbort("session-1", "Aborted"), true)

  tracker.delete("session-1")
  assert.equal(tracker.consumeAbort("session-1", "Aborted"), false)
})
