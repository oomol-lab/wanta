import type { SubscriptionPlanTag, SubscriptionStatus, TeamSubscriptionPlan } from "../../../electron/chat/common.ts"

export interface TeamPlanLimits {
  accountsPerApp: number
  members: number
}

export const defaultAccountsPerApp = 1

export const teamPlanLimits: Record<TeamSubscriptionPlan, TeamPlanLimits> = {
  team_plus: {
    accountsPerApp: 3,
    members: 10,
  },
  team_pro: {
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

export function isTeamSubscriptionPlan(plan: string): plan is TeamSubscriptionPlan {
  return plan === "team_plus" || plan === "team_pro"
}

export function getCurrentTeamPlan(status: SubscriptionStatus | null): TeamSubscriptionPlan | null {
  if (status?.plan && isTeamSubscriptionPlan(status.plan)) {
    return status.plan
  }
  return getSubscriptionMarkers(status).find(isTeamSubscriptionPlan) ?? null
}

export function isUsageSubscriptionPlan(plan: string): plan is SubscriptionPlanTag {
  return plan === "ai_pro" || plan === "ai_max"
}

export function getCurrentUsageSubscription(status: SubscriptionStatus | null): SubscriptionPlanTag | null {
  if (status?.plan && isUsageSubscriptionPlan(status.plan)) {
    return status.plan
  }
  return getSubscriptionMarkers(status).find(isUsageSubscriptionPlan) ?? null
}

export function teamPlanCapacity(plan: TeamSubscriptionPlan): TeamPlanLimits {
  return teamPlanLimits[plan]
}
