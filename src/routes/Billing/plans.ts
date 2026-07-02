import type { SubscriptionStatus, WantaSubscriptionPlan } from "../../../electron/chat/common.ts"

export interface WantaPlanLimits {
  accountsPerApp: number
  auditLogKey:
    | "billing.planComparison.freeAudit"
    | "billing.planComparison.plusAudit"
    | "billing.planComparison.proAudit"
  creditsKey:
    | "billing.planComparison.freeCredits"
    | "billing.planComparison.plusCredits"
    | "billing.planComparison.proCredits"
  members: number
  rateLimitKey:
    | "billing.planComparison.freeRateLimit"
    | "billing.planComparison.plusRateLimit"
    | "billing.planComparison.proRateLimit"
  reportKey:
    | "billing.planComparison.freeReport"
    | "billing.planComparison.plusReport"
    | "billing.planComparison.proReport"
}

export const freePlanLimits: WantaPlanLimits = {
  accountsPerApp: 1,
  auditLogKey: "billing.planComparison.freeAudit",
  creditsKey: "billing.planComparison.freeCredits",
  members: 3,
  rateLimitKey: "billing.planComparison.freeRateLimit",
  reportKey: "billing.planComparison.freeReport",
}

export const wantaPlanLimits: Record<WantaSubscriptionPlan, WantaPlanLimits> = {
  wanta_plus: {
    accountsPerApp: 3,
    auditLogKey: "billing.planComparison.plusAudit",
    creditsKey: "billing.planComparison.plusCredits",
    members: 10,
    rateLimitKey: "billing.planComparison.plusRateLimit",
    reportKey: "billing.planComparison.plusReport",
  },
  wanta_pro: {
    accountsPerApp: 10,
    auditLogKey: "billing.planComparison.proAudit",
    creditsKey: "billing.planComparison.proCredits",
    members: 30,
    rateLimitKey: "billing.planComparison.proRateLimit",
    reportKey: "billing.planComparison.proReport",
  },
}

export function getSubscriptionMarkers(status: SubscriptionStatus | null): string[] {
  if (!status) {
    return []
  }
  return Array.from(
    new Set([
      ...status.plans,
      ...(status.plan ? [status.plan] : []),
      ...(status.features ?? []),
      ...(status.platforms.stripe ?? []),
      ...(status.platforms.app_store ?? []),
    ]),
  )
}

export function isWantaSubscriptionPlan(plan: string): plan is WantaSubscriptionPlan {
  return plan === "wanta_plus" || plan === "wanta_pro"
}

export function getCurrentWantaPlan(status: SubscriptionStatus | null): WantaSubscriptionPlan | null {
  return getSubscriptionMarkers(status).find(isWantaSubscriptionPlan) ?? null
}

export function hasAnyWantaSubscription(status: SubscriptionStatus | null): boolean {
  return getSubscriptionMarkers(status).some((plan) => plan.toLowerCase().startsWith("wanta"))
}

export function wantaPlanCapacity(plan: WantaSubscriptionPlan | null): WantaPlanLimits {
  return plan ? wantaPlanLimits[plan] : freePlanLimits
}

export function shouldRecommendPro({
  currentPlan,
  memberCount,
  totalEvents,
}: {
  currentPlan: WantaSubscriptionPlan | null
  memberCount: number
  totalEvents: number
}): boolean {
  if (currentPlan === "wanta_pro") {
    return false
  }
  if (!currentPlan) {
    return true
  }
  return memberCount >= Math.ceil(wantaPlanLimits.wanta_plus.members * 0.7) || totalEvents >= 10_000
}
