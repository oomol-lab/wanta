import type {
  SubscriptionStatus,
  TeamPendingPaymentResult,
  TeamSubscriptionChangePayload,
  TeamSubscriptionPlan,
} from "../../../electron/chat/common.ts"

import { defaultAccountsPerApp, getCurrentTeamPlan, teamPlanCapacity } from "./plans.ts"

export type TeamSubscriptionAction =
  | "add_seats"
  | "choose_plan"
  | "continue_payment"
  | "manage_seats"
  | "upgrade_plan"
  | "view"

export interface TeamSubscriptionOverviewInput {
  canManage: boolean
  memberCount: number | null
  pendingPayment: TeamPendingPaymentResult | null
  sharedConnectorCount?: number
  subscription: SubscriptionStatus | null
}

export interface TeamSubscriptionOverview {
  accountsPerApp: number
  additionalSeats: number
  baseSeats: number | null
  canManage: boolean
  currentPlan: TeamSubscriptionPlan | null
  hasPendingPayment: boolean
  overCapacity: boolean | null
  pendingPaymentUrl: string
  recommendedAction: TeamSubscriptionAction | null
  remainingSeats: number | null
  seatCapacity: number | null
  sharedConnectorCount?: number
  shouldRecommendPro: boolean | null
  usedSeats: number | null
}

export interface TeamPendingPaymentTargetsInput {
  currentAdditionalSeats: number
  currentPlan: TeamSubscriptionPlan | null
  pendingPayment: TeamPendingPaymentResult | null
}

export interface TeamPendingPaymentTargets {
  additionalSeats: number | null
  paymentUrl: string
  plan: TeamSubscriptionPlan | null
}

export interface TeamSubscriptionActionDisabledInput {
  canManage: boolean
  isSessionExpired: boolean
  isSubmitting: boolean
}

export function buildTeamSubscriptionOverview({
  canManage,
  memberCount,
  pendingPayment,
  sharedConnectorCount,
  subscription,
}: TeamSubscriptionOverviewInput): TeamSubscriptionOverview {
  const currentPlan = getCurrentTeamPlan(subscription)
  const planCapacity = currentPlan ? teamPlanCapacity(currentPlan) : null
  const additionalSeats = Math.max(0, Math.floor(subscription?.team?.additionalSeats ?? 0))
  const usedSeats = memberCount === null ? null : Math.max(1, Math.floor(memberCount))
  const seatCapacity = planCapacity
    ? planCapacity.members + additionalSeats
    : additionalSeats > 0
      ? additionalSeats
      : null
  const remainingSeats = seatCapacity === null || usedSeats === null ? null : Math.max(0, seatCapacity - usedSeats)
  const overCapacity = usedSeats === null ? null : seatCapacity !== null && usedSeats > seatCapacity
  const pendingPaymentUrl = pendingPayment?.paymentURL?.trim() ?? ""
  const hasPendingPayment = Boolean(pendingPaymentUrl)
  const shouldRecommendPro =
    usedSeats === null
      ? null
      : currentPlan === "team_plus" &&
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
    recommendedAction:
      usedSeats === null
        ? null
        : recommendTeamAction({
            canManage,
            currentPlan,
            hasPendingPayment,
            overCapacity: overCapacity === true,
            shouldRecommendPro: shouldRecommendPro === true,
          }),
    remainingSeats,
    seatCapacity,
    sharedConnectorCount,
    shouldRecommendPro,
    usedSeats,
  }
}

export function resolveTeamPendingPaymentTargets({
  currentAdditionalSeats,
  currentPlan,
  pendingPayment,
}: TeamPendingPaymentTargetsInput): TeamPendingPaymentTargets {
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
export function isTeamSubscriptionActionDisabled({
  canManage,
  isSessionExpired,
  isSubmitting,
}: TeamSubscriptionActionDisabledInput): boolean {
  return !canManage || isSessionExpired || isSubmitting
}

/** Team 计划变更必须带上目标席位数，与 console 的订阅预览/提交契约保持一致。 */
export function buildTeamPlanChange(
  plan: TeamSubscriptionPlan | null,
  additionalSeats: number,
): TeamSubscriptionChangePayload {
  return {
    additional_seats: Math.max(0, Math.floor(additionalSeats)),
    plan,
  }
}

function recommendTeamAction({
  canManage,
  currentPlan,
  hasPendingPayment,
  overCapacity,
  shouldRecommendPro,
}: {
  canManage: boolean
  currentPlan: TeamSubscriptionPlan | null
  hasPendingPayment: boolean
  overCapacity: boolean
  shouldRecommendPro: boolean
}): TeamSubscriptionAction {
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
