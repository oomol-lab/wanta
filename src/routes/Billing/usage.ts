import type { BillingPeriodDays, BillingSpendStats } from "../../../electron/chat/common.ts"

export type UsageCategory = "chat" | "image" | "other"

export interface CategorySummary {
  category: UsageCategory
  credit: number
  eventCount: number
}

export interface DailySpendBucket {
  key: string
  label: string
  credit: number
  estimated: boolean
}

export const categoryOrder: UsageCategory[] = ["chat", "image", "other"]

export function buildCategorySummaries(
  spend: BillingSpendStats | null | undefined,
  metering: BillingSpendStats | null | undefined,
): CategorySummary[] {
  const summaries = new Map<UsageCategory, CategorySummary>()
  for (const category of categoryOrder) {
    summaries.set(category, { category, credit: 0, eventCount: 0 })
  }
  const spendItems = spend?.items ?? []
  const meteringItems = metering?.items ?? []
  for (const item of spendItems) {
    const summary = summaries.get(usageCategory(item.source, item.subject))
    if (summary) {
      summary.credit += billingCredit(item)
    }
  }
  if (spendItems.length === 0) {
    const fallbackSpend = statsTotalCredit(spend)
    if (fallbackSpend > 0) {
      const summary = summaries.get("other")
      if (summary) {
        summary.credit += fallbackSpend
      }
    }
  }
  for (const item of meteringItems) {
    const summary = summaries.get(usageCategory(item.source, item.subject))
    if (summary) {
      summary.eventCount += billingEventCount(item)
    }
  }
  if (meteringItems.length === 0) {
    const fallbackEvents = statsTotalEvents(metering)
    if (fallbackEvents > 0) {
      const summary = summaries.get("other")
      if (summary) {
        summary.eventCount += fallbackEvents
      }
    }
  }
  return categoryOrder.map((category) => summaries.get(category) ?? { category, credit: 0, eventCount: 0 })
}

export function getSummary(summaries: CategorySummary[], category: UsageCategory): CategorySummary {
  return summaries.find((summary) => summary.category === category) ?? { category, credit: 0, eventCount: 0 }
}

export function buildDailySpendBuckets(
  items: BillingSpendStats["items"],
  period: BillingPeriodDays,
  fallbackTotalCredit = 0,
): DailySpendBucket[] {
  const today = startOfDay(Date.now())
  const buckets = Array.from({ length: period }, (_, index) => {
    const time = today - (period - index - 1) * 24 * 60 * 60 * 1000
    return { key: String(time), label: formatDate(time), credit: 0, estimated: false }
  })
  const byKey = new Map(buckets.map((bucket) => [bucket.key, bucket]))
  for (const item of items) {
    const timestamp = itemTimestamp(item)
    if (timestamp === null) {
      continue
    }
    const bucket = byKey.get(String(startOfDay(timestamp)))
    if (bucket) {
      bucket.credit += billingCredit(item)
    }
  }
  const bucketedTotal = buckets.reduce((sum, bucket) => sum + bucket.credit, 0)
  if (bucketedTotal <= 0 && fallbackTotalCredit > 0 && buckets.length > 0) {
    const averageCredit = fallbackTotalCredit / buckets.length
    for (const bucket of buckets) {
      bucket.credit = averageCredit
      bucket.estimated = true
    }
  }
  return buckets
}

export function usageCategory(source: string, subject: string): UsageCategory {
  const normalizedSource = source.toLowerCase()
  const normalizedSubject = subject.toLowerCase()
  if (source === "SERVICE_LLM" || normalizedSource.includes("llm")) {
    return "chat"
  }
  if (
    normalizedSource.includes("image") ||
    /\b(image|img|picture|photo|png|jpg|jpeg|flux|banana|gpt-image|stable-diffusion)\b/.test(normalizedSubject)
  ) {
    return "image"
  }
  return "other"
}

export function toNumber(value: string | number | undefined): number {
  const amount = Number(value)
  return Number.isFinite(amount) ? amount : 0
}

export function billingCredit(item: BillingSpendStats["items"][number]): number {
  return numberField(item, ["totalCredit", "debitCredit", "credit", "totalUsage", "usage"])
}

export function billingEventCount(item: BillingSpendStats["items"][number]): number {
  return numberField(item, ["eventCount", "totalEventCount", "count", "calls"])
}

export function statsTotalCredit(stats: BillingSpendStats | null | undefined): number {
  return numberField(stats?.total, ["totalCredit", "debitCredit", "credit", "totalUsage", "usage"])
}

export function statsTotalEvents(stats: BillingSpendStats | null | undefined): number {
  return numberField(stats?.total, ["eventCount", "totalEventCount", "count", "calls"])
}

export function normalizeTimestamp(timestamp: number): number {
  return timestamp > 0 && timestamp < 10_000_000_000 ? timestamp * 1000 : timestamp
}

export function formatCredit(value: number | string | undefined): string {
  const amount = toNumber(value)
  return `$${new Intl.NumberFormat(undefined, { maximumFractionDigits: amount >= 100 ? 0 : 2 }).format(amount)}`
}

export function formatPercent(value: number): string {
  return `${Math.round(value)}%`
}

export function formatDate(timestamp: number): string {
  return new Date(timestamp).toLocaleDateString(undefined, { month: "short", day: "numeric", timeZone: "UTC" })
}

export function formatDateTime(timestamp: number): string {
  return new Date(normalizeTimestamp(timestamp)).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  })
}

function numberField(value: unknown, keys: string[]): number {
  if (!value || typeof value !== "object") {
    return 0
  }
  const record = value as Record<string, unknown>
  for (const key of keys) {
    const amount = Number(record[key])
    if (Number.isFinite(amount)) {
      return amount
    }
  }
  return 0
}

function itemTimestamp(item: BillingSpendStats["items"][number]): number | null {
  const record = item as unknown as Record<string, unknown>
  const candidates = [
    record["time"],
    record["date"],
    record["createdAt"],
    record["timestamp"],
    record["startTime"],
    record["endTime"],
  ]
  for (const candidate of candidates) {
    const timestamp = parseTimestamp(candidate)
    if (timestamp !== null) {
      return timestamp
    }
  }
  return null
}

function parseTimestamp(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    if (value <= 0) {
      return null
    }
    return normalizeTimestamp(value)
  }
  if (typeof value !== "string" || !value.trim()) {
    return null
  }
  const numeric = Number(value)
  if (Number.isFinite(numeric)) {
    if (numeric <= 0) {
      return null
    }
    return normalizeTimestamp(numeric)
  }
  const parsed = Date.parse(value)
  return Number.isFinite(parsed) ? parsed : null
}

function startOfDay(value: number): number {
  const date = new Date(value)
  date.setUTCHours(0, 0, 0, 0)
  return date.getTime()
}
