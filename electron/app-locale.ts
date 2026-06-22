export const APP_LOCALE_CHANNEL = "lumo:app-locale"

export type AppLocale = "zh-CN" | "en"

export function isAppLocale(value: unknown): value is AppLocale {
  return value === "zh-CN" || value === "en"
}

export function normalizeAppLocale(locale: string | null | undefined): AppLocale {
  return typeof locale === "string" && locale.toLowerCase().startsWith("zh") ? "zh-CN" : "en"
}
