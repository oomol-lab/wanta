import type { SubscriptionStatus } from "../../../electron/chat/common.ts"

import { describe, expect, it } from "vitest"
import { getCurrentWantaPlan } from "./plans.ts"

function subscription(overrides: Partial<SubscriptionStatus>): SubscriptionStatus {
  return {
    features: [],
    plan: null,
    plans: [],
    platforms: {},
    ...overrides,
  }
}

describe("getCurrentWantaPlan", () => {
  it("prefers the primary plan over legacy marker lists", () => {
    const status = subscription({
      plan: "wanta_pro",
      plans: ["wanta_plus"],
    })

    expect(getCurrentWantaPlan(status)).toBe("wanta_pro")
  })

  it("falls back to legacy markers when the primary plan is absent", () => {
    const status = subscription({
      features: ["wanta_pro"],
      plan: null,
      plans: ["legacy"],
    })

    expect(getCurrentWantaPlan(status)).toBe("wanta_pro")
  })
})
