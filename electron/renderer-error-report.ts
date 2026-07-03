type RendererReportSource = "error" | "handled" | "unhandledrejection"
type RendererDiagnosticLevel = "warn" | "error"

export interface NormalizedRendererErrorReport {
  level: RendererDiagnosticLevel
  message: string
  scope?: string
  source: RendererReportSource
  stack?: string
  suppressedCount?: number
}

const sensitiveFieldPattern =
  /\b(authID|authId|token|api[_-]?key|authorization|password|secret|cookie|sessionToken)\s*[:=]\s*(?:"[^"]*"|'[^']*'|[^,&)}\r\n]+)/gi
const urlPattern = /\b(?:https?|wanta|wanta-local):\/\/[^\s"'<>]+/gi

export function normalizeRendererErrorReport(input: unknown): NormalizedRendererErrorReport | null {
  if (!input || typeof input !== "object") {
    return null
  }
  const record = input as Record<string, unknown>
  const message = typeof record["message"] === "string" ? redactDiagnosticText(record["message"]).trim() : ""
  if (!message) {
    return null
  }
  const source = normalizeRendererReportSource(record["source"])
  const scope = typeof record["scope"] === "string" ? redactDiagnosticText(record["scope"]).trim().slice(0, 200) : ""
  const stack = typeof record["stack"] === "string" ? redactDiagnosticText(record["stack"]).trim().slice(0, 16_000) : ""
  const suppressedCount = normalizeSuppressedCount(record["suppressedCount"])

  return {
    level: source === "handled" ? "warn" : "error",
    message: message.slice(0, 4_000),
    ...(scope ? { scope } : {}),
    source,
    ...(stack ? { stack } : {}),
    ...(suppressedCount ? { suppressedCount } : {}),
  }
}

export function redactDiagnosticText(value: string): string {
  return value.replace(urlPattern, redactUrl).replace(sensitiveFieldPattern, (_match, key: string) => {
    return `${key}=[redacted]`
  })
}

function normalizeRendererReportSource(value: unknown): RendererReportSource {
  return value === "handled" || value === "unhandledrejection" ? value : "error"
}

function normalizeSuppressedCount(value: unknown): number | undefined {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value <= 0) {
    return undefined
  }
  return Math.min(value, 10_000)
}

function redactUrl(rawUrl: string): string {
  try {
    const url = new URL(rawUrl)
    const prefix = url.host ? `${url.protocol}//${url.host}${url.pathname}` : `${url.protocol}${url.pathname}`
    return `${prefix}${url.search ? "?[redacted]" : ""}${url.hash ? "#[redacted]" : ""}`
  } catch {
    return rawUrl.replace(/[?#].*$/, (suffix) => (suffix.startsWith("?") ? "?[redacted]" : "#[redacted]"))
  }
}
