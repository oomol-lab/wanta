import type { ConnectionUsageDailyPoint, ConnectionUsageServiceItem, ConnectionUsageSummary } from "./common.ts"

const usageSummaryDays = 7

interface ConnectorUsageDailyItemResponse {
  calls?: unknown
  date?: unknown
  errorCount?: unknown
  errors?: unknown
  successCount?: unknown
  totalCount?: unknown
}

interface ConnectorUsageServiceItemResponse {
  calls?: unknown
  errorCount?: unknown
  errors?: unknown
  service?: unknown
  successCount?: unknown
  totalCount?: unknown
  trend?: unknown
}

interface ConnectorUsageCollectionResponse {
  data?: unknown
  days?: unknown
  points?: unknown
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined
}

function asNonNegativeNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : undefined
}

function asPositiveInteger(value: unknown): number | undefined {
  return typeof value === "number" && Number.isInteger(value) && value > 0 ? value : undefined
}

function readUsageItems(value: unknown): unknown[] {
  if (Array.isArray(value)) {
    return value
  }

  if (!value || typeof value !== "object") {
    return []
  }

  const response = value as ConnectorUsageCollectionResponse
  return [
    ...(Array.isArray(response.data) ? response.data : []),
    ...(Array.isArray(response.points) ? response.points : []),
  ]
}

function readUsageDays(value: unknown): number {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return usageSummaryDays
  }

  return asPositiveInteger((value as ConnectorUsageCollectionResponse).days) ?? usageSummaryDays
}

function normalizeUsageDailyPoint(item: unknown): ConnectionUsageDailyPoint | undefined {
  if (!item || typeof item !== "object" || Array.isArray(item)) {
    return undefined
  }

  const usage = item as ConnectorUsageDailyItemResponse
  const date = asString(usage.date)
  if (!date) {
    return undefined
  }

  const calls = asNonNegativeNumber(usage.totalCount) ?? asNonNegativeNumber(usage.calls) ?? 0
  const errors = asNonNegativeNumber(usage.errorCount) ?? asNonNegativeNumber(usage.errors) ?? 0
  const success = asNonNegativeNumber(usage.successCount) ?? Math.max(calls - errors, 0)

  return { calls, date, errors, success }
}

function normalizeUsageService(item: unknown): ConnectionUsageServiceItem | undefined {
  if (!item || typeof item !== "object" || Array.isArray(item)) {
    return undefined
  }

  const usage = item as ConnectorUsageServiceItemResponse
  const service = asString(usage.service)
  if (!service) {
    return undefined
  }

  const calls = asNonNegativeNumber(usage.totalCount) ?? asNonNegativeNumber(usage.calls) ?? 0
  const errors = asNonNegativeNumber(usage.errorCount) ?? asNonNegativeNumber(usage.errors) ?? 0
  const success = asNonNegativeNumber(usage.successCount) ?? Math.max(calls - errors, 0)
  const trend = readUsageItems(usage.trend)
    .map(normalizeUsageDailyPoint)
    .filter((point): point is ConnectionUsageDailyPoint => Boolean(point))
    .sort((left, right) => left.date.localeCompare(right.date))

  return {
    calls,
    errors,
    recent: trend.findLast((point) => point.calls > 0) ?? null,
    service,
    success,
    trend,
  }
}

export function normalizeUsageSummary(daily: unknown, services: unknown): ConnectionUsageSummary {
  const pointsByDate = new Map<string, ConnectionUsageDailyPoint>()

  for (const item of readUsageItems(daily)) {
    const point = normalizeUsageDailyPoint(item)
    if (!point) {
      continue
    }

    const current = pointsByDate.get(point.date)
    pointsByDate.set(point.date, {
      calls: (current?.calls ?? 0) + point.calls,
      date: point.date,
      errors: (current?.errors ?? 0) + point.errors,
      success: (current?.success ?? 0) + point.success,
    })
  }

  const points = Array.from(pointsByDate.values()).sort((left, right) => left.date.localeCompare(right.date))
  const normalizedServices = readUsageItems(services)
    .map(normalizeUsageService)
    .filter((item): item is ConnectionUsageServiceItem => Boolean(item))
    .sort((left, right) => {
      const recentDateCompare = (right.recent?.date ?? "").localeCompare(left.recent?.date ?? "")
      return recentDateCompare || right.calls - left.calls || left.service.localeCompare(right.service)
    })

  return {
    calls: points.reduce((count, item) => count + item.calls, 0),
    days: readUsageDays(daily),
    errors: points.reduce((count, item) => count + item.errors, 0),
    points,
    recent: points.findLast((point) => point.calls > 0) ?? null,
    services: normalizedServices,
    success: points.reduce((count, item) => count + item.success, 0),
  }
}
