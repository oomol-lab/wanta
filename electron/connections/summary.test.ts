import assert from "node:assert/strict"
import { test } from "vitest"
import { emptyConnectionSummary, mergeConnectionSummary } from "./summary.ts"

const providers = [
  { service: "gmail", displayName: "Gmail", authTypes: ["oauth2" as const], categories: [{ displayName: "Email" }] },
  { service: "quickchart", displayName: "QuickChart", authTypes: ["no_auth" as const] },
  { service: "ably", displayName: "Ably", authTypes: ["api_key" as const] },
]

test("merge marks connected providers and computes counts", () => {
  const summary = mergeConnectionSummary(
    [{ service: "gmail", status: "active", authType: "oauth2", updatedAt: 5 }],
    providers,
    1000,
  )
  assert.equal(summary.ready, true)
  assert.equal(summary.providerCount, 3)
  assert.equal(summary.connectedCount, 1)
  const gmail = summary.providers.find((p) => p.service === "gmail")
  assert.equal(gmail?.connected, true)
  assert.equal(gmail?.status, "connected")
  assert.equal(gmail?.canDisconnect, true)
  assert.deepEqual(gmail?.categories, ["Email"])
})

test("connected providers sort before available ones", () => {
  const summary = mergeConnectionSummary([{ service: "gmail", status: "active" }], providers, 1)
  assert.equal(summary.providers[0].service, "gmail")
})

test("pure no_auth connected provider cannot be disconnected", () => {
  const summary = mergeConnectionSummary([{ service: "quickchart", status: "active" }], providers, 1)
  const qc = summary.providers.find((p) => p.service === "quickchart")
  assert.equal(qc?.connected, true)
  assert.equal(qc?.canDisconnect, false)
})

test("non-active app becomes needs_attention", () => {
  const summary = mergeConnectionSummary([{ service: "ably", status: "reauth_required" }], providers, 1)
  const ably = summary.providers.find((p) => p.service === "ably")
  assert.equal(ably?.status, "needs_attention")
  assert.equal(ably?.connected, false)
})

test("emptyConnectionSummary is not ready", () => {
  const summary = emptyConnectionSummary(1, "no key")
  assert.equal(summary.ready, false)
  assert.equal(summary.message, "no key")
  assert.equal(summary.providers.length, 0)
})
