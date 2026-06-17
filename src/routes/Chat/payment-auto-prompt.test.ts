import type { PaymentAutoPromptState } from "./payment-auto-prompt.ts"

import { describe, expect, it } from "vitest"
import { canAutoPromptPayment } from "./payment-auto-prompt.ts"

const baseState: PaymentAutoPromptState = {
  autoOpenKey: "message-error-APIError",
  balanceChecked: true,
  hasCredits: false,
  isPaymentRequired: true,
  recovered: false,
}

describe("canAutoPromptPayment", () => {
  it("waits for the balance check before prompting", () => {
    expect(canAutoPromptPayment({ ...baseState, balanceChecked: false })).toBe(false)
  })

  it("does not prompt when the account has recovered credits", () => {
    expect(canAutoPromptPayment({ ...baseState, hasCredits: true })).toBe(false)
    expect(canAutoPromptPayment({ ...baseState, recovered: true })).toBe(false)
  })

  it("prompts only for unresolved payment errors without credits", () => {
    expect(canAutoPromptPayment(baseState)).toBe(true)
    expect(canAutoPromptPayment({ ...baseState, hasCredits: null })).toBe(false)
    expect(canAutoPromptPayment({ ...baseState, isPaymentRequired: false })).toBe(false)
    expect(canAutoPromptPayment({ ...baseState, autoOpenKey: undefined })).toBe(false)
  })
})
