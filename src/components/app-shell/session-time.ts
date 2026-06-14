import type { Locale } from "@/i18n/i18n"

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
    return locale === "zh-CN" ? "刚刚" : "now"
  }
  if (elapsed < HOUR_MS) {
    return formatRelativeUnit(Math.floor(elapsed / MINUTE_MS), "m", "分钟", locale)
  }
  if (elapsed < DAY_MS) {
    return formatRelativeUnit(Math.floor(elapsed / HOUR_MS), "h", "小时", locale)
  }
  if (elapsed < MONTH_MS) {
    return formatRelativeUnit(Math.floor(elapsed / DAY_MS), "d", "天", locale)
  }
  if (elapsed < YEAR_MS) {
    return formatRelativeUnit(Math.floor(elapsed / MONTH_MS), "mo", "个月", locale)
  }
  return formatRelativeUnit(Math.floor(elapsed / YEAR_MS), "y", "年", locale)
}

export function formatSessionAbsoluteTime(updatedAt: number): string {
  if (!Number.isFinite(updatedAt) || updatedAt <= 0) {
    return ""
  }
  return new Date(updatedAt).toLocaleString()
}

function formatRelativeUnit(value: number, enUnit: string, zhUnit: string, locale: Locale): string {
  return locale === "zh-CN" ? `${value}${zhUnit}前` : `${value}${enUnit} ago`
}
