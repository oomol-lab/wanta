import type { ConnectionProviderSummary } from "../../../electron/connections/common.ts"

import { describe, expect, it } from "vitest"
import { resolveConnectorBusinessCategory } from "./connection-provider-category.ts"

function provider(overrides: Partial<ConnectionProviderSummary>): ConnectionProviderSummary {
  return {
    actionKind: "oauth2",
    appCount: 0,
    apps: [],
    authTypes: ["oauth2"],
    canDisconnect: false,
    categoryLabels: [],
    displayName: "Provider",
    service: "provider",
    status: "available",
    ...overrides,
  }
}

describe("Console-compatible provider categories", () => {
  it.each([
    ["openai", "ai"],
    ["shopify_admin", "cross-border-ecommerce"],
    ["gmail", "communication"],
    ["notion", "docs"],
    ["google_sheets", "productivity"],
    ["hubspot", "marketing"],
    ["databricks", "data-storage"],
    ["github", "developer"],
  ] as const)("uses the Console service override for %s", (service, expected) => {
    expect(resolveConnectorBusinessCategory(provider({ service }))).toBe(expected)
  })

  it("uses the first recognized API category before keyword fallback", () => {
    expect(
      resolveConnectorBusinessCategory(
        provider({ categoryIds: ["marketing", "ai"], displayName: "AI assistant", service: "unlisted-provider" }),
      ),
    ).toBe("marketing")
  })

  it.each([
    ["LLM model gateway", "ai"],
    ["Project task planner", "productivity"],
    ["Document wiki", "docs"],
    ["Amazon seller helper", "cross-border-ecommerce"],
    ["Customer CRM", "marketing"],
    ["Team messaging", "communication"],
    ["Code deployment", "developer"],
    ["Database warehouse", "data-storage"],
  ] as const)("uses Console keyword fallback for %s", (displayName, expected) => {
    expect(resolveConnectorBusinessCategory(provider({ displayName, service: "unlisted-provider" }))).toBe(expected)
  })

  it("leaves unmatched providers outside the eight discovery cards", () => {
    expect(resolveConnectorBusinessCategory(provider({ displayName: "Weather", service: "weather" }))).toBeNull()
  })
})
