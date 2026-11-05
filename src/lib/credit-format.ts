import { isLocale, translate } from "@/i18n/i18n"

export const DISPLAY_POINTS_PER_CREDIT = 200

export function formatPoints(value: number | string | undefined, locale = "en", useGrouping = true): string {
  const credit = Number(value ?? 0)
  const amount = (Number.isFinite(credit) ? credit : 0) * DISPLAY_POINTS_PER_CREDIT
  return new Intl.NumberFormat(locale, {
    useGrouping,
    ...(amount !== 0 && Math.abs(amount) < 0.00001 ? { maximumSignificantDigits: 2 } : { maximumFractionDigits: 6 }),
  }).format(amount)
}

export function formatCredit(value: number | string | undefined, locale = "en"): string {
  return translate(isLocale(locale) ? locale : "en", "billing.points", { amount: formatPoints(value, locale) })
}
