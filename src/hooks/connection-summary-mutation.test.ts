import { expect, test } from "vitest"
import { mergeConnectionSummary } from "../../electron/connections/summary.ts"
import { applyConfirmedConnectionMutation } from "./connection-summary-mutation.ts"

function fixture() {
  return mergeConnectionSummary({
    workspace: { manageable: true, teamName: "test" },
    providers: [
      { service: "demo", authTypes: ["oauth2"], displayName: "Demo", categories: ["Productivity"] },
      { service: "other", authTypes: ["oauth2"] },
    ],
    apps: [
      {
        id: "one",
        service: "demo",
        authType: "oauth2",
        status: "active",
        isDefault: true,
        accountLabel: "Account one",
      },
      { id: "two", service: "demo", authType: "oauth2", status: "active", accountLabel: "Account two" },
      { id: "marketplace:demo", service: "demo", authType: "marketplace", status: "active" },
      { id: "other", service: "other", authType: "oauth2", status: "active" },
    ],
  })
}

test("confirmed aliases and defaults update both account and provider projections", () => {
  const original = fixture()
  const renamed = applyConfirmedConnectionMutation(original, { kind: "alias", appId: "one", alias: " Work " })
  expect(renamed.apps[0]?.alias).toBe("Work")
  expect(renamed.providers[0]?.accountLabel).toBe("Work")
  expect(renamed.providers[1]).toBe(original.providers[1])
  expect(renamed.providers[0]?.categoryLabels).toEqual(original.providers[0]?.categoryLabels)
  expect(original.apps[0]?.alias).toBeUndefined()
  const changed = applyConfirmedConnectionMutation(renamed, { kind: "default", service: "demo", appId: "two" })
  expect(changed.apps.filter((app) => app.service === "demo" && app.isDefault).map((app) => app.id)).toEqual(["two"])
  expect(changed.providers[0]?.appId).toBe("two")
  const cleared = applyConfirmedConnectionMutation(renamed, { kind: "alias", appId: "one", alias: " " })
  expect(cleared.providers[0]?.accountLabel).toBe("Account one")
})

test("service disconnect preserves marketplace accounts and unrelated provider identity", () => {
  const original = fixture()
  const next = applyConfirmedConnectionMutation(original, { kind: "disconnectService", service: "demo" })
  expect(next.apps.map((app) => app.id)).toEqual(["marketplace:demo", "other"])
  expect(next.providers[0]).toMatchObject({ appCount: 1, canDisconnect: false, status: "connected" })
  expect(next.providers[1]).toBe(original.providers[1])
  expect(next.connectedProviderCount).toBe(original.connectedProviderCount)
  const disconnected = applyConfirmedConnectionMutation(next, { kind: "disconnectAccount", appId: "other" })
  expect(disconnected.providers[1]).toMatchObject({ appCount: 0, status: "available", appId: undefined })
  expect(disconnected.connectedProviderCount).toBe(next.connectedProviderCount - 1)
})
