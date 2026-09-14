import type { ConnectionAppSummary } from "../../../electron/connections/common.ts"

import { describe, expect, it } from "vitest"
import { getMarketplacePriceReduction } from "./connection-provider-pricing.ts"

function marketplaceApp(overrides: Partial<ConnectionAppSummary> = {}): ConnectionAppSummary {
  return {
    id: "marketplace:oomol:kling",
    service: "kling",
    displayName: "Kling AI",
    isDefault: true,
    authType: "marketplace",
    marketplace: { id: "oomol", pricing: "metered" },
    status: "active",
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  }
}

describe("marketplace price comparison", () => {
  it.each([
    ["kling", 30],
    ["seedance", 10],
    ["minimax", 10],
  ])("shows the price reduction for %s, not the percentage charged", (service, reduction) => {
    expect(getMarketplacePriceReduction(service, [marketplaceApp({ service })])).toBe(reduction)
  })

  it("does not advertise discounts on a user's own credentials or another marketplace", () => {
    expect(
      getMarketplacePriceReduction("kling", [marketplaceApp({ authType: "api_key", marketplace: undefined })]),
    ).toBeUndefined()
    expect(
      getMarketplacePriceReduction("kling", [marketplaceApp({ marketplace: { id: "other", pricing: "metered" } })]),
    ).toBeUndefined()
  })

  it.each(["disconnected", "error", "reauth_required"] as const)(
    "hides the offer when the built-in app is %s",
    (status) => {
      expect(getMarketplacePriceReduction("kling", [marketplaceApp({ status })])).toBeUndefined()
    },
  )

  it("requires a listed offer and an available built-in app", () => {
    expect(getMarketplacePriceReduction("kling", [])).toBeUndefined()
    expect(
      getMarketplacePriceReduction("doubao_seedream", [marketplaceApp({ service: "doubao_seedream" })]),
    ).toBeUndefined()
  })

  it("keeps the built-in offer available alongside a user's own connection", () => {
    expect(
      getMarketplacePriceReduction("kling", [
        marketplaceApp({ id: "own-kling", authType: "api_key", marketplace: undefined }),
        marketplaceApp({ isDefault: false }),
      ]),
    ).toBe(30)
  })
})
