export const APP_LOCALE_CHANNEL = "wanta:app-locale"
export const APP_LOCALE_PREFERENCE_CHANNEL = "wanta:app-locale-preference"

/** Shared by the renderer, native UI and per-turn language policy. */
export const appLocales = {
  en: { label: "English", language: "English", format: "en-US" },
  "zh-CN": { label: "简体中文", language: "Simplified Chinese", format: "zh-CN" },
  "zh-TW": { label: "繁體中文", language: "Traditional Chinese", format: "zh-TW" },
  ja: { label: "日本語", language: "Japanese", format: "ja-JP" },
  ko: { label: "한국어", language: "Korean", format: "ko-KR" },
  ru: { label: "Русский", language: "Russian", format: "ru-RU" },
  fr: { label: "Français", language: "French", format: "fr-FR" },
  es: { label: "Español", language: "Spanish", format: "es-ES" },
} as const

export type AppLocale = keyof typeof appLocales
export type LocalePreference = AppLocale | "system"
export const supportedAppLocales = Object.keys(appLocales) as AppLocale[]

export function isAppLocale(value: unknown): value is AppLocale {
  return typeof value === "string" && Object.hasOwn(appLocales, value)
}

export function isLocalePreference(value: unknown): value is LocalePreference {
  return value === "system" || isAppLocale(value)
}

export function matchAppLocale(locale: string | null | undefined): AppLocale | undefined {
  if (!locale) return undefined
  const parts = locale.toLowerCase().replaceAll("_", "-").split("-")
  if (parts[0] === "zh") {
    if (parts.includes("hant")) return "zh-TW"
    if (parts.includes("hans")) return "zh-CN"
    return parts.some((part) => ["tw", "hk", "mo"].includes(part)) ? "zh-TW" : "zh-CN"
  }
  return isAppLocale(parts[0]) ? parts[0] : undefined
}

export function normalizeAppLocale(locale: string | null | undefined): AppLocale {
  return matchAppLocale(locale) ?? "en"
}

export function resolveSystemLocale(languages: readonly string[]): AppLocale {
  for (const language of languages) {
    const match = matchAppLocale(language)
    if (match) return match
  }
  return "en"
}
