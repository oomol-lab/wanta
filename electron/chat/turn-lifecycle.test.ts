import assert from "node:assert/strict"
import { test } from "vitest"
import {
  generationNoticeKindForInactivity,
  inactivityWatchdogActionForEvent,
  terminalConnectionInterruption,
} from "./turn-lifecycle.ts"

test("inactivity watchdog pauses for user-blocking runtime requests", () => {
  assert.equal(inactivityWatchdogActionForEvent("questionAsked"), "pause")
  assert.equal(inactivityWatchdogActionForEvent("permissionAsked"), "pause")
  assert.equal(inactivityWatchdogActionForEvent("messageDelta"), "schedule")
  assert.equal(inactivityWatchdogActionForEvent("toolCallStarted"), "schedule")
})

test("generation inactivity becomes a notice instead of a terminal decision", () => {
  assert.equal(generationNoticeKindForInactivity({ activeToolCount: 0, blocked: false }), "generation_stale")
  assert.equal(generationNoticeKindForInactivity({ activeToolCount: 1, blocked: false }), "tool_running_without_output")
  assert.equal(generationNoticeKindForInactivity({ activeToolCount: 1, blocked: true }), null)
})

test("terminal connection states map to explicit interruption reasons", () => {
  assert.deepEqual(terminalConnectionInterruption({ status: "failed", attempt: 5, maxAttempts: 5 }), {
    message: "CHAT_COMPLETION_INTERRUPTED: OpenCode event stream reconnection failed.",
    reason: "connection_failed",
  })
  assert.equal(terminalConnectionInterruption({ status: "reconnecting", attempt: 1, maxAttempts: 5 }), null)
  assert.equal(terminalConnectionInterruption({ status: "runtime_restarting", attempt: 1, maxAttempts: 5 }), null)
  assert.equal(
    terminalConnectionInterruption({ status: "runtime_recovered", attempt: 1, maxAttempts: 5 })?.reason,
    "runtime_restarted",
  )
  assert.equal(
    terminalConnectionInterruption({ status: "runtime_failed", attempt: 5, maxAttempts: 5 })?.reason,
    "runtime_failed",
  )
})
