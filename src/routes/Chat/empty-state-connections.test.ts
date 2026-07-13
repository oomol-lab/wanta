import type { ConnectionProvider } from "../../../electron/connections/common.ts"

import assert from "node:assert/strict"
import { test } from "vitest"
import { summarizeEmptyStateConnections } from "./empty-state-connections.ts"

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

test("summarizeEmptyStateConnections excludes connectionless no-auth providers", () => {
  const noAuth = provider("quickchart", "connected")
  noAuth.actionKind = "no_auth"
  noAuth.authTypes = ["no_auth"]

  assert.deepEqual(summarizeEmptyStateConnections([noAuth], 0), {
    availableCount: 0,
    needsAttentionCount: 0,
  })
})
