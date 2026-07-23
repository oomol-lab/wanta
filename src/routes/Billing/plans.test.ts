import type { SubscriptionStatus } from "../../../electron/chat/common.ts"

import { describe, expect, it } from "vitest"
import { getCurrentTeamPlan } from "./plans.ts"

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
