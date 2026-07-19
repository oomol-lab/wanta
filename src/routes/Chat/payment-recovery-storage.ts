import type { BillingRequestScope } from "@/lib/billing-client"

const paymentRecoveryPendingKeyPrefix = "team-payment-recovery-pending"
const legacyPaymentRecoveryPendingKeyPrefix = "organization-payment-recovery-pending"
const paymentRecoveryPendingTtlMs = 24 * 60 * 60 * 1000

export interface PaymentRecoveryStorage {
  getItem(key: string): string | null
  removeItem(key: string): void
  setItem(key: string, value: string): void
}

export function paymentRecoveryPendingStorageKey(cacheScope: string, requestScope: BillingRequestScope): string {
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
    organizationId: requestScope.teamId,
    organizationName: requestScope.teamName,
  }
  const legacyCacheScope = cacheScope.replace(/(^|:)team:/, "$1organization:")
  return `${legacyPaymentRecoveryPendingKeyPrefix}:${encodeURIComponent(JSON.stringify({ cacheScope: legacyCacheScope, requestScopeKey }))}`
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
    const legacyKey = legacyPaymentRecoveryPendingStorageKey(cacheScope, requestScope)
    const currentRaw = storage.getItem(scopedKey)
    const legacyRaw = currentRaw === null ? storage.getItem(legacyKey) : null
    const raw = currentRaw ?? legacyRaw
    if (!raw) {
      return false
    }
    const parsed = JSON.parse(raw) as { expiresAt?: unknown }
    const expiresAt = typeof parsed.expiresAt === "number" ? parsed.expiresAt : 0
    if (now <= expiresAt) {
      if (legacyRaw !== null) {
        storage.setItem(scopedKey, raw)
        storage.removeItem(legacyKey)
      }
      return true
    }
    storage.removeItem(legacyRaw !== null ? legacyKey : scopedKey)
    return false
  } catch {
    return false
  }
}
