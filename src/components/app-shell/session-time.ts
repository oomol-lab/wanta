import type { Locale } from "@/i18n/i18n"

import { formatRelativeTime } from "@/i18n/format"
import { translate } from "@/i18n/i18n"

const SECOND_MS = 1000
const MINUTE_MS = 60 * SECOND_MS
const HOUR_MS = 60 * MINUTE_MS
const DAY_MS = 24 * HOUR_MS
const MONTH_MS = 30 * DAY_MS
const YEAR_MS = 365 * DAY_MS

export function formatSessionRelativeTime(updatedAt: number, now: number, locale: Locale): string {
  if (!Number.isFinite(updatedAt) || updatedAt <= 0 || !Number.isFinite(now)) {
    return ""
  }

  const elapsed = Math.max(0, now - updatedAt)
  if (elapsed < MINUTE_MS) {
    return translate(locale, "common.justNow")
  }
  const units = [
    [YEAR_MS, "year"],
    [MONTH_MS, "month"],
    [DAY_MS, "day"],
    [HOUR_MS, "hour"],
    [MINUTE_MS, "minute"],
  ] as const
  const [duration, unit] = units.find(([duration]) => elapsed >= duration) ?? units[units.length - 1]
  return formatRelativeTime(locale, -Math.floor(elapsed / duration), unit)
}

export function formatSessionAbsoluteTime(updatedAt: number, locale: Locale): string {
  if (!Number.isFinite(updatedAt) || updatedAt <= 0) {
    return ""
  }
  return new Date(updatedAt).toLocaleString(locale)
}
