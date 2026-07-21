import type { ServiceName } from "@oomol/connection"

import { serviceName } from "../branding.ts"

export type ThemeSource = "system" | "light" | "dark"
export type CompletionNotificationCondition = "never" | "background" | "always"
export type OperatingMode = "oomol" | "self-managed" | "unselected"

export interface AppSettings {
  completionNotificationCondition: CompletionNotificationCondition
  themeSource: ThemeSource
  knowledgeBaseBetaEnabled: boolean
  notificationSoundEnabled: boolean
  operatingMode: OperatingMode | null
  selfManagedSetupDismissed: boolean
  unreadBadgeEnabled: boolean
}

/** 对齐 Codex：仅后台完成通知，通知声音与应用图标未读红标默认开启。 */
export const DEFAULT_APP_SETTINGS: AppSettings = {
  completionNotificationCondition: "background",
  knowledgeBaseBetaEnabled: false,
  notificationSoundEnabled: true,
  operatingMode: null,
  selfManagedSetupDismissed: false,
  themeSource: "system",
  unreadBadgeEnabled: true,
}

export type SettingsService = typeof SettingsService
export const SettingsService = serviceName("settings-service") as ServiceName<{
  ServerEvents: {
    settingsChanged: AppSettings
  }
  ClientInvokes: {
    getSettings(): Promise<AppSettings>
    /** 同步 Electron nativeTheme.themeSource。 */
    setThemeSource(source: ThemeSource): Promise<void>
    setKnowledgeBaseBetaEnabled(enabled: boolean): Promise<void>
    setCompletionNotificationCondition(condition: CompletionNotificationCondition): Promise<void>
    setNotificationSoundEnabled(enabled: boolean): Promise<void>
    setOperatingMode(mode: OperatingMode): Promise<void>
    setSelfManagedSetupDismissed(dismissed: boolean): Promise<void>
    setUnreadBadgeEnabled(enabled: boolean): Promise<void>
  }
}>
