import { describe, expect, it } from "vitest"
import { normalizeChatError } from "./error.ts"

describe("normalizeChatError", () => {
  it("classifies OOMOL insufficient credit errors as payment_required", () => {
    const error = normalizeChatError("Payment Required: account is in deficit, code: OOMOL_INSUFFICIENT_CREDIT")

    expect(error.kind).toBe("payment_required")
    expect(error.retryable).toBe(false)
  })

  it("preserves structured payment error codes", () => {
    const error = normalizeChatError("OOMOL_INSUFFICIENT_CREDIT: account is in deficit")

    expect(error).toMatchObject({
      kind: "payment_required",
      code: "OOMOL_INSUFFICIENT_CREDIT",
    })
  })

  it("classifies JSON 402 responses as payment_required", () => {
    const error = normalizeChatError('{"status":"402","code":"PAYMENT_REQUIRED","message":"not enough credits"}')

    expect(error).toMatchObject({
      kind: "payment_required",
      code: "PAYMENT_REQUIRED",
    })
  })

  it.each([
    "DataInspectionFailed: upstream rejected the prompt",
    "Input data may contain inappropriate content. (request id: request-1)",
    "data_inspection_failed: upstream rejected the prompt",
    '{"status":400,"code":"data_inspection_failed","message":"blocked"}',
  ])("classifies content safety inspection failures", (message) => {
    const error = normalizeChatError(message)

    expect(error).toMatchObject({
      kind: "content_filtered",
      retryable: false,
    })
    expect(error.diagnostics).toBe(message)
  })

  it.each([
    [429, "rate_limited", true],
    [401, "auth_required", false],
    [403, "permission_denied", false],
    [503, "provider_unavailable", true],
  ] as const)("classifies JSON %d responses by status", (status, kind, retryable) => {
    const error = normalizeChatError(JSON.stringify({ status, message: "upstream error" }))

    expect(error).toMatchObject({ kind, retryable })
  })

  it("keeps a local custom provider 401 separate from OOMOL session expiry", () => {
    expect(normalizeChatError('{"status":401,"message":"invalid api key"}', { runtimeMode: "local" })).toMatchObject({
      kind: "model_auth_required",
      retryable: false,
    })
    expect(normalizeChatError('{"status":401,"message":"session expired"}', { runtimeMode: "oomol" })).toMatchObject({
      kind: "auth_required",
      retryable: false,
    })
  })

  it("keeps unknown error display details separate from diagnostics", () => {
    const error = normalizeChatError("PROVIDER_FAILED: upstream failed")

    expect(error).toMatchObject({
      kind: "unknown",
      code: "PROVIDER_FAILED",
      diagnostics: "PROVIDER_FAILED: upstream failed",
      displayMessage: "upstream failed",
    })
  })
})
