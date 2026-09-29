import type { ConnectionAppSummary, ConnectionProviderSummary } from "../../../electron/connections/common.ts"

import { describe, expect, test } from "vitest"
import {
  compareConnectionProviders,
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
    apps:
      status === "available"
        ? []
        : [
            {
              id: `own-${service}`,
              service,
              authType: "oauth2",
              isDefault: true,
              createdAt: 1,
              updatedAt: 1,
              status: status === "connected" ? "active" : "error",
            },
          ],
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
    ).toEqual(["googlesheets", "gmail", "github", "quickchart"])
  })

  test("mixes directly available and connectable providers by recommendation", () => {
    const directlyAvailable = {
      ...provider("gmail", "connected", "Gmail"),
      actionKind: "no_auth" as const,
      appCount: 0,
      apps: [],
      appStatus: undefined,
      authTypes: ["no_auth" as const],
    }

    expect(sortedServices([directlyAvailable, provider("notion", "available", "Notion")])).toEqual(["gmail", "notion"])
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

  test("supports explicit name and recently connected sorting", () => {
    const recent = { ...provider("recent", "connected", "Zulu"), connectedUpdatedAt: 200 }
    const older = { ...provider("older", "connected", "Alpha"), connectedUpdatedAt: 100 }

    expect([recent, older].sort((left, right) => compareConnectionProviders(left, right, "name"))[0]?.service).toBe(
      "older",
    )
    expect(
      [older, recent].sort((left, right) => compareConnectionProviders(left, right, "recently-connected"))[0]?.service,
    ).toBe("recent")
  })
})

function marketplace(service: string, status: ConnectionAppSummary["status"] = "active"): ConnectionProviderSummary {
  return {
    ...provider(service, status === "active" ? "connected" : "needs_attention"),
    appAuthType: "marketplace",
    appStatus: status,
    apps: [
      {
        id: `marketplace:oomol:${service}`,
        authType: "marketplace",
        service,
        marketplace: { id: "oomol", pricing: "metered" },
        isDefault: true,
        createdAt: 0,
        updatedAt: 0,
        status,
      },
    ],
  }
}

test("puts own error, reauth and healthy accounts before active discounted and ordinary built-ins", () => {
  const error = provider("z-error", "needs_attention")
  const reauth = provider("z-reauth", "needs_attention")
  reauth.apps[0]!.status = "reauth_required"
  reauth.appStatus = "reauth_required"
  expect(
    sortedServices([
      marketplace("kling"),
      marketplace("gmail"),
      marketplace("seedance"),
      provider("z-own", "connected"),
      reauth,
      error,
      provider("googlecalendar"),
    ]),
  ).toEqual(["z-error", "z-reauth", "z-own", "kling", "seedance", "gmail", "googlecalendar"])
})

test("mixed own and built-in accounts keep own priority even when the built-in is default", () => {
  const mixed = marketplace("kling")
  mixed.apps.push({ ...provider("kling", "connected").apps[0]!, isDefault: false })
  expect(sortedServices([marketplace("seedance"), mixed])).toEqual(["kling", "seedance"])
})

test.each(["active", "reauth_required"] as const)(
  "an errored default built-in does not override the %s own account's ranking",
  (ownStatus) => {
    const mixed = marketplace("kling", "error")
    mixed.appId = mixed.apps[0]!.id
    mixed.apps.push({ ...provider("kling", "connected").apps[0]!, status: ownStatus, isDefault: false })
    const error = provider("z-error", "needs_attention")
    const reauth = provider("z-reauth", "needs_attention")
    reauth.apps[0]!.status = "reauth_required"
    reauth.appStatus = "reauth_required"
    reauth.appId = reauth.apps[0]!.id
    expect(sortedServices([mixed, provider("gmail", "connected"), reauth, error])).toEqual(
      ownStatus === "active" ? ["z-error", "z-reauth", "gmail", "kling"] : ["z-error", "kling", "z-reauth", "gmail"],
    )
  },
)

test("inactive, disconnected and non-OOMOL accounts cannot qualify for discounted priority", () => {
  const disconnected = marketplace("kling", "disconnected")
  const otherMarketplace = marketplace("seedance")
  otherMarketplace.apps[0]!.marketplace!.id = "other"
  expect(
    sortedServices([
      marketplace("minimax", "error"),
      marketplace("kling", "reauth_required"),
      disconnected,
      otherMarketplace,
      provider("gmail"),
    ]),
  ).toEqual(["gmail", "kling", "kling", "minimax", "seedance"])
})

test("configured local CLI providers participate without remote app records", () => {
  const local = { ...provider("lark-cli", "connected"), executionMode: "direct" as const, apps: [] }
  const expired = { ...provider("wecom-cli", "needs_attention"), executionMode: "direct" as const, apps: [] }
  const unconfigured = { ...provider("dingtalk-cli"), executionMode: "direct" as const }
  expect(sortedServices([marketplace("kling"), local, expired, unconfigured])).toEqual([
    "wecom-cli",
    "lark-cli",
    "kling",
    "dingtalk-cli",
  ])
})

test("disconnected own and virtual no-auth accounts do not outrank a discount", () => {
  const disconnected = provider("gmail", "connected")
  disconnected.apps[0]!.status = "disconnected"
  const noAuth = provider("googlesheets", "connected")
  noAuth.apps[0]!.id = "no_auth:googlesheets"
  expect(sortedServices([disconnected, noAuth, marketplace("kling")])).toEqual(["kling", "googlesheets", "gmail"])
})

test("language priority precedes the recommendation table within a group", () => {
  expect(sortedServices([provider("gmail"), provider("unknown", "available", "同花顺")])).toEqual(["unknown", "gmail"])
})
