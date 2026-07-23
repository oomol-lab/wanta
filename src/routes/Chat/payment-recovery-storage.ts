import type { BillingRequestScope } from "@/lib/billing-client"

const paymentRecoveryPendingKeyPrefix = "team-payment-recovery-pending"
const paymentRecoveryPendingTtlMs = 24 * 60 * 60 * 1000

export interface PaymentRecoveryStorage {
  getItem(key: string): string | null
  removeItem(key: string): void
  setItem(key: string, value: string): void
}

export function paymentRecoveryPendingStorageKey(cacheScope: string, requestScope: BillingRequestScope): string {
  const requestScopeKey = {
    canManageFunding: requestScope.canManageFunding,
    canManageTeamSubscription: requestScope.canManageTeamSubscription,
    canReadTeamSubscription: requestScope.canReadTeamSubscription,
    teamId: requestScope.teamId,
    teamName: requestScope.teamName,
  }
  return `${paymentRecoveryPendingKeyPrefix}:${encodeURIComponent(JSON.stringify({ cacheScope, requestScopeKey }))}`
}

function previousTeamPaymentRecoveryPendingStorageKey(cacheScope: string, requestScope: BillingRequestScope): string {
  const requestScopeKey = {
    canManageFunding: requestScope.canManageFunding,
    teamId: requestScope.teamId,
    teamName: requestScope.teamName,
  }
  return `${paymentRecoveryPendingKeyPrefix}:${encodeURIComponent(JSON.stringify({ cacheScope, requestScopeKey }))}`
}

function legacyPaymentRecoveryPendingStorageKey(cacheScope: string, requestScope: BillingRequestScope): string {
  const requestScopeKey = {
    canManageFunding: requestScope.canManageFunding,
    teamId: requestScope.teamId,
    organizationName: requestScope.teamName,
  }
  const legacyCacheScope = cacheScope.replace(/(^|:)team:/, "$1organization:")
  return `${paymentRecoveryPendingKeyPrefix}:${encodeURIComponent(JSON.stringify({ cacheScope: legacyCacheScope, requestScopeKey }))}`
}

export function markPaymentRecoveryPending(
  cacheScope: string,
  requestScope: BillingRequestScope | null,
  storage: PaymentRecoveryStorage = localStorage,
  now = Date.now(),
): void {
  if (!requestScope) {
    return
  }
  try {
    storage.setItem(
      paymentRecoveryPendingStorageKey(cacheScope, requestScope),
      JSON.stringify({ expiresAt: now + paymentRecoveryPendingTtlMs }),
    )
  } catch {
    // localStorage 不可用时只跳过跨刷新恢复；当前弹窗仍可手动刷新余额。
  }
}

export function clearPaymentRecoveryPending(
  cacheScope: string,
  requestScope: BillingRequestScope | null,
  storage: PaymentRecoveryStorage = localStorage,
): void {
  if (!requestScope) {
    return
  }
  try {
    storage.removeItem(paymentRecoveryPendingStorageKey(cacheScope, requestScope))
    storage.removeItem(previousTeamPaymentRecoveryPendingStorageKey(cacheScope, requestScope))
    storage.removeItem(legacyPaymentRecoveryPendingStorageKey(cacheScope, requestScope))
  } catch {
    // 忽略存储不可用。
  }
}

export function hasPaymentRecoveryPending(
  cacheScope: string,
  requestScope: BillingRequestScope | null,
  storage: PaymentRecoveryStorage = localStorage,
  now = Date.now(),
): boolean {
  if (!requestScope) {
    return false
  }
  try {
    const scopedKey = paymentRecoveryPendingStorageKey(cacheScope, requestScope)
    const previousTeamKey = previousTeamPaymentRecoveryPendingStorageKey(cacheScope, requestScope)
    const legacyKey = legacyPaymentRecoveryPendingStorageKey(cacheScope, requestScope)
    const currentRaw = storage.getItem(scopedKey)
    const previousTeamRaw = storage.getItem(previousTeamKey)
    const legacyRaw = storage.getItem(legacyKey)
    const readExpiresAt = (raw: string | null): number | null => {
      if (!raw) {
        return null
      }
      try {
        const parsed = JSON.parse(raw) as { expiresAt?: unknown }
        return typeof parsed.expiresAt === "number" && Number.isFinite(parsed.expiresAt) ? parsed.expiresAt : null
      } catch {
        return null
      }
    }
    const currentExpiresAt = readExpiresAt(currentRaw)
    if (currentExpiresAt !== null && now <= currentExpiresAt) {
      if (previousTeamRaw !== null) {
        storage.removeItem(previousTeamKey)
      }
      if (legacyRaw !== null) {
        storage.removeItem(legacyKey)
      }
      return true
    }
    if (currentRaw !== null) {
      storage.removeItem(scopedKey)
    }
    for (const [fallbackKey, fallbackRaw] of [
      [previousTeamKey, previousTeamRaw],
      [legacyKey, legacyRaw],
    ] as const) {
      const fallbackExpiresAt = readExpiresAt(fallbackRaw)
      if (fallbackExpiresAt !== null && now <= fallbackExpiresAt && fallbackRaw !== null) {
        storage.setItem(scopedKey, fallbackRaw)
        storage.removeItem(previousTeamKey)
        storage.removeItem(legacyKey)
        return true
      }
      if (fallbackRaw !== null) {
        storage.removeItem(fallbackKey)
      }
    }
    return false
  } catch {
    return false
  }
}
