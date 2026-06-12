import type { ServiceName } from "@oomol/connection"

import { serviceName } from "../branding.ts"

export type ThemeSource = "system" | "light" | "dark"

export interface AppSettings {
  themeSource: ThemeSource
}

export type SettingsService = typeof SettingsService
export const SettingsService = serviceName("settings-service") as ServiceName<{
  ServerEvents: Record<never, never>
  ClientInvokes: {
    /** 同步 Electron nativeTheme.themeSource。 */
    setThemeSource(source: ThemeSource): Promise<void>
  }
}>
