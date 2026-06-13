import type { ConnectionExecutionLogItem, ConnectionExecutionLogSummary } from "./common.ts"

interface ConnectorExecutionLogItemResponse {
  action?: unknown
  errorCode?: unknown
  executionId?: unknown
  finishedAt?: unknown
  service?: unknown
  startedAt?: unknown
  status?: unknown
}

interface ConnectorExecutionLogCollectionResponse {
  data?: unknown
  nextCursor?: unknown
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined
}

function readExecutionItems(value: unknown): unknown[] {
  if (Array.isArray(value)) {
    return value
  }

  if (!value || typeof value !== "object") {
    return []
  }

  const response = value as ConnectorExecutionLogCollectionResponse
  return Array.isArray(response.data) ? response.data : []
}

function readNextCursor(value: unknown): string | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined
  }

  return asString((value as ConnectorExecutionLogCollectionResponse).nextCursor)
}

function normalizeStatus(value: unknown): ConnectionExecutionLogItem["status"] | undefined {
  return value === "success" || value === "error" ? value : undefined
}

function calculateDurationMs(startedAt: string, finishedAt: string): number | null {
  const startedAtMs = Date.parse(startedAt)
  const finishedAtMs = Date.parse(finishedAt)

  if (!Number.isFinite(startedAtMs) || !Number.isFinite(finishedAtMs) || finishedAtMs < startedAtMs) {
    return null
  }

  return finishedAtMs - startedAtMs
}

export function normalizeConnectionExecutionLog(item: unknown): ConnectionExecutionLogItem | undefined {
  if (!item || typeof item !== "object" || Array.isArray(item)) {
    return undefined
  }

  const execution = item as ConnectorExecutionLogItemResponse
  const action = asString(execution.action)
  const finishedAt = asString(execution.finishedAt)
  const id = asString(execution.executionId)
  const service = asString(execution.service)
  const startedAt = asString(execution.startedAt)
  const status = normalizeStatus(execution.status)

  if (!action || !finishedAt || !id || !service || !startedAt || !status) {
    return undefined
  }

  const normalized: ConnectionExecutionLogItem = {
    action,
    durationMs: calculateDurationMs(startedAt, finishedAt),
    finishedAt,
    id,
    service,
    startedAt,
    status,
  }

  const errorCode = asString(execution.errorCode)
  if (errorCode) {
    normalized.errorCode = errorCode
  }

  return normalized
}

export function normalizeConnectionExecutionLogs(value: unknown): ConnectionExecutionLogSummary {
  return {
    items: readExecutionItems(value)
      .map(normalizeConnectionExecutionLog)
      .filter((item): item is ConnectionExecutionLogItem => Boolean(item)),
    nextCursor: readNextCursor(value),
  }
}
