import * as React from "react"
import { storageKey } from "../../electron/branding.ts"
import { messages } from "./app-messages.ts"

export type Locale = "zh-CN" | "en"

export const defaultLocale: Locale = "zh-CN"
export const localeStorageKey = storageKey("locale")

export type MessageKey = keyof (typeof messages)["zh-CN"]
export type TranslateFn = (key: MessageKey, vars?: Record<string, string | number>) => string

export interface I18nContextValue {
  locale: Locale
  setLocale: (locale: Locale) => void
  t: TranslateFn
}

export const I18nContext = React.createContext<I18nContextValue | null>(null)

export function isLocale(value: string | null): value is Locale {
  return value === "zh-CN" || value === "en"
}

export function detectInitialLocale(): Locale {
  // dev/screenshot 旁路（生产无此 env，无害）。
  const override = (import.meta.env as Record<string, string | undefined>)["VITE_WANTA_LOCALE"]
  if (isLocale(override ?? null)) {
    return override as Locale
  }
  const stored = globalThis.localStorage?.getItem(localeStorageKey)
  if (isLocale(stored)) {
    return stored
  }
  return globalThis.navigator?.language?.startsWith("zh") ? "zh-CN" : "en"
}

export function translate(locale: Locale, key: MessageKey, vars?: Record<string, string | number>): string {
  return translateUnsafe(locale, key, vars)
}

export function translateUnsafe(locale: Locale, key: string, vars?: Record<string, string | number>): string {
  const localeMessages = messages[locale] as Record<string, string>
  const fallbackMessages = messages[defaultLocale] as Record<string, string>
  let text: string = localeMessages[key] ?? fallbackMessages[key] ?? key
  if (vars) {
    text = text.replace(
      /\{\{\s*([A-Za-z0-9_.-]+)\s*\}\}|\{\s*([A-Za-z0-9_.-]+)\s*\}/g,
      (match, doubleName, singleName) => {
        const name = (doubleName ?? singleName) as string
        return Object.hasOwn(vars, name) ? String(vars[name]) : match
      },
    )
  }
  return text
}

export function useI18n(): I18nContextValue {
  const ctx = React.useContext(I18nContext)
  if (!ctx) {
    throw new Error("useI18n must be used within I18nProvider")
  }
  return ctx
}

export function useT(): TranslateFn {
  return useI18n().t
}

export function useAppI18n(): I18nContextValue {
  return useI18n()
}
