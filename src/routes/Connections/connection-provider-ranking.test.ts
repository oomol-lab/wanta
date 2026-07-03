import type { ConnectionProviderSummary } from "../../../electron/connections/common.ts"

import { describe, expect, test } from "vitest"
import {
  compareConnectionProvidersByRecommendation,
  getRecommendedConnectionServicePriority,
} from "./connection-provider-ranking.ts"

function provider(
  service: string,
  status: ConnectionProviderSummary["status"] = "available",
  displayName = service,
): ConnectionProviderSummary {
  return {
    actionKind: "oauth2",
    appCount: status === "available" ? 0 : 1,
    apps: [],
    authTypes: ["oauth2"],
    canDisconnect: status !== "available",
    categoryLabels: [],
    displayName,
    service,
    status,
    ...(status !== "available" ? { appStatus: status === "connected" ? "active" : "error" } : {}),
  }
}

function sortedServices(providers: ConnectionProviderSummary[]): string[] {
  return [...providers].sort(compareConnectionProvidersByRecommendation).map((item) => item.service)
}

describe("connection provider recommendation ranking", () => {
  test("keeps providers needing attention ahead of connected and available providers", () => {
    expect(
      sortedServices([
        provider("gmail", "available", "Gmail"),
        provider("ably", "connected", "Ably"),
        provider("quickchart", "needs_attention", "QuickChart"),
      ]),
    ).toEqual(["quickchart", "ably", "gmail"])
  })

  test("orders providers by recommended service priority within the same status", () => {
    expect(
      sortedServices([
        provider("quickchart", "available", "QuickChart"),
        provider("github", "available", "GitHub"),
        provider("gmail", "available", "Gmail"),
        provider("googlesheets", "available", "Google Sheets"),
      ]),
    ).toEqual(["gmail", "googlesheets", "github", "quickchart"])
  })

  test("falls back to display name for providers outside the recommendation table", () => {
    expect(
      sortedServices([
        provider("z-provider", "available", "Zeta"),
        provider("a-provider", "available", "Alpha"),
        provider("m-provider", "available", "Middle"),
      ]),
    ).toEqual(["a-provider", "m-provider", "z-provider"])
  })

  test("normalizes service names when reading recommendation priority", () => {
    expect(getRecommendedConnectionServicePriority("google-sheets")).toBe(
      getRecommendedConnectionServicePriority("googlesheets"),
    )
    expect(getRecommendedConnectionServicePriority("Google Sheets")).toBe(
      getRecommendedConnectionServicePriority("googlesheets"),
    )
  })
})
