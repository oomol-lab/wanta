import type { SubscriptionStatus } from "../../../electron/chat/common.ts"

import { describe, expect, it } from "vitest"
import { getCurrentUsageSubscription, getCurrentTeamPlan } from "./plans.ts"

function subscription(overrides: Partial<SubscriptionStatus>): SubscriptionStatus {
  return {
    features: [],
    plan: null,
    plans: [],
    platforms: {},
    ...overrides,
  }
}

describe("getCurrentTeamPlan", () => {
  it("prefers the primary plan over legacy marker lists", () => {
    const status = subscription({
      plan: "team_pro",
      plans: ["team_plus"],
    })

    expect(getCurrentTeamPlan(status)).toBe("team_pro")
  })

  it("falls back to legacy markers when the primary plan is absent", () => {
    const status = subscription({
      features: ["team_pro"],
      plan: null,
      plans: ["legacy"],
    })

    expect(getCurrentTeamPlan(status)).toBe("team_pro")
  })
})

describe("getCurrentUsageSubscription", () => {
  it("reads the current personal usage plan", () => {
    expect(getCurrentUsageSubscription(subscription({ plan: "ai_pro" }))).toBe("ai_pro")
  })

  it("supports platform marker responses", () => {
    expect(
      getCurrentUsageSubscription(
        subscription({
          platforms: { stripe: ["ai_max"] },
        }),
      ),
    ).toBe("ai_max")
  })

  it("ignores Team subscription markers", () => {
    expect(getCurrentUsageSubscription(subscription({ plan: "team_plus" }))).toBeNull()
  })
})
