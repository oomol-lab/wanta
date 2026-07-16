import { describe, expect, it } from "vitest"
import {
  buildTeamPlanChange,
  buildTeamSubscriptionOverview,
  isTeamSubscriptionActionDisabled,
  resolveTeamPendingPaymentTargets,
} from "./team-subscription-model.ts"

describe("buildTeamSubscriptionOverview", () => {
  it("uses Team plan capacity plus additional seats", () => {
    const overview = buildTeamSubscriptionOverview({
      canManage: true,
      memberCount: 12,
      pendingPayment: null,
      subscription: {
        features: [],
        plan: "team_plus",
        plans: [],
        platforms: {},
        team: { additionalSeats: 4, cached: false, updatedAt: null },
      },
    })

    expect(overview.currentPlan).toBe("team_plus")
    expect(overview.baseSeats).toBe(10)
    expect(overview.additionalSeats).toBe(4)
    expect(overview.seatCapacity).toBe(14)
    expect(overview.remainingSeats).toBe(2)
    expect(overview.overCapacity).toBe(false)
  })

  it("preserves unknown member counts without deriving capacity recommendations", () => {
    const overview = buildTeamSubscriptionOverview({
      canManage: true,
      memberCount: null,
      pendingPayment: null,
      subscription: {
        features: [],
        plan: "team_plus",
        plans: [],
        platforms: {},
      },
    })

    expect(overview.usedSeats).toBeNull()
    expect(overview.remainingSeats).toBeNull()
    expect(overview.overCapacity).toBeNull()
    expect(overview.shouldRecommendPro).toBeNull()
    expect(overview.recommendedAction).toBeNull()
  })

  it("uses extra seats before recommending Pro on Plus", () => {
    const overview = buildTeamSubscriptionOverview({
      canManage: true,
      memberCount: 8,
      pendingPayment: null,
      subscription: {
        features: [],
        plan: "team_plus",
        plans: [],
        platforms: {},
        team: { additionalSeats: 10, cached: false, updatedAt: null },
      },
    })

    expect(overview.seatCapacity).toBe(20)
    expect(overview.shouldRecommendPro).toBe(false)
    expect(overview.recommendedAction).toBe("manage_seats")
  })

  it("prioritizes pending payment before other management actions", () => {
    const overview = buildTeamSubscriptionOverview({
      canManage: true,
      memberCount: 2,
      pendingPayment: {
        additionalSeats: 0,
        amountRemaining: null,
        currency: null,
        currentPeriodEnd: null,
        invoiceStatus: null,
        latestInvoiceID: null,
        paymentRequired: true,
        paymentURL: "https://console.example.com/pay",
        pendingUpdate: true,
        pendingUpdateExpiresAt: null,
        plan: "team_plus",
        status: "past_due",
        subscriptionID: "sub-1",
      },
      subscription: {
        features: [],
        plan: null,
        plans: [],
        platforms: {},
      },
    })

    expect(overview.hasPendingPayment).toBe(true)
    expect(overview.recommendedAction).toBe("continue_payment")
  })

  it("recommends choosing a plan before seat management on free workspaces", () => {
    const overview = buildTeamSubscriptionOverview({
      canManage: true,
      memberCount: 2,
      pendingPayment: null,
      subscription: {
        features: [],
        plan: null,
        plans: [],
        platforms: {},
      },
    })

    expect(overview.currentPlan).toBeNull()
    expect(overview.seatCapacity).toBeNull()
    expect(overview.accountsPerApp).toBe(1)
    expect(overview.overCapacity).toBe(false)
    expect(overview.recommendedAction).toBe("choose_plan")
  })

  it("keeps purchased seats available without a Team plan", () => {
    const overview = buildTeamSubscriptionOverview({
      canManage: true,
      memberCount: 2,
      pendingPayment: null,
      subscription: {
        features: [],
        plan: null,
        plans: [],
        platforms: {},
        team: { additionalSeats: 3, cached: false, updatedAt: null },
      },
    })

    expect(overview.currentPlan).toBeNull()
    expect(overview.additionalSeats).toBe(3)
    expect(overview.seatCapacity).toBe(3)
    expect(overview.overCapacity).toBe(false)
    expect(overview.recommendedAction).toBe("choose_plan")
  })

  it("recommends extra seats when a no-plan workspace exceeds purchased seats", () => {
    const overview = buildTeamSubscriptionOverview({
      canManage: true,
      memberCount: 4,
      pendingPayment: null,
      subscription: {
        features: [],
        plan: null,
        plans: [],
        platforms: {},
        team: { additionalSeats: 3, cached: false, updatedAt: null },
      },
    })

    expect(overview.overCapacity).toBe(true)
    expect(overview.recommendedAction).toBe("add_seats")
  })

  it("recommends extra seats before Pro when the workspace exceeds capacity", () => {
    const overview = buildTeamSubscriptionOverview({
      canManage: true,
      memberCount: 15,
      pendingPayment: null,
      subscription: {
        features: [],
        plan: "team_plus",
        plans: [],
        platforms: {},
      },
    })

    expect(overview.overCapacity).toBe(true)
    expect(overview.recommendedAction).toBe("add_seats")
  })
})

