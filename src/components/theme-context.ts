import * as React from "react"
import { storageKey } from "../../electron/branding.ts"

export type ThemePreference = "system" | "light" | "dark"
export type EffectiveTheme = "light" | "dark"

export const themeStorageKey = storageKey("theme")

export interface ThemeContextValue {
  preference: ThemePreference
  setPreference: (preference: ThemePreference) => void
  effectiveTheme: EffectiveTheme
}

export const ThemeContext = React.createContext<ThemeContextValue | null>(null)

export function isThemePreference(value: string | null): value is ThemePreference {
  return value === "system" || value === "light" || value === "dark"
}

export function useTheme(): ThemeContextValue {
  const ctx = React.useContext(ThemeContext)
  if (!ctx) {
    throw new Error("useTheme must be used within ThemeProvider")
  }
  return ctx
}
