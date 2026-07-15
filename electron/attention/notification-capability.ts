import type { NotificationCapability } from "./common.ts"

export function notificationCapability(input: {
  isPackaged: boolean
  platform: NodeJS.Platform
  supported: boolean
}): NotificationCapability {
  const platform = notificationCapabilityPlatform(input.platform)
  const canOpenSystemSettings = input.platform === "darwin" || input.platform === "win32"
  if (!input.supported) {
    return { canOpenSystemSettings, platform, status: "unsupported" }
  }
  if (input.platform === "darwin" && !input.isPackaged) {
    return { canOpenSystemSettings, platform, status: "development-unavailable" }
  }
  return { canOpenSystemSettings, platform, status: "testable" }
}

function notificationCapabilityPlatform(platform: NodeJS.Platform): NotificationCapability["platform"] {
  if (platform === "darwin" || platform === "win32") return platform
  return "other"
}

export function systemNotificationSettingsUrls(platform: NodeJS.Platform, appBundleId: string): string[] {
  switch (platform) {
    case "darwin": {
      const notificationsPane = "x-apple.systempreferences:com.apple.Notifications-Settings.extension"
      return [`${notificationsPane}?id=${encodeURIComponent(appBundleId)}`, notificationsPane]
    }
    case "win32":
      // Windows 没有公开的单应用通知设置 URI，使用官方通知总页面。
      return ["ms-settings:notifications"]
    default:
      return []
  }
}

/** 按顺序尝试系统设置深链；用于 macOS 指定应用入口失败时回退通知总页面。 */
export async function openFirstAvailableSystemSettingsUrl(
  urls: string[],
  open: (url: string) => Promise<void>,
): Promise<void> {
  if (urls.length === 0) {
    throw new Error("System notification settings are not available on this platform.")
  }
  let lastError: unknown
  for (const url of urls) {
    try {
      await open(url)
      return
    } catch (error) {
      lastError = error
    }
  }
  throw lastError instanceof Error ? lastError : new Error("Unable to open system notification settings.")
}
