import { describe, expect, it } from "vitest"
import { normalizeRendererErrorReport, redactDiagnosticText } from "./renderer-error-report.ts"

describe("renderer error report normalization", () => {
  it("downgrades handled renderer reports to warn", () => {
    expect(
      normalizeRendererErrorReport({
        message: "Background refresh failed",
        source: "handled",
        scope: "resource",
      }),
    ).toMatchObject({
      level: "warn",
      message: "Background refresh failed",
      scope: "resource",
      source: "handled",
    })
  })

  it("keeps unhandled renderer failures at error level", () => {
    expect(
      normalizeRendererErrorReport({
        message: "render crashed",
        source: "unhandledrejection",
      }),
    ).toMatchObject({
      level: "error",
      source: "unhandledrejection",
    })
  })

  it("redacts URL query strings and sensitive key-value fields", () => {
    expect(
      redactDiagnosticText(
        "GET https://console.oomol.com/launcher?authID=abc&token=def#step token=secret, api_key=hidden",
      ),
    ).toBe("GET https://console.oomol.com/launcher?[redacted]#[redacted] token=[redacted], api_key=[redacted]")
  })

  it("redacts quoted sensitive values that contain spaces", () => {
    expect(
      redactDiagnosticText(
        "authorization=\"Bearer multi word token\", password='two words', cookie=session value with spaces",
      ),
    ).toBe("authorization=[redacted], password=[redacted], cookie=[redacted]")
  })

  it("normalizes suppressed counts from rate-limited renderer reports", () => {
    expect(
      normalizeRendererErrorReport({
        message: "theme source sync failed",
        source: "handled",
        suppressedCount: 3,
      }),
    ).toMatchObject({
      suppressedCount: 3,
    })
  })
})
