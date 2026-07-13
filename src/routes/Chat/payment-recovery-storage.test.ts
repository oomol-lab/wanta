import type { PaymentRecoveryStorage } from "./payment-recovery-storage.ts"
import type { BillingRequestScope } from "@/lib/billing-client"

import { describe, expect, it } from "vitest"
import {
  clearPaymentRecoveryPending,
  hasPaymentRecoveryPending,
  markPaymentRecoveryPending,
  paymentRecoveryPendingStorageKey,
} from "./payment-recovery-storage.ts"

function createStorage(): PaymentRecoveryStorage {
  const values = new Map<string, string>()
  return {
    getItem: (key) => values.get(key) ?? null,
    removeItem: (key) => void values.delete(key),
    setItem: (key, value) => void values.set(key, value),
  }
}

function organizationScope(overrides: Partial<Extract<BillingRequestScope, { type: "organization" }>> = {}) {
  return {
    canManageBilling: true,
    organizationId: "team-1",
    organizationName: "acme",
    type: "organization" as const,
    ...overrides,
  }
}

describe("payment recovery storage", () => {
  it("includes the account cache scope and all organization scope fields in the key", () => {
    const scope = organizationScope()
    const key = paymentRecoveryPendingStorageKey("user-1:organization:team-1", scope)

    expect(key).not.toBe(paymentRecoveryPendingStorageKey("user-2:organization:team-1", scope))
    expect(key).not.toBe(
      paymentRecoveryPendingStorageKey(
        "user-1:organization:team-1",
        organizationScope({
          canManageBilling: false,
        }),
      ),
    )
    expect(key).not.toBe(
      paymentRecoveryPendingStorageKey(
        "user-1:organization:team-1",
        organizationScope({
          organizationId: "team-2",
        }),
      ),
    )
    expect(key).not.toBe(
      paymentRecoveryPendingStorageKey(
        "user-1:organization:team-1",
        organizationScope({
          organizationName: "beta",
        }),
      ),
    )
  })

  it("keeps markers isolated between billing scopes", () => {
    const storage = createStorage()
    const teamA = organizationScope()
    const teamB = organizationScope({ organizationId: "team-2", organizationName: "beta" })

    markPaymentRecoveryPending("user-1:organization:team-1", teamA, storage, 1_000)

    expect(hasPaymentRecoveryPending("user-1:organization:team-1", teamA, storage, 1_001)).toBe(true)
    expect(hasPaymentRecoveryPending("user-1:organization:team-2", teamB, storage, 1_001)).toBe(false)
    clearPaymentRecoveryPending("user-1:organization:team-2", teamB, storage)
    expect(hasPaymentRecoveryPending("user-1:organization:team-1", teamA, storage, 1_001)).toBe(true)
  })

  it("removes only the expired marker for the requested scope", () => {
    const storage = createStorage()
    const scope = organizationScope()
    const personalScope = { type: "personal" } as const

    markPaymentRecoveryPending("user-1:organization:team-1", scope, storage, 1_000)
    markPaymentRecoveryPending("user-1:personal", personalScope, storage, 2_000)

    expect(hasPaymentRecoveryPending("user-1:organization:team-1", scope, storage, 86_401_001)).toBe(false)
    expect(hasPaymentRecoveryPending("user-1:personal", personalScope, storage, 86_401_001)).toBe(true)
  })
})
