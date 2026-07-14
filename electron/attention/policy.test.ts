import { describe, expect, it } from "vitest"
import { isSessionActivelyViewed, shouldShowCompletionNotification } from "./policy.ts"

describe("completion notification policy", () => {
  it("shows background notifications only while the app is unfocused", () => {
    expect(shouldShowCompletionNotification("never", false)).toBe(false)
    expect(shouldShowCompletionNotification("background", true)).toBe(false)
    expect(shouldShowCompletionNotification("background", false)).toBe(true)
    expect(shouldShowCompletionNotification("always", true)).toBe(true)
  })

  it("requires the exact session to be visibly focused before treating it as read", () => {
    expect(
      isSessionActivelyViewed({
        rendererVisible: true,
        sessionId: "session-1",
        visibleSessionId: "session-1",
        windowFocused: true,
      }),
    ).toBe(true)
    expect(
      isSessionActivelyViewed({
        rendererVisible: true,
        sessionId: "session-2",
        visibleSessionId: "session-1",
        windowFocused: true,
      }),
    ).toBe(false)
    expect(
      isSessionActivelyViewed({
        rendererVisible: true,
        sessionId: "session-1",
        visibleSessionId: "session-1",
        windowFocused: false,
      }),
    ).toBe(false)
  })
})
