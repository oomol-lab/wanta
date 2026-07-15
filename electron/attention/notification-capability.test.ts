import { describe, expect, it } from "vitest"
import {
  notificationCapability,
  openFirstAvailableSystemSettingsUrl,
  systemNotificationSettingsUrls,
} from "./notification-capability.ts"

describe("notificationCapability", () => {
  it("marks unsigned macOS development notifications as unavailable", () => {
    expect(notificationCapability({ isPackaged: false, platform: "darwin", supported: true })).toEqual({
      canOpenSystemSettings: true,
      platform: "darwin",
      status: "development-unavailable",
    })
  })

  it("marks packaged and non-macOS supported notifications as testable without claiming authorization", () => {
    expect(notificationCapability({ isPackaged: true, platform: "darwin", supported: true })).toEqual({
      canOpenSystemSettings: true,
      platform: "darwin",
      status: "testable",
    })
    expect(notificationCapability({ isPackaged: false, platform: "win32", supported: true })).toEqual({
      canOpenSystemSettings: true,
      platform: "win32",
      status: "testable",
    })
  })

  it("reports unsupported platforms without claiming delivery permission", () => {
    expect(notificationCapability({ isPackaged: true, platform: "linux", supported: false })).toEqual({
      canOpenSystemSettings: false,
      platform: "other",
      status: "unsupported",
    })
  })
})

describe("systemNotificationSettingsUrls", () => {
  it("targets the current macOS app before falling back to the notifications list", () => {
    expect(systemNotificationSettingsUrls("darwin", "com.oomol.wanta local")).toEqual([
      "x-apple.systempreferences:com.apple.Notifications-Settings.extension?id=com.oomol.wanta%20local",
      "x-apple.systempreferences:com.apple.Notifications-Settings.extension",
    ])
  })

  it("uses the documented Windows notifications page without inventing a per-app parameter", () => {
    expect(systemNotificationSettingsUrls("win32", "com.oomol.wanta")).toEqual(["ms-settings:notifications"])
    expect(systemNotificationSettingsUrls("linux", "com.oomol.wanta")).toEqual([])
  })
})

describe("openFirstAvailableSystemSettingsUrl", () => {
  it("falls back when the app-specific settings URL is rejected", async () => {
    const opened: string[] = []
    await openFirstAvailableSystemSettingsUrl(["specific", "general"], (url) => {
      opened.push(url)
      return url === "specific" ? Promise.reject(new Error("unsupported deep link")) : Promise.resolve()
    })
    expect(opened).toEqual(["specific", "general"])
  })

  it("surfaces the final failure and rejects platforms without a settings URL", async () => {
    await expect(
      openFirstAvailableSystemSettingsUrl(["specific", "general"], (url) => Promise.reject(new Error(url))),
    ).rejects.toThrow("general")
    await expect(openFirstAvailableSystemSettingsUrl([], () => Promise.resolve())).rejects.toThrow(
      "not available on this platform",
    )
  })
})
