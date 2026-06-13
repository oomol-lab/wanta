import type { EffectiveTheme, ThemeContextValue, ThemePreference } from "./theme-context.ts"

import * as React from "react"
import { isThemePreference, ThemeContext, themeStorageKey } from "./theme-context.ts"
import { useSettingsService } from "@/components/AppContext"

function readInitialPreference(): ThemePreference {
  const stored = localStorage.getItem(themeStorageKey)
  return isThemePreference(stored) ? stored : "system"
}

function getSystemTheme(): EffectiveTheme {
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light"
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const settingsService = useSettingsService()
  const [preference, setPreferenceState] = React.useState<ThemePreference>(readInitialPreference)
  const [systemTheme, setSystemTheme] = React.useState<EffectiveTheme>(getSystemTheme)

  React.useEffect(() => {
    const media = window.matchMedia("(prefers-color-scheme: dark)")
    const onChange = (): void => setSystemTheme(media.matches ? "dark" : "light")
    media.addEventListener("change", onChange)
    return () => media.removeEventListener("change", onChange)
  }, [])

  // 同步 Electron nativeTheme（窗口背景/原生控件随主题）。
  React.useEffect(() => {
    void settingsService.invoke("setThemeSource", preference).catch(() => {})
  }, [preference, settingsService])

  const effectiveTheme: EffectiveTheme = preference === "system" ? systemTheme : preference

  React.useEffect(() => {
    const root = document.documentElement
    root.classList.toggle("dark", effectiveTheme === "dark")
    root.dataset.theme = effectiveTheme
    root.style.colorScheme = effectiveTheme
  }, [effectiveTheme])

  const setPreference = React.useCallback((next: ThemePreference) => {
    setPreferenceState(next)
    localStorage.setItem(themeStorageKey, next)
  }, [])

  const value = React.useMemo<ThemeContextValue>(
    () => ({ preference, setPreference, effectiveTheme }),
    [preference, setPreference, effectiveTheme],
  )

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
}
