import type { NotificationCapability, NotificationTestResult } from "../../../electron/attention/common.ts"
import type { MessageKey } from "../../i18n/i18n.ts"

export interface NotificationPresentation {
  descriptionKey: MessageKey
  recovery: boolean
  settingsLabelKey: MessageKey
  testLabelKey: MessageKey
}

/** 将跨平台能力与本次实测结果转换为不夸大系统授权的设置页文案。 */
export function notificationPresentation(
  capability: NotificationCapability | null,
  lastTestResult: NotificationTestResult | null,
): NotificationPresentation {
  if (!capability) {
    return {
      descriptionKey: "settings.notificationStatusLoading",
      recovery: false,
      settingsLabelKey: "settings.notificationOpenSystemSettings",
      testLabelKey: "settings.notificationTest",
    }
  }

  if (capability.status === "development-unavailable") {
    return {
      descriptionKey: "settings.notificationDevelopmentUnavailable",
      recovery: false,
      settingsLabelKey: "settings.notificationOpenMacSettings",
      testLabelKey: "settings.notificationTest",
    }
  }

  if (capability.status === "unsupported") {
    return {
      descriptionKey: "settings.notificationUnsupported",
      recovery: false,
      settingsLabelKey: notificationSettingsLabelKey(capability.platform),
      testLabelKey: "settings.notificationTest",
    }
  }

  switch (lastTestResult?.outcome) {
    case "shown":
      return {
        descriptionKey: "settings.notificationTestAcceptedDescription",
        recovery: false,
        settingsLabelKey: notificationSettingsLabelKey(capability.platform),
        testLabelKey: "settings.notificationRetest",
      }
    case "failed":
      return {
        descriptionKey: "settings.notificationTestFailedDescription",
        recovery: true,
        settingsLabelKey: notificationSettingsLabelKey(capability.platform),
        testLabelKey: "settings.notificationRetest",
      }
    case "timed-out":
      return {
        descriptionKey: "settings.notificationTestTimedOutDescription",
        recovery: true,
        settingsLabelKey: notificationSettingsLabelKey(capability.platform),
        testLabelKey: "settings.notificationRetest",
      }
    case "unsupported":
      return {
        descriptionKey: "settings.notificationUnsupported",
        recovery: false,
        settingsLabelKey: notificationSettingsLabelKey(capability.platform),
        testLabelKey: "settings.notificationTest",
      }
  }

  if (capability.platform === "darwin") {
    return {
      descriptionKey: "settings.notificationMacInitialDescription",
      recovery: false,
      settingsLabelKey: "settings.notificationOpenMacSettings",
      testLabelKey: "settings.notificationEnableAndTest",
    }
  }
  if (capability.platform === "win32") {
    return {
      descriptionKey: "settings.notificationWindowsInitialDescription",
      recovery: false,
      settingsLabelKey: "settings.notificationOpenWindowsSettings",
      testLabelKey: "settings.notificationTest",
    }
  }
  return {
    descriptionKey: "settings.notificationGenericInitialDescription",
    recovery: false,
    settingsLabelKey: "settings.notificationOpenSystemSettings",
    testLabelKey: "settings.notificationTest",
  }
}

function notificationSettingsLabelKey(platform: NotificationCapability["platform"]): MessageKey {
  if (platform === "darwin") return "settings.notificationOpenMacSettings"
  if (platform === "win32") return "settings.notificationOpenWindowsSettings"
  return "settings.notificationOpenSystemSettings"
}
