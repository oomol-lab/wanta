import { describe, expect, it } from "vitest"
import { nextUpdateReminderTime, shouldOpenUpdateReminder, updateReminderSnoozeMs } from "./update-reminder.ts"

describe("update reminder policy", () => {
  it("opens only for a ready update while the app is focused and the agent is idle", () => {
    const base = { focused: true, now: 1_000, snoozedUntil: null, version: "1.2.3" }
    expect(shouldOpenUpdateReminder({ ...base, busy: false })).toBe(true)
    expect(shouldOpenUpdateReminder({ ...base, busy: true })).toBe(false)
    expect(shouldOpenUpdateReminder({ ...base, busy: false, focused: false })).toBe(false)
    expect(shouldOpenUpdateReminder({ ...base, busy: false, version: null })).toBe(false)
  })

  it("reopens after the four hour snooze expires", () => {
    const now = 10_000
    const snoozedUntil = nextUpdateReminderTime(now)
    expect(snoozedUntil).toBe(now + updateReminderSnoozeMs)
    expect(
      shouldOpenUpdateReminder({ busy: false, focused: true, now: snoozedUntil - 1, snoozedUntil, version: "1.2.3" }),
    ).toBe(false)
    expect(
      shouldOpenUpdateReminder({ busy: false, focused: true, now: snoozedUntil, snoozedUntil, version: "1.2.3" }),
    ).toBe(true)
  })
})
