import type {
  SubscriptionStatus,
  WantaPendingPaymentResult,
  WantaSubscriptionChangePayload,
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

export interface WantaPendingPaymentTargetsInput {
  currentAdditionalSeats: number
  currentPlan: WantaSubscriptionPlan | null
  pendingPayment: WantaPendingPaymentResult | null
}

export interface WantaPendingPaymentTargets {
  additionalSeats: number | null
  paymentUrl: string
  plan: WantaSubscriptionPlan | null
}

export interface WantaSubscriptionActionDisabledInput {
  canManage: boolean
  isSessionExpired: boolean
  isSubmitting: boolean
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
  const additionalSeats = Math.max(0, Math.floor(subscription?.wanta?.additionalSeats ?? 0))
  const usedSeats = Math.max(1, Math.floor(memberCount))
  const seatCapacity = planCapacity
    ? planCapacity.members + additionalSeats
    : additionalSeats > 0
      ? additionalSeats
      : null
  const remainingSeats = seatCapacity === null ? null : Math.max(0, seatCapacity - usedSeats)
  const overCapacity = seatCapacity !== null && usedSeats > seatCapacity
  const pendingPaymentUrl = pendingPayment?.paymentURL?.trim() ?? ""
  const hasPendingPayment = Boolean(pendingPaymentUrl)
  const shouldRecommendPro =
    currentPlan === "wanta_plus" &&
    seatCapacity !== null &&
    (overCapacity || usedSeats >= Math.ceil(seatCapacity * 0.7))

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

export function resolveWantaPendingPaymentTargets({
  currentAdditionalSeats,
  currentPlan,
  pendingPayment,
}: WantaPendingPaymentTargetsInput): WantaPendingPaymentTargets {
  if (!pendingPayment) {
    return { additionalSeats: null, paymentUrl: "", plan: null }
  }

  const paymentUrl = pendingPayment.paymentURL?.trim() ?? ""
  if (!paymentUrl) {
    return { additionalSeats: null, paymentUrl: "", plan: null }
  }

  const pendingPlan = pendingPayment.plan
  const pendingAdditionalSeats = Math.max(0, Math.floor(pendingPayment.additionalSeats))
  const additionalSeats =
    pendingAdditionalSeats !== currentAdditionalSeats && (pendingPlan === null || pendingPlan === currentPlan)
      ? pendingAdditionalSeats
      : null
  const plan = additionalSeats === null ? (pendingPlan ?? currentPlan) : null
  return { additionalSeats, paymentUrl, plan }
}

/**
 * 账单概览只是页面展示数据，不能作为创建或继续结账的前置条件：概览接口失败、超时或仍在加载时，
 * 用户仍应能通过计划接口创建支付链接。真正的鉴权由该接口处理，已过期会话才禁用操作。
 */
export function isWantaSubscriptionActionDisabled({
  canManage,
  isSessionExpired,
  isSubmitting,
}: WantaSubscriptionActionDisabledInput): boolean {
  return !canManage || isSessionExpired || isSubmitting
}

/** Wanta 计划变更必须带上目标席位数，与 console 的订阅预览/提交契约保持一致。 */
export function buildWantaPlanChange(
  plan: WantaSubscriptionPlan | null,
  additionalSeats: number,
): WantaSubscriptionChangePayload {
  return {
    additional_seats: Math.max(0, Math.floor(additionalSeats)),
    plan,
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
  if (overCapacity) {
    return "add_seats"
  }
  if (!currentPlan) {
    return "choose_plan"
  }
  if (shouldRecommendPro) {
    return "upgrade_plan"
  }
  return "manage_seats"
}
