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
    ["Cryptography API", "developer"],
    ["股票行情", "investment"],
    ["投资助手", "investment"],
    ["Stock market API", "investment"],
    ["Market database API", "developer"],
  ] as const)("matches keyword boundaries without losing CJK and phrases: %s", (displayName, expected) => {
    expect(resolveConnectorBusinessCategory(provider({ displayName, service: "unlisted-provider" }))).toBe(expected)
  })
  it.each([
    ["openai", "ai"],
    ["shopify_admin", "cross-border-ecommerce"],
    ["gmail", "communication"],
    ["notion", "communication"],
    ["google_sheets", "productivity"],
    ["hubspot", "marketing"],
    ["databricks", "data-storage"],
    ["github", "developer"],
    ["hithink_finance", "investment"],
    ["financial_modeling_prep", "investment"],
    ["coinbase", "investment"],
    ["binance", "investment"],
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
    ["Document wiki", "communication"],
    ["Amazon seller helper", "cross-border-ecommerce"],
    ["Customer CRM", "marketing"],
    ["Stock market portfolio", "investment"],
    ["Team messaging", "communication"],
    ["Code deployment", "developer"],
    ["Database warehouse", "data-storage"],
  ] as const)("uses Console keyword fallback for %s", (displayName, expected) => {
    expect(resolveConnectorBusinessCategory(provider({ displayName, service: "unlisted-provider" }))).toBe(expected)
  })

  it("leaves unmatched providers outside the eight discovery cards", () => {
    expect(resolveConnectorBusinessCategory(provider({ displayName: "Weather", service: "weather" }))).toBeNull()
  })

  it("matches short keywords only as complete words", () => {
    expect(resolveConnectorBusinessCategory(provider({ displayName: "AI assistant", service: "new-ai" }))).toBe("ai")
    expect(resolveConnectorBusinessCategory(provider({ displayName: "Airtable", service: "new-airtable" }))).toBe(
      "productivity",
    )
    expect(resolveConnectorBusinessCategory(provider({ displayName: "Mailjet", service: "new-mailjet" }))).toBe(
      "communication",
    )
  })

  it("matches a short Latin keyword next to CJK characters", () => {
    expect(
      resolveConnectorBusinessCategory(
        provider({ categoryLabels: [], displayName: "AI助手", service: "unlisted-provider" }),
      ),
    ).toBe("ai")
  })
})

it.each(["docs", "documents", "documentation", "knowledge", "collaboration"])(
  "merges legacy %s categories",
  (category) => {
    expect(resolveConnectorBusinessCategory(provider({ categoryIds: [category] }))).toBe("communication")
  },
)
it.each(["finance", "financial", "stocks", "trading", "crypto", "cryptocurrency"])(
  "normalizes investment category %s",
  (category) => {
    expect(resolveConnectorBusinessCategory(provider({ categoryIds: [category] }))).toBe("investment")
  },
)

it.each(["投资助手", "股票行情", "加密货币"])("recognizes short investment keywords in %s", (displayName) => {
  expect(resolveConnectorBusinessCategory(provider({ displayName }))).toBe("investment")
})
