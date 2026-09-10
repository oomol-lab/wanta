import type { AppLocale, LocalePreference } from "../../electron/app-locale.ts"

import * as React from "react"
import { isAppLocale, isLocalePreference, resolveSystemLocale } from "../../electron/app-locale.ts"
import { storageKey } from "../../electron/branding.ts"
import { messages } from "./app-messages.ts"
import { formatNumber } from "./format.ts"
import { pluralMessage } from "./plural-messages.ts"

export type Locale = AppLocale
export type { LocalePreference } from "../../electron/app-locale.ts"

export const defaultLocale: Locale = "en"
export const localeStorageKey = storageKey("locale")

export type MessageKey = keyof (typeof messages)["zh-CN"]
export type TranslateFn = (key: MessageKey, vars?: Record<string, string | number>) => string

export interface I18nContextValue {
  locale: Locale
  preference?: LocalePreference
  setLocale: (locale: LocalePreference) => void
  t: TranslateFn
}

export const I18nContext = React.createContext<I18nContextValue | null>(null)

export function isLocale(value: string | null): value is Locale {
  return isAppLocale(value)
}

export function detectLocalePreference(): LocalePreference {
  const override = (import.meta.env as Record<string, string | undefined>)["VITE_WANTA_LOCALE"]
  if (isLocalePreference(override)) return override
  try {
    const stored = globalThis.localStorage?.getItem(localeStorageKey)
    if (isLocalePreference(stored)) return stored
  } catch {
    /* Storage can be disabled in embedded browser contexts. */
  }
  return "system"
}

export function systemLocale(): Locale {
  return resolveSystemLocale(globalThis.navigator?.languages ?? [globalThis.navigator?.language ?? "en"])
}

export function detectInitialLocale(): Locale {
  const preference = detectLocalePreference()
  return preference === "system" ? systemLocale() : preference
}

export function translate(locale: Locale, key: MessageKey, vars?: Record<string, string | number>): string {
  return translateUnsafe(locale, key, vars)
}

export function translateUnsafe(locale: Locale, key: string, vars?: Record<string, string | number>): string {
  const localeMessages = (messages[locale] ?? messages[defaultLocale]) as Record<string, string>
  const fallbackMessages = messages[defaultLocale] as Record<string, string>
  let text: string = pluralMessage(locale, key, vars?.count) ?? localeMessages[key] ?? fallbackMessages[key] ?? key
  if (vars) {
    text = text.replace(
      /\{\{\s*([A-Za-z0-9_.-]+)\s*\}\}|\{\s*([A-Za-z0-9_.-]+)\s*\}/g,
      (match, doubleName, singleName) => {
        const name = (doubleName ?? singleName) as string
        if (!Object.hasOwn(vars, name)) return match
        const value = vars[name]
        return name === "count" && typeof value === "number" && Number.isFinite(value)
          ? formatNumber(value, locale)
          : String(value)
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
