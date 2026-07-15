import type {
  ConnectionAppSummary,
  ConnectionProviderSummary,
  ConnectionSummary,
} from "../../electron/connections/common.ts"

import assert from "node:assert/strict"
import { test } from "vitest"
import { applyDefaultAccountUpdate } from "./connections-summary-update.ts"

function app(overrides: Partial<ConnectionAppSummary>): ConnectionAppSummary {
  return {
    authType: "oauth2",
    createdAt: 0,
    id: "app-1",
    isDefault: false,
    service: "gmail",
    status: "active",
    updatedAt: 0,
    ...overrides,
  }
}

function provider(apps: ConnectionAppSummary[]): ConnectionProviderSummary {
  const selected = apps.find((item) => item.isDefault) ?? apps[0]
  return {
    actionKind: "oauth2",
    accountLabel: selected?.alias ?? selected?.accountLabel,
    appAuthType: selected?.authType,
    appCount: apps.length,
    appId: selected?.id,
    appStatus: selected?.status,
    apps,
    authTypes: ["oauth2"],
    canDisconnect: true,
    categoryLabels: [],
    displayName: "Gmail",
    service: "gmail",
    status: "connected",
  }
}

function summary(apps: ConnectionAppSummary[]): ConnectionSummary {
  return {
    activeConnections: apps.length,
    apps,
    connectableProviderCount: 0,
    connectedProviderCount: 1,
    needsAttention: 0,
    providerCount: 1,
    providers: [provider(apps)],
    status: "ready",
    updatedAt: "2026-01-01T00:00:00.000Z",
    usage: {
      calls: 0,
      days: 0,
      errors: 0,
      points: [],
      recent: null,
      services: [],
      success: 0,
    },
    workspace: { type: "organization", organizationName: "org-name" },
  }
}

test("applyDefaultAccountUpdate moves the default flag across summary and provider apps", () => {
  const first = app({ accountLabel: "first@example.com", id: "app-1", isDefault: true })
  const second = app({ accountLabel: "second@example.com", id: "app-2" })
  const next = applyDefaultAccountUpdate(summary([first, second]), "gmail", "app-2", {
    ...second,
    accountLabel: "renamed@example.com",
    isDefault: true,
  })

  assert.equal(next.apps.find((item) => item.id === "app-1")?.isDefault, false)
  assert.equal(next.apps.find((item) => item.id === "app-2")?.isDefault, true)
  assert.equal(next.apps.find((item) => item.id === "app-2")?.accountLabel, "renamed@example.com")
  assert.equal(next.providers[0]?.appId, "app-2")
  assert.equal(next.providers[0]?.accountLabel, "renamed@example.com")
  assert.equal(next.providers[0]?.apps.find((item) => item.id === "app-1")?.isDefault, false)
  assert.equal(next.providers[0]?.apps.find((item) => item.id === "app-2")?.isDefault, true)
})

test("applyDefaultAccountUpdate leaves unrelated services unchanged", () => {
  const gmail = app({ id: "gmail-1", isDefault: true, service: "gmail" })
  const slack = app({ id: "slack-1", isDefault: true, service: "slack" })
  const next = applyDefaultAccountUpdate(summary([gmail, slack]), "google_sheets", "sheets-1", null)

  assert.equal(next.apps.find((item) => item.id === "gmail-1")?.isDefault, true)
  assert.equal(next.apps.find((item) => item.id === "slack-1")?.isDefault, true)
})
