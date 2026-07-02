import assert from "node:assert/strict"
import { test } from "vitest"
import { createEmptyConnectionSummary } from "./summary-model.ts"
import { mergeConnectionSummary } from "./summary.ts"

const providers = [
  { service: "gmail", displayName: "Gmail", authTypes: ["oauth2" as const], categories: [{ displayName: "Email" }] },
  { service: "quickchart", displayName: "QuickChart", authTypes: ["no_auth" as const] },
  { service: "ably", displayName: "Ably", authTypes: ["api_key" as const] },
]

const emptyUsage = {
  calls: 0,
  days: 7,
  errors: 0,
  points: [],
  recent: null,
  services: [],
  success: 0,
}

test("merge marks connected providers and computes counts", () => {
  const summary = mergeConnectionSummary({
    apps: [{ id: "app-1", service: "gmail", status: "active", authType: "oauth2", updatedAt: 5 }],
    providers,
    usage: emptyUsage,
  })

  assert.equal(summary.status, "ready")
  assert.equal(summary.providerCount, 3)
  assert.equal(summary.activeConnections, 1)
  const gmail = summary.providers.find((provider) => provider.service === "gmail")
  assert.equal(gmail?.status, "connected")
  assert.equal(gmail?.appStatus, "active")
  assert.equal(gmail?.canDisconnect, true)
  assert.deepEqual(gmail?.categoryLabels, ["Email"])
  assert.equal(gmail?.appCount, 1)
})

test("connected providers sort before available ones", () => {
  const summary = mergeConnectionSummary({
    apps: [{ id: "app-1", service: "gmail", status: "active" }],
    providers,
    usage: emptyUsage,
  })

  assert.equal(summary.providers[0].service, "gmail")
})

test("pure no_auth connected provider cannot be disconnected", () => {
  const summary = mergeConnectionSummary({
    apps: [{ id: "app-1", service: "quickchart", status: "active" }],
    providers,
    usage: emptyUsage,
  })
  const quickchart = summary.providers.find((provider) => provider.service === "quickchart")

  assert.equal(quickchart?.status, "connected")
  assert.equal(quickchart?.canDisconnect, false)
  assert.equal(quickchart?.appCount, 1)
})

test("non-active app becomes needs_attention", () => {
  const summary = mergeConnectionSummary({
    apps: [{ id: "app-1", service: "ably", status: "reauth_required" }],
    providers,
    usage: emptyUsage,
  })
  const ably = summary.providers.find((provider) => provider.service === "ably")

  assert.equal(ably?.status, "needs_attention")
  assert.equal(ably?.appStatus, "reauth_required")
})

test("virtual no_auth app in error becomes needs_attention", () => {
  const summary = mergeConnectionSummary({
    apps: [{ id: "no_auth:quickchart", service: "quickchart", status: "error", authType: "no_auth" }],
    providers,
    usage: emptyUsage,
  })
  const quickchart = summary.providers.find((provider) => provider.service === "quickchart")

  assert.equal(quickchart?.status, "needs_attention")
  assert.equal(quickchart?.appCount, 0)
})

test("merge preserves multiple apps for one provider", () => {
  const summary = mergeConnectionSummary({
    apps: [
      {
        accountLabel: "first@example.com",
        authType: "oauth2",
        id: "app-1",
        isDefault: false,
        service: "gmail",
        status: "active",
        updatedAt: 5,
      },
      {
        accountLabel: "second@example.com",
        authType: "oauth2",
        id: "app-2",
        isDefault: true,
        service: "gmail",
        status: "active",
        updatedAt: 10,
      },
    ],
    providers,
    usage: emptyUsage,
  })

  const gmail = summary.providers.find((provider) => provider.service === "gmail")

  assert.equal(summary.activeConnections, 2)
  assert.equal(summary.connectedProviderCount, 1)
  assert.equal(gmail?.status, "connected")
  assert.equal(gmail?.appCount, 2)
  assert.equal(gmail?.accountLabel, "second@example.com")
  assert.equal(gmail?.appId, "app-2")
  assert.equal(gmail?.connectedUpdatedAt, 10)
  assert.deepEqual(
    gmail?.apps.map((app) => app.id),
    ["app-1", "app-2"],
  )
})

test("merge exposes connection account labels for UI distinction", () => {
  const summary = mergeConnectionSummary({
    apps: [
      {
        alias: "umo-nickname",
        authType: "oauth2",
        displayName: "Umo Nickname",
        id: "app-github",
        providerAccountId: "github-login",
        service: "github",
        status: "active",
        updatedAt: 10,
      },
      {
        authType: "oauth2",
        id: "app-gmail",
        providerAccountId: "user@example.com",
        service: "gmail",
        status: "active",
        updatedAt: 11,
      },
    ],
    providers: [
      { service: "github", displayName: "GitHub", authTypes: ["oauth2" as const] },
      { service: "gmail", displayName: "Gmail", authTypes: ["oauth2" as const] },
    ],
    usage: emptyUsage,
  })

  const github = summary.providers.find((provider) => provider.service === "github")
  const gmail = summary.providers.find((provider) => provider.service === "gmail")
  assert.equal(github?.accountLabel, "Umo Nickname")
  assert.equal(gmail?.accountLabel, "user@example.com")
  assert.equal(summary.apps[0]?.accountLabel, undefined)
})

test("createEmptyConnectionSummary exposes a signed-out state", () => {
  const summary = createEmptyConnectionSummary("signed-out", "no key")

  assert.equal(summary.status, "signed-out")
  assert.equal(summary.message, "no key")
  assert.equal(summary.providers.length, 0)
})
