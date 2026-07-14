import type { CompletionNotificationCondition } from "../settings/common.ts"

export function shouldShowCompletionNotification(
  condition: CompletionNotificationCondition,
  windowFocused: boolean,
): boolean {
  if (condition === "never") return false
  return condition === "always" || !windowFocused
}

export function isSessionActivelyViewed(input: {
  sessionId: string
  visibleSessionId: string | null
  rendererVisible: boolean
  windowFocused: boolean
}): boolean {
  return (
    input.windowFocused &&
    input.rendererVisible &&
    input.visibleSessionId !== null &&
    input.visibleSessionId === input.sessionId
  )
}
