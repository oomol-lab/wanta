import { describe, expect, it } from "vitest"
import { DEFAULT_APP_SETTINGS } from "./common.ts"

describe("DEFAULT_APP_SETTINGS", () => {
  it("matches the Codex task completion notification defaults", () => {
    expect(DEFAULT_APP_SETTINGS).toMatchObject({
      completionNotificationCondition: "background",
      notificationSoundEnabled: true,
      unreadBadgeEnabled: true,
    })
  })
})
