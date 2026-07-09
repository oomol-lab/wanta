import type {
  SubscriptionStatus,
  WantaPendingPaymentResult,
  WantaSubscriptionPlan,
} from "../../../electron/chat/common.ts"

import { defaultAccountsPerApp, getCurrentWantaPlan, wantaPlanCapacity } from "./plans.ts"

export type WantaSubscriptionAction =
  | "add_seats"
  | "choose_plan"
  | "continue_payment"
  | "manage_seats"
  | "upgrade_plan"
  | "view"

export interface WantaSubscriptionOverviewInput {
  canManage: boolean
  memberCount: number
  pendingPayment: WantaPendingPaymentResult | null
  sharedConnectorCount?: number
  subscription: SubscriptionStatus | null
}

export interface WantaSubscriptionOverview {
  accountsPerApp: number
  additionalSeats: number
  baseSeats: number | null
  canManage: boolean
  currentPlan: WantaSubscriptionPlan | null
  hasPendingPayment: boolean
  overCapacity: boolean
  pendingPaymentUrl: string
  recommendedAction: WantaSubscriptionAction
  remainingSeats: number | null
  seatCapacity: number | null
  sharedConnectorCount?: number
  shouldRecommendPro: boolean
  usedSeats: number
}

export function buildWantaSubscriptionOverview({
  canManage,
  memberCount,
  pendingPayment,
  sharedConnectorCount,
  subscription,
}: WantaSubscriptionOverviewInput): WantaSubscriptionOverview {
  const currentPlan = getCurrentWantaPlan(subscription)
  const planCapacity = currentPlan ? wantaPlanCapacity(currentPlan) : null
  const additionalSeats = currentPlan ? Math.max(0, Math.floor(subscription?.wanta?.additionalSeats ?? 0)) : 0
  const usedSeats = Math.max(1, Math.floor(memberCount))
  const seatCapacity = planCapacity ? planCapacity.members + additionalSeats : null
  const remainingSeats = seatCapacity === null ? null : Math.max(0, seatCapacity - usedSeats)
  const overCapacity = seatCapacity !== null && usedSeats > seatCapacity
  const pendingPaymentUrl = pendingPayment?.paymentURL?.trim() ?? ""
  const hasPendingPayment = Boolean(pendingPaymentUrl)
  const shouldRecommendPro =
    currentPlan === "wanta_plus" &&
    planCapacity !== null &&
    (overCapacity || usedSeats >= Math.ceil(planCapacity.members * 0.7))

  return {
    accountsPerApp: planCapacity?.accountsPerApp ?? defaultAccountsPerApp,
    additionalSeats,
    baseSeats: planCapacity?.members ?? null,
    canManage,
    currentPlan,
    hasPendingPayment,
    overCapacity,
    pendingPaymentUrl,
    recommendedAction: recommendWantaAction({
      canManage,
      currentPlan,
      hasPendingPayment,
      overCapacity,
      shouldRecommendPro,
    }),
    remainingSeats,
    seatCapacity,
    sharedConnectorCount,
    shouldRecommendPro,
    usedSeats,
  }
}

function recommendWantaAction({
  canManage,
  currentPlan,
  hasPendingPayment,
  overCapacity,
  shouldRecommendPro,
}: {
  canManage: boolean
  currentPlan: WantaSubscriptionPlan | null
  hasPendingPayment: boolean
  overCapacity: boolean
  shouldRecommendPro: boolean
}): WantaSubscriptionAction {
  if (!canManage) {
    return "view"
  }
  if (hasPendingPayment) {
    return "continue_payment"
  }
  if (!currentPlan) {
    return "choose_plan"
  }
  if (overCapacity) {
    return "add_seats"
  }
  if (shouldRecommendPro) {
    return "upgrade_plan"
  }
  return "manage_seats"
}
