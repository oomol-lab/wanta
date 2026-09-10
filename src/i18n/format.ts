import type { Locale } from "./i18n.ts"

const relativeFormatters = new Map<Locale, Intl.RelativeTimeFormat>()
export function formatRelativeTime(locale: Locale, value: number, unit: Intl.RelativeTimeFormatUnit): string {
  let formatter = relativeFormatters.get(locale)
  if (!formatter) {
    formatter = new Intl.RelativeTimeFormat(locale, { numeric: "always", style: "narrow" })
    relativeFormatters.set(locale, formatter)
  }
  return formatter.format(value, unit)
}

export function formatNumber(value: number, locale: Locale, options?: Intl.NumberFormatOptions): string {
  return new Intl.NumberFormat(locale, options).format(value)
}

/** Select a grammatical count form; callers must supply an “other” fallback. */
export function formatPlural(
  locale: Locale,
  count: number,
  forms: Partial<Record<Intl.LDMLPluralRule, string>> & { other: string },
): string {
  const category = new Intl.PluralRules(locale).select(count)
  return (forms[category] ?? forms.other).replaceAll("{count}", formatNumber(count, locale))
}
