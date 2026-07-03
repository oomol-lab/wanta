import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import {
  clearRendererDiagnosticRateLimitForTest,
  reportRendererHandledError,
  reportRendererIssue,
} from "./renderer-diagnostics.ts"

describe("renderer diagnostics", () => {
  const reportRendererError = vi.fn()

  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(1_000)
    clearRendererDiagnosticRateLimitForTest()
    Object.assign(globalThis, {
      wanta: {
        reportRendererError,
      },
    })
  })

  afterEach(() => {
    vi.useRealTimers()
    reportRendererError.mockReset()
    clearRendererDiagnosticRateLimitForTest()
    delete (globalThis as { wanta?: unknown }).wanta
  })

  it("rate-limits repeated handled reports and carries the suppressed count on the next report", () => {
    reportRendererHandledError("resource", "resource auto-load failed", new Error("HTTP 503"))
    reportRendererHandledError("resource", "resource auto-load failed", new Error("HTTP 503"))
    reportRendererHandledError("resource", "resource auto-load failed", new Error("HTTP 503"))

    expect(reportRendererError).toHaveBeenCalledTimes(1)
    expect(reportRendererError).toHaveBeenLastCalledWith({
      message: "resource auto-load failed: HTTP 503",
      scope: "resource",
      source: "handled",
      stack: expect.any(String),
    })

    vi.setSystemTime(1_000 + 5 * 60_000)
    reportRendererHandledError("resource", "resource auto-load failed", new Error("HTTP 503"))

    expect(reportRendererError).toHaveBeenCalledTimes(2)
    expect(reportRendererError).toHaveBeenLastCalledWith({
      message: "resource auto-load failed: HTTP 503",
      scope: "resource",
      source: "handled",
      stack: expect.any(String),
      suppressedCount: 2,
    })
  })

  it("does not rate-limit unhandled renderer errors", () => {
    reportRendererIssue("error", "react", "render error caught by boundary", new Error("boom"))
    reportRendererIssue("error", "react", "render error caught by boundary", new Error("boom"))

    expect(reportRendererError).toHaveBeenCalledTimes(2)
  })
})
