import { describe, expect, it } from "vitest"
import { resolveChatError } from "./chat-error.ts"

describe("resolveChatError", () => {
  it("maps OOMOL insufficient credit errors to payment_required", () => {
    expect(resolveChatError("Payment Required: account is in deficit, code: OOMOL_INSUFFICIENT_CREDIT").kind).toBe(
      "payment_required",
    )
  })

  it("maps 402 and insufficient-credit variants to payment_required", () => {
    expect(resolveChatError("HTTP 402 insufficient credits").kind).toBe("payment_required")
    expect(resolveChatError('PAYMENT_REQUIRED: {"message":"not enough credits","status":"402"}').kind).toBe(
      "payment_required",
    )
    expect(resolveChatError("CHAT_COMPLETION_PAYMENT_REQUIRED: 当前账户余额不足").kind).toBe("payment_required")
  })

  it("maps common completion failures without treating them as payment errors", () => {
    expect(resolveChatError("CHAT_COMPLETION_TIMEOUT: Request timeout: chat.completion").kind).toBe("timeout")
    expect(resolveChatError("WebSocket connection failed").kind).toBe("connection_interrupted")
    expect(resolveChatError("Permission denied").kind).toBe("permission_denied")
  })
})
