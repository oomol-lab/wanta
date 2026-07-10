import { describe, expect, it } from "vitest"
import {
  buildWantaPlanChange,
  buildWantaSubscriptionOverview,
  isWantaSubscriptionActionDisabled,
  resolveWantaPendingPaymentTargets,
} from "./wanta-subscription-model.ts"

describe("buildWantaSubscriptionOverview", () => {
  it("uses Wanta plan capacity plus additional seats", () => {
    const overview = buildWantaSubscriptionOverview({
      canManage: true,
      memberCount: 12,
      pendingPayment: null,
      subscription: {
        features: [],
        plan: "wanta_plus",
        plans: [],
        platforms: {},
        wanta: { additionalSeats: 4, cached: false, updatedAt: null },
      },
    })

    expect(overview.currentPlan).toBe("wanta_plus")
    expect(overview.baseSeats).toBe(10)
    expect(overview.additionalSeats).toBe(4)
    expect(overview.seatCapacity).toBe(14)
    expect(overview.remainingSeats).toBe(2)
    expect(overview.overCapacity).toBe(false)
  })

  it("uses extra seats before recommending Pro on Plus", () => {
    const overview = buildWantaSubscriptionOverview({
      canManage: true,
      memberCount: 8,
      pendingPayment: null,
      subscription: {
        features: [],
        plan: "wanta_plus",
        plans: [],
        platforms: {},
        wanta: { additionalSeats: 10, cached: false, updatedAt: null },
      },
    })

    expect(overview.seatCapacity).toBe(20)
    expect(overview.shouldRecommendPro).toBe(false)
    expect(overview.recommendedAction).toBe("manage_seats")
  })

  it("prioritizes pending payment before other management actions", () => {
    const overview = buildWantaSubscriptionOverview({
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
        plan: "wanta_plus",
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
    const overview = buildWantaSubscriptionOverview({
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

  it("keeps purchased seats available without a Wanta plan", () => {
    const overview = buildWantaSubscriptionOverview({
      canManage: true,
      memberCount: 2,
      pendingPayment: null,
      subscription: {
        features: [],
        plan: null,
        plans: [],
        platforms: {},
        wanta: { additionalSeats: 3, cached: false, updatedAt: null },
      },
    })

    expect(overview.currentPlan).toBeNull()
    expect(overview.additionalSeats).toBe(3)
    expect(overview.seatCapacity).toBe(3)
    expect(overview.overCapacity).toBe(false)
    expect(overview.recommendedAction).toBe("choose_plan")
  })

  it("recommends extra seats when a no-plan workspace exceeds purchased seats", () => {
    const overview = buildWantaSubscriptionOverview({
      canManage: true,
      memberCount: 4,
      pendingPayment: null,
      subscription: {
        features: [],
        plan: null,
        plans: [],
        platforms: {},
        wanta: { additionalSeats: 3, cached: false, updatedAt: null },
      },
    })

    expect(overview.overCapacity).toBe(true)
    expect(overview.recommendedAction).toBe("add_seats")
  })

  it("recommends extra seats before Pro when the workspace exceeds capacity", () => {
    const overview = buildWantaSubscriptionOverview({
      canManage: true,
      memberCount: 15,
      pendingPayment: null,
      subscription: {
        features: [],
        plan: "wanta_plus",
        plans: [],
        platforms: {},
      },
    })

    expect(overview.overCapacity).toBe(true)
    expect(overview.recommendedAction).toBe("add_seats")
  })
})

describe("resolveWantaPendingPaymentTargets", () => {
  it("maps pending plan checkout to the matching plan card", () => {
    const targets = resolveWantaPendingPaymentTargets({
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
        plan: "wanta_plus",
        status: "past_due",
        subscriptionID: "sub-1",
      },
    })

    expect(targets).toEqual({
      additionalSeats: null,
      paymentUrl: "https://console.example.com/plus",
      plan: "wanta_plus",
    })
  })

  it("maps same-plan pending seat checkout to the seats control", () => {
    const targets = resolveWantaPendingPaymentTargets({
      currentAdditionalSeats: 0,
      currentPlan: "wanta_plus",
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
        plan: "wanta_plus",
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
    const targets = resolveWantaPendingPaymentTargets({
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
    const targets = resolveWantaPendingPaymentTargets({
      currentAdditionalSeats: 0,
      currentPlan: "wanta_plus",
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
        plan: "wanta_pro",
        status: "past_due",
        subscriptionID: "sub-1",
      },
    })

    expect(targets).toEqual({
      additionalSeats: null,
      paymentUrl: "https://console.example.com/pro",
      plan: "wanta_pro",
    })
  })

  it("falls back to the current plan for renewal payment checkouts", () => {
    const targets = resolveWantaPendingPaymentTargets({
      currentAdditionalSeats: 0,
      currentPlan: "wanta_plus",
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
      plan: "wanta_plus",
    })
  })
})

describe("isWantaSubscriptionActionDisabled", () => {
  it("keeps checkout available while the billing overview is unavailable", () => {
    // 概览数据不是结账接口的输入；网络慢或概览降级时也必须能选择计划并创建支付链接。
    expect(
      isWantaSubscriptionActionDisabled({
        canManage: true,
        isSessionExpired: false,
        isSubmitting: false,
      }),
    ).toBe(false)
  })

  it("disables checkout for permission, authentication, and active submission states", () => {
    expect(
      isWantaSubscriptionActionDisabled({
        canManage: false,
        isSessionExpired: false,
        isSubmitting: false,
      }),
    ).toBe(true)
    expect(
      isWantaSubscriptionActionDisabled({
        canManage: true,
        isSessionExpired: true,
        isSubmitting: false,
      }),
    ).toBe(true)
    expect(
      isWantaSubscriptionActionDisabled({
        canManage: true,
        isSessionExpired: false,
        isSubmitting: true,
      }),
    ).toBe(true)
  })
})

describe("buildWantaPlanChange", () => {
  it("keeps the current seat target when changing plans", () => {
    expect(buildWantaPlanChange("wanta_pro", 3.8)).toEqual({
      additional_seats: 3,
      plan: "wanta_pro",
    })
  })
})
