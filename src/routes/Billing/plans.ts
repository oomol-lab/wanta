import type { SubscriptionStatus, WantaSubscriptionPlan } from "../../../electron/chat/common.ts"

export interface WantaPlanLimits {
  accountsPerApp: number
  members: number
}

export const defaultAccountsPerApp = 1

export const wantaPlanLimits: Record<WantaSubscriptionPlan, WantaPlanLimits> = {
  wanta_plus: {
    accountsPerApp: 3,
    members: 10,
  },
  wanta_pro: {
    accountsPerApp: 10,
    members: 30,
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

export function wantaPlanCapacity(plan: WantaSubscriptionPlan): WantaPlanLimits {
  return wantaPlanLimits[plan]
}
