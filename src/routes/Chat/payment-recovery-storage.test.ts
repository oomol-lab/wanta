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

function legacyPaymentKey(cacheScope: string, scope: BillingRequestScope): string {
  const requestScopeKey = {
    canManageFunding: scope.canManageFunding,
    organizationId: scope.teamId,
    organizationName: scope.teamName,
  }
  return `organization-payment-recovery-pending:${encodeURIComponent(JSON.stringify({ cacheScope, requestScopeKey }))}`
}

function teamScope(overrides: Partial<BillingRequestScope> = {}): BillingRequestScope {
  return {
    canManageBilling: true,
    canManageFunding: true,
    teamId: "team-1",
    teamName: "acme",
    ...overrides,
  }
}

describe("payment recovery storage", () => {
  it("includes the account cache scope and all team scope fields in the key", () => {
    const scope = teamScope()
    const key = paymentRecoveryPendingStorageKey("user-1:team:team-1", scope)

    expect(key).not.toBe(paymentRecoveryPendingStorageKey("user-2:team:team-1", scope))
    expect(key).not.toBe(
      paymentRecoveryPendingStorageKey(
        "user-1:team:team-1",
        teamScope({
          teamId: "team-2",
        }),
      ),
    )
    expect(key).not.toBe(
      paymentRecoveryPendingStorageKey(
        "user-1:team:team-1",
        teamScope({
          teamName: "beta",
        }),
      ),
    )
    expect(key).not.toBe(
      paymentRecoveryPendingStorageKey(
        "user-1:team:team-1",
        teamScope({
          canManageFunding: false,
        }),
      ),
    )
  })

  it("keeps markers isolated between billing scopes", () => {
    const storage = createStorage()
    const teamA = teamScope()
    const teamB = teamScope({ teamId: "team-2", teamName: "beta" })

    markPaymentRecoveryPending("user-1:team:team-1", teamA, storage, 1_000)

    expect(hasPaymentRecoveryPending("user-1:team:team-1", teamA, storage, 1_001)).toBe(true)
    expect(hasPaymentRecoveryPending("user-1:team:team-2", teamB, storage, 1_001)).toBe(false)
    clearPaymentRecoveryPending("user-1:team:team-2", teamB, storage)
    expect(hasPaymentRecoveryPending("user-1:team:team-1", teamA, storage, 1_001)).toBe(true)
  })

  it("removes only the expired marker for the requested scope", () => {
    const storage = createStorage()
    const scope = teamScope()
    const secondaryScope = {
      canManageBilling: true,
      canManageFunding: true,
      teamId: "team-id",
      teamName: "team-name",
    } as const

    markPaymentRecoveryPending("user-1:team:team-1", scope, storage, 1_000)
    markPaymentRecoveryPending("user-1:team:team-id", secondaryScope, storage, 2_000)

    expect(hasPaymentRecoveryPending("user-1:team:team-1", scope, storage, 86_401_001)).toBe(false)
    expect(hasPaymentRecoveryPending("user-1:team:team-id", secondaryScope, storage, 86_401_001)).toBe(true)
  })

  it("migrates legacy organization-scoped markers", () => {
    const values = new Map<string, string>()
    const storage: PaymentRecoveryStorage = {
      getItem: (key) => values.get(key) ?? null,
      removeItem: (key) => void values.delete(key),
      setItem: (key, value) => void values.set(key, value),
    }
    const scope = teamScope()
    const legacyKey = legacyPaymentKey("user-1:organization:team-1", scope)
    values.set(legacyKey, JSON.stringify({ expiresAt: 2_000 }))

    expect(hasPaymentRecoveryPending("user-1:team:team-1", scope, storage, 1_000)).toBe(true)
    expect(values.has(legacyKey)).toBe(false)
    expect(values.has(paymentRecoveryPendingStorageKey("user-1:team:team-1", scope))).toBe(true)
  })
})
