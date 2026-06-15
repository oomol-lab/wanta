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
