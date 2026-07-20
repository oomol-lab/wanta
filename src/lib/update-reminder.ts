export const updateReminderSnoozeMs = 4 * 60 * 60 * 1_000

export function shouldOpenUpdateReminder(input: {
  busy: boolean
  focused: boolean
  now: number
  snoozedUntil: number | null
  version: string | null
}): boolean {
  return Boolean(
    input.version && !input.busy && input.focused && (input.snoozedUntil === null || input.snoozedUntil <= input.now),
  )
}

export function nextUpdateReminderTime(now: number): number {
  return now + updateReminderSnoozeMs
}