describe("resolveTeamPendingPaymentTargets", () => {
  it("maps pending plan checkout to the matching plan card", () => {
    const targets = resolveTeamPendingPaymentTargets({
      currentAdditionalSeats: 0,
      currentPlan: null,
      pendingPayment: {
        additionalSeats: 0,
        amountRemaining: null,
        currency: null,
        currentPeriodEnd: null,
        invoiceStatus: null,
        latestInvoiceID: null,
        paymentRequired: true,
        paymentURL: " https://console.example.com/plus ",
        pendingUpdate: true,
        pendingUpdateExpiresAt: null,
        plan: "team_plus",
        status: "past_due",
        subscriptionID: "sub-1",
      },
    })

    expect(targets).toEqual({
      additionalSeats: null,
      paymentUrl: "https://console.example.com/plus",
      plan: "team_plus",
    })
  })

  it("maps same-plan pending seat checkout to the seats control", () => {
    const targets = resolveTeamPendingPaymentTargets({
      currentAdditionalSeats: 0,
      currentPlan: "team_plus",
      pendingPayment: {
        additionalSeats: 3,
        amountRemaining: null,
        currency: null,
        currentPeriodEnd: null,
        invoiceStatus: null,
        latestInvoiceID: null,
        paymentRequired: true,
        paymentURL: "https://console.example.com/seats",
        pendingUpdate: true,
        pendingUpdateExpiresAt: null,
        plan: "team_plus",
        status: "past_due",
        subscriptionID: "sub-1",
      },
    })

    expect(targets).toEqual({
      additionalSeats: 3,
      paymentUrl: "https://console.example.com/seats",
      plan: null,
    })
  })

  it("maps no-plan pending seat checkout to the seats control", () => {
    const targets = resolveTeamPendingPaymentTargets({
      currentAdditionalSeats: 0,
      currentPlan: null,
      pendingPayment: {
        additionalSeats: 2,
        amountRemaining: null,
        currency: null,
        currentPeriodEnd: null,
        invoiceStatus: null,
        latestInvoiceID: null,
        paymentRequired: true,
        paymentURL: "https://console.example.com/no-plan-seats",
        pendingUpdate: true,
        pendingUpdateExpiresAt: null,
        plan: null,
        status: "past_due",
        subscriptionID: "sub-1",
      },
    })

    expect(targets).toEqual({
      additionalSeats: 2,
      paymentUrl: "https://console.example.com/no-plan-seats",
      plan: null,
    })
  })

  it("keeps plan-upgrade checkouts on the plan card even when seats also change", () => {
    const targets = resolveTeamPendingPaymentTargets({
      currentAdditionalSeats: 0,
      currentPlan: "team_plus",
      pendingPayment: {
        additionalSeats: 3,
        amountRemaining: null,
        currency: null,
        currentPeriodEnd: null,
        invoiceStatus: null,
        latestInvoiceID: null,
        paymentRequired: true,
        paymentURL: "https://console.example.com/pro",
        pendingUpdate: true,
        pendingUpdateExpiresAt: null,
        plan: "team_pro",
        status: "past_due",
        subscriptionID: "sub-1",
      },
    })

    expect(targets).toEqual({
      additionalSeats: null,
      paymentUrl: "https://console.example.com/pro",
      plan: "team_pro",
    })
  })

  it("falls back to the current plan for renewal payment checkouts", () => {
    const targets = resolveTeamPendingPaymentTargets({
      currentAdditionalSeats: 0,
      currentPlan: "team_plus",
      pendingPayment: {
        additionalSeats: 0,
        amountRemaining: null,
        currency: null,
        currentPeriodEnd: null,
        invoiceStatus: null,
        latestInvoiceID: null,
        paymentRequired: true,
        paymentURL: "https://console.example.com/renew",
        pendingUpdate: false,
        pendingUpdateExpiresAt: null,
        plan: null,
        status: "past_due",
        subscriptionID: "sub-1",
      },
    })

    expect(targets).toEqual({
      additionalSeats: null,
      paymentUrl: "https://console.example.com/renew",
      plan: "team_plus",
    })
  })
})

describe("isTeamSubscriptionActionDisabled", () => {
  it("keeps checkout available while the billing overview is unavailable", () => {
    // 概览数据不是结账接口的输入；网络慢或概览降级时也必须能选择计划并创建支付链接。
    expect(
      isTeamSubscriptionActionDisabled({
        canManage: true,
        isSessionExpired: false,
        isSubmitting: false,
      }),
    ).toBe(false)
  })

  it("disables checkout for permission, authentication, and active submission states", () => {
    expect(
      isTeamSubscriptionActionDisabled({
        canManage: false,
        isSessionExpired: false,
        isSubmitting: false,
      }),
    ).toBe(true)
    expect(
      isTeamSubscriptionActionDisabled({
        canManage: true,
        isSessionExpired: true,
        isSubmitting: false,
      }),
    ).toBe(true)
    expect(
      isTeamSubscriptionActionDisabled({
        canManage: true,
        isSessionExpired: false,
        isSubmitting: true,
      }),
    ).toBe(true)
  })
})

describe("buildTeamPlanChange", () => {
  it("keeps the current seat target when changing plans", () => {
    expect(buildTeamPlanChange("team_pro", 3.8)).toEqual({
      additional_seats: 3,
      plan: "team_pro",
    })
  })
})
