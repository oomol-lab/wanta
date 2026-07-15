import type { ConnectionProvider } from "../../../electron/connections/common.ts"

import assert from "node:assert/strict"
import { test } from "vitest"
import { resolveCurrentToolsPresentation, summarizeEmptyStateConnections } from "./empty-state-connections.ts"

function provider(service: string, status: ConnectionProvider["status"]): ConnectionProvider {
  return {
    actionKind: "oauth2",
    appCount: 0,
    apps: [],
    authTypes: ["oauth2"],
    canDisconnect: false,
    categoryLabels: [],
    displayName: service,
    service,
    status,
  }
}

test("summarizeEmptyStateConnections separates usable and attention providers", () => {
  assert.deepEqual(
    summarizeEmptyStateConnections(
      [
        provider("gmail", "connected"),
        provider("github", "connected"),
        provider("notion", "needs_attention"),
        provider("slack", "available"),
      ],
      3,
    ),
    { availableCount: 2, needsAttentionCount: 1 },
  )
})

test("summarizeEmptyStateConnections counts provider types instead of accounts", () => {
  const gmail = provider("gmail", "connected")
  gmail.appCount = 2

  assert.deepEqual(summarizeEmptyStateConnections([gmail], 1), { availableCount: 1, needsAttentionCount: 0 })
})

test("summarizeEmptyStateConnections preserves a larger backend provider total", () => {
  assert.deepEqual(summarizeEmptyStateConnections([provider("notion", "needs_attention")], 10), {
    availableCount: 9,
    needsAttentionCount: 1,
  })
})

test("summarizeEmptyStateConnections includes connectionless no-auth providers as available tools", () => {
  const noAuth = provider("quickchart", "connected")
  noAuth.actionKind = "api_key"
  noAuth.authTypes = ["no_auth", "api_key"]

  assert.deepEqual(summarizeEmptyStateConnections([noAuth], 0), {
    availableCount: 1,
    needsAttentionCount: 0,
  })
})

test("summarizeEmptyStateConnections excludes connectionless no-auth providers that need attention", () => {
  const noAuth = provider("quickchart", "needs_attention")
  noAuth.actionKind = "api_key"
  noAuth.authTypes = ["no_auth", "api_key"]

  assert.deepEqual(summarizeEmptyStateConnections([noAuth], 0), {
    availableCount: 0,
    needsAttentionCount: 0,
  })
})

test("resolveCurrentToolsPresentation keeps organization issue copy and action aligned", () => {
  assert.deepEqual(resolveCurrentToolsPresentation({ availableCount: 2, needsAttentionCount: 1 }), {
    actionKey: "chat.emptyCurrentConnectorsCheckAction",
    ariaLabelKey: "chat.emptySharedConnectorsAttentionAria",
    highlighted: true,
    targetFilter: { kind: "attention" },
    meta: {
      key: "chat.emptyCurrentConnectorsAttentionMeta",
      vars: { available: 2, attention: 1 },
    },
    titleKey: "chat.emptySharedConnectorsTitle",
  })
})

test("resolveCurrentToolsPresentation covers organization tool and empty states", () => {
  assert.equal(
    resolveCurrentToolsPresentation({ availableCount: 2, needsAttentionCount: 0 }).actionKey,
    "chat.emptySharedConnectorsAction",
  )
  assert.deepEqual(resolveCurrentToolsPresentation({ availableCount: 2, needsAttentionCount: 0 }).targetFilter, {
    kind: "available-tools",
  })
  assert.deepEqual(resolveCurrentToolsPresentation({ availableCount: 0, needsAttentionCount: 0 }).targetFilter, {
    kind: "all",
  })
  assert.equal(resolveCurrentToolsPresentation(null).meta.key, "chat.emptyCurrentConnectorsUnavailableMeta")
  assert.equal(resolveCurrentToolsPresentation(undefined).meta.key, "chat.emptyCurrentConnectorsLoadingMeta")
})
