type RendererReportSource = "error" | "handled" | "unhandledrejection"

const handledReportWindowMs = 5 * 60_000
const maxHandledReportEntries = 200

const handledReportState = new Map<string, { lastSentAt: number; suppressedCount: number }>()

export function reportRendererHandledError(scope: string, message: string, cause: unknown): void {
  reportRendererIssue("handled", scope, message, cause)
}

export function reportRendererIssue(
  source: RendererReportSource,
  scope: string,
  message: string,
  cause: unknown,
): void {
  const normalized = normalizeRendererCause(cause)
  const dedupeKey = source === "handled" ? rendererHandledDedupeKey(source, scope, message, normalized.message) : null
  const suppressedCount = dedupeKey ? consumeSuppressedCount(dedupeKey) : 0
  if (dedupeKey && shouldSuppressHandledReport(dedupeKey)) {
    return
  }
  globalThis.wanta?.reportRendererError({
    source,
    scope,
    message: `${message}: ${normalized.message}`,
    ...(normalized.stack ? { stack: normalized.stack } : {}),
    ...(suppressedCount ? { suppressedCount } : {}),
  })
}

export function clearRendererDiagnosticRateLimitForTest(): void {
  handledReportState.clear()
}

function normalizeRendererCause(cause: unknown): { message: string; stack?: string } {
  if (cause instanceof Error) {
    return {
      message: cause.message || cause.name,
      ...(cause.stack ? { stack: cause.stack } : {}),
    }
  }
  if (cause && typeof cause === "object" && typeof (cause as { message?: unknown }).message === "string") {
    return {
      message: (cause as { message: string }).message,
      ...(typeof (cause as { stack?: unknown }).stack === "string"
        ? { stack: (cause as { stack: string }).stack }
        : {}),
    }
  }
  return { message: String(cause) }
}

function rendererHandledDedupeKey(
  source: RendererReportSource,
  scope: string,
  message: string,
  causeMessage: string,
): string {
  return `${source}\0${scope}\0${message}\0${causeMessage}`
}

function shouldSuppressHandledReport(key: string): boolean {
  const now = Date.now()
  const previous = handledReportState.get(key)
  if (previous && now - previous.lastSentAt < handledReportWindowMs) {
    previous.suppressedCount += 1
    return true
  }

  rememberHandledReport(key, {
    lastSentAt: now,
    suppressedCount: previous?.suppressedCount ?? 0,
  })
  return false
}

function consumeSuppressedCount(key: string): number {
  return handledReportState.get(key)?.suppressedCount ?? 0
}

function rememberHandledReport(key: string, state: { lastSentAt: number; suppressedCount: number }): void {
  handledReportState.delete(key)
  while (handledReportState.size >= maxHandledReportEntries) {
    const oldestKey = handledReportState.keys().next().value
    if (typeof oldestKey !== "string") {
      break
    }
    handledReportState.delete(oldestKey)
  }
  handledReportState.set(key, { ...state, suppressedCount: 0 })
}
