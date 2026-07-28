import { describe, expect, it } from "vitest"
import { isSessionActivelyViewed, shouldShowCompletionNotification, unreadTeamIds } from "./policy.ts"

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

  it("summarizes unread teams without duplicating or inventing local scope", () => {
    expect(
      unreadTeamIds([
        { createdAt: 1, runId: "run-local" },
        { createdAt: 2, runId: "run-1", teamId: "team-1" },
        { createdAt: 3, runId: "run-2", teamId: "team-1" },
        { createdAt: 4, runId: "run-3", teamId: " team-2 " },
      ]),
    ).toEqual(["team-1", "team-2"])
  })
})
