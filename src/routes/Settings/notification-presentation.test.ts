import type { NotificationCapability } from "../../../electron/attention/common.ts"

import { describe, expect, it } from "vitest"
import { notificationPresentation } from "./notification-presentation.ts"

function capability(
  platform: NotificationCapability["platform"],
  status: NotificationCapability["status"] = "testable",
): NotificationCapability {
  return {
    canOpenSystemSettings: platform === "darwin" || platform === "win32",
    platform,
    status,
  }
}

describe("notificationPresentation", () => {
  it("uses a neutral loading state before capability detection completes", () => {
    expect(notificationPresentation(null, null)).toEqual({
      descriptionKey: "settings.notificationStatusLoading",
      recovery: false,
      settingsLabelKey: "settings.notificationOpenSystemSettings",
      testLabelKey: "settings.notificationTest",
    })
  })

  it("uses an explicit contextual enable action for an unverified macOS installation", () => {
    expect(notificationPresentation(capability("darwin"), null)).toEqual({
      descriptionKey: "settings.notificationMacInitialDescription",
      recovery: false,
      settingsLabelKey: "settings.notificationOpenMacSettings",
      testLabelKey: "settings.notificationEnableAndTest",
    })
  })

  it("describes Windows as a delivery check instead of a permission request", () => {
    expect(notificationPresentation(capability("win32"), null)).toEqual({
      descriptionKey: "settings.notificationWindowsInitialDescription",
      recovery: false,
      settingsLabelKey: "settings.notificationOpenWindowsSettings",
      testLabelKey: "settings.notificationTest",
    })
  })

  it("promotes system settings only after a failed or unconfirmed test", () => {
    expect(notificationPresentation(capability("darwin"), { outcome: "failed" }).recovery).toBe(true)
    expect(notificationPresentation(capability("win32"), { outcome: "timed-out" }).recovery).toBe(true)
    expect(notificationPresentation(capability("darwin"), { outcome: "accepted" }).recovery).toBe(true)
    expect(notificationPresentation(capability("darwin"), { outcome: "delivered" }).recovery).toBe(false)
    expect(notificationPresentation(capability("win32"), { outcome: "accepted" }).recovery).toBe(false)
  })

  it("distinguishes confirmed macOS delivery from native request acceptance", () => {
    expect(notificationPresentation(capability("darwin"), { outcome: "delivered" }).descriptionKey).toBe(
      "settings.notificationTestDeliveredDescription",
    )
    expect(notificationPresentation(capability("darwin"), { outcome: "accepted" }).descriptionKey).toBe(
      "settings.notificationTestUnconfirmedDescription",
    )
    expect(notificationPresentation(capability("win32"), { outcome: "accepted" }).descriptionKey).toBe(
      "settings.notificationTestAcceptedDescription",
    )
  })

  it("does not offer an authorization-like action in unsupported or unsigned development environments", () => {
    expect(notificationPresentation(capability("darwin", "development-unavailable"), null).descriptionKey).toBe(
      "settings.notificationDevelopmentUnavailable",
    )
    expect(notificationPresentation(capability("other", "unsupported"), null).descriptionKey).toBe(
      "settings.notificationUnsupported",
    )
  })

  it("uses the unsupported result even when the platform capability is otherwise testable", () => {
    expect(notificationPresentation(capability("win32"), { outcome: "unsupported" })).toEqual({
      descriptionKey: "settings.notificationUnsupported",
      recovery: false,
      settingsLabelKey: "settings.notificationOpenWindowsSettings",
      testLabelKey: "settings.notificationTest",
    })
  })

  it("uses generic initial copy for other supported platforms", () => {
    expect(notificationPresentation(capability("other"), null)).toEqual({
      descriptionKey: "settings.notificationGenericInitialDescription",
      recovery: false,
      settingsLabelKey: "settings.notificationOpenSystemSettings",
      testLabelKey: "settings.notificationTest",
    })
  })
})
