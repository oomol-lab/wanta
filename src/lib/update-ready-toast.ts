export type UpdateReadyToastDecision = "defer" | "ignore" | "show" | "suppress"

export function updateReadyToastDecision(input: {
  busy: boolean
  focused: boolean
  handled: boolean
  version: string | null
}): UpdateReadyToastDecision {
  if (!input.version || input.handled) return "ignore"
  if (!input.focused) return "suppress"
  if (input.busy) return "defer"
  return "show"
}
