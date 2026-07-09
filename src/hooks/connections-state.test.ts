import type { ConnectionSummary, ConnectionWorkspace } from "../../electron/connections/common.ts"
import type { UserFacingError } from "../lib/user-facing-error.ts"

import assert from "node:assert/strict"
import { test } from "vitest"
import { connectionsStateReducer, initialConnectionsState } from "./connections-state.ts"

const error: UserFacingError = {
  area: "connections",
  descriptionKey: "error.connections.description",
  kind: "operation_failed",
  severity: "destructive",
  titleKey: "error.connections.title",
}

function summary(workspace: ConnectionWorkspace): ConnectionSummary {
  return {
    activeConnections: 0,
    apps: [],
    connectableProviderCount: 0,
    connectedProviderCount: 0,
    needsAttention: 0,
    message: undefined,
    providerCount: 0,
    providers: [],
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
    workspace,
  }
}

test("connectionsStateReducer keeps old summary hidden while workspace sync starts", () => {
  const previousSummary = summary({ type: "personal" })
  const loadedState = connectionsStateReducer(initialConnectionsState, {
    summary: previousSummary,
    type: "summarySet",
  })
  const next = connectionsStateReducer(
    {
      ...loadedState,
      actionError: error,
      agentScopeWorkspaceKey: "personal",
      scopeSyncError: error,
      summaryError: error,
    },
    { type: "workspaceSyncStarted" },
  )

  assert.equal(next.summary, previousSummary)
  assert.equal(next.summaryWorkspaceKey, null)
  assert.equal(next.agentScopeWorkspaceKey, null)
  assert.equal(next.busy, "refresh")
  assert.equal(next.actionError, null)
  assert.equal(next.summaryError, null)
  assert.equal(next.scopeSyncError, null)
})

test("connectionsStateReducer clears only refresh busy when refresh completes", () => {
  assert.equal(
    connectionsStateReducer({ ...initialConnectionsState, busy: "refresh" }, { type: "refreshFinished" }).busy,
    null,
  )
  assert.equal(
    connectionsStateReducer({ ...initialConnectionsState, busy: "connect" }, { type: "refreshFinished" }).busy,
    "connect",
  )
})

test("connectionsStateReducer records workspace sync failures as summary failures", () => {
  const previousSummary = summary({ type: "organization", organizationName: "org-a" })
  const next = connectionsStateReducer(
    {
      ...initialConnectionsState,
      busy: "refresh",
      summary: previousSummary,
      summaryWorkspaceKey: "organization:org-a",
    },
    { type: "workspaceScopeSyncFailed", error },
  )

  assert.equal(next.summary, null)
  assert.equal(next.summaryWorkspaceKey, null)
  assert.equal(next.summaryError, error)
  assert.equal(next.scopeSyncError, error)
  assert.equal(next.busy, null)
})

test("connectionsStateReducer clears hidden previous summaries when refresh fails for a new workspace", () => {
  const previousSummary = summary({ type: "personal" })
  const next = connectionsStateReducer(
    {
      ...initialConnectionsState,
      summary: previousSummary,
      summaryWorkspaceKey: null,
    },
    { type: "refreshFailed", error, workspaceKey: "organization:acme" },
  )

  assert.equal(next.summary, null)
  assert.equal(next.summaryError, error)
  assert.equal(next.summaryWorkspaceKey, "organization:acme")
})

test("connectionsStateReducer keeps current summaries visible when refresh fails for the same workspace", () => {
  const currentSummary = summary({ type: "organization", organizationName: "acme" })
  const next = connectionsStateReducer(
    {
      ...initialConnectionsState,
      summary: currentSummary,
      summaryWorkspaceKey: "organization:acme",
    },
    { type: "refreshFailed", error, workspaceKey: "organization:acme" },
  )

  assert.equal(next.summary, currentSummary)
  assert.equal(next.summaryError, error)
  assert.equal(next.summaryWorkspaceKey, "organization:acme")
})

test("connectionsStateReducer derives summary workspace keys consistently", () => {
  const personal = connectionsStateReducer(initialConnectionsState, {
    summary: summary({ type: "personal" }),
    type: "refreshSucceeded",
  })
  const organization = connectionsStateReducer(initialConnectionsState, {
    summary: summary({ type: "organization", organizationName: "acme" }),
    type: "summarySet",
  })

  assert.equal(personal.summaryWorkspaceKey, "personal")
  assert.equal(personal.summaryError, null)
  assert.equal(organization.summaryWorkspaceKey, "organization:acme")
})
