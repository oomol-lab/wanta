type RendererReportSource = "error" | "handled" | "unhandledrejection"

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
  globalThis.wanta?.reportRendererError({
    source,
    scope,
    message: `${message}: ${normalized.message}`,
    ...(normalized.stack ? { stack: normalized.stack } : {}),
  })
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
