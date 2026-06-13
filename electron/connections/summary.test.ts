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

test("createEmptyConnectionSummary exposes a signed-out state", () => {
  const summary = createEmptyConnectionSummary("signed-out", "no key")

  assert.equal(summary.status, "signed-out")
  assert.equal(summary.message, "no key")
  assert.equal(summary.providers.length, 0)
})
