import { describe, expect, it } from "vitest"
import { buildWantaSubscriptionOverview } from "./wanta-subscription-model.ts"

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
