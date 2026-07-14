import type { ServiceName } from "@oomol/connection"

import { serviceName } from "../branding.ts"

export type ThemeSource = "system" | "light" | "dark"

export interface AppSettings {
  themeSource: ThemeSource
  knowledgeBaseBetaEnabled: boolean
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
  }
}>
