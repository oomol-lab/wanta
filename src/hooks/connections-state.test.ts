import type { ConnectionSummary, ConnectionWorkspace } from "../../electron/connections/common.ts"
import type { UserFacingError } from "../lib/user-facing-error.ts"

import assert from "node:assert/strict"
import { test } from "vitest"
import {
  connectionsStateReducer,
  initialConnectionsState,
  preserveConnectionSummaryOnPartialRefresh,
} from "./connections-state.ts"

const error: UserFacingError = {
  area: "connections",
  descriptionKey: "error.connections.description",
  kind: "operation_failed",
  severity: "destructive",
  titleKey: "error.connections.title",
}

function summary(workspace: ConnectionWorkspace): ConnectionSummary {
  return {
    apps: [],
    connectedProviderCount: 0,
    providerCount: 0,
    providers: [],
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
    usageStatus: "ready",
    workspace,
  }
}

test("connectionsStateReducer clears old summary while workspace sync starts", () => {
  const previousSummary = summary({ teamName: "team-name" })
  const loadedState = connectionsStateReducer(initialConnectionsState, {
    summary: previousSummary,
    type: "summarySet",
  })
  const next = connectionsStateReducer(
    {
      ...loadedState,
      actionError: error,
      agentScopeWorkspaceKey: "team:team-name",
      scopeSyncError: error,
      summaryError: error,
    },
    { type: "workspaceSyncStarted" },
  )

  assert.equal(next.summary, null)
  assert.equal(next.summaryWorkspaceKey, null)
  assert.equal(next.agentScopeWorkspaceKey, null)
  assert.equal(next.busy, "refresh")
  assert.equal(next.actionError, null)
  assert.equal(next.summaryError, null)
  assert.equal(next.scopeSyncError, null)
})

test("partial app refresh keeps confirmed connections for the same workspace", () => {
  const current = {
    ...summary({ teamName: "acme" }),
    apps: [
      {
        authType: "oauth2" as const,
        createdAt: 0,
        id: "app-1",
        isDefault: true,
        service: "gmail",
        status: "active" as const,
        updatedAt: 0,
      },
    ],
    connectedProviderCount: 1,
  }
  const next = {
    ...summary({ teamName: "acme" }),
    appsStatus: "unavailable" as const,
    updatedAt: "2026-07-17T00:00:00.000Z",
    usageStatus: "loading" as const,
  }

  assert.deepEqual(preserveConnectionSummaryOnPartialRefresh(current, next), {
    ...current,
    appsStatus: "unavailable",
    updatedAt: next.updatedAt,
    usageStatus: "loading",
  })
})

test("partial app refresh does not reuse data from another workspace", () => {
  const current = summary({ teamName: "old-team" })
  const next = { ...summary({ teamName: "new-team" }), appsStatus: "forbidden" as const }

  assert.equal(preserveConnectionSummaryOnPartialRefresh(current, next), next)
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
  assert.equal(
    connectionsStateReducer({ ...initialConnectionsState, busy: "update_alias" }, { type: "refreshFinished" }).busy,
    "update_alias",
  )
})

test("connectionsStateReducer starts refresh without replacing active actions", () => {
  assert.equal(connectionsStateReducer(initialConnectionsState, { type: "refreshStarted" }).busy, "refresh")
  assert.equal(
    connectionsStateReducer({ ...initialConnectionsState, busy: "connect" }, { type: "refreshStarted" }).busy,
    "connect",
  )
  assert.equal(
    connectionsStateReducer({ ...initialConnectionsState, busy: "disconnect" }, { type: "refreshStarted" }).busy,
    "disconnect",
  )
  assert.equal(
    connectionsStateReducer({ ...initialConnectionsState, busy: "update_alias" }, { type: "refreshStarted" }).busy,
    "update_alias",
  )
})

test("connectionsStateReducer resets state while workspace is pending", () => {
  const next = connectionsStateReducer(
    {
      ...initialConnectionsState,
      actionError: error,
      busy: "connect",
      polling: "provider",
      summary: summary({ teamName: "team-name" }),
      summaryError: error,
      summaryWorkspaceKey: "team:team-name",
    },
    { type: "workspacePending" },
  )

  assert.deepEqual(next, initialConnectionsState)
})

test("connectionsStateReducer records workspace sync failures as summary failures", () => {
  const previousSummary = summary({ teamName: "team-a" })
  const next = connectionsStateReducer(
    {
      ...initialConnectionsState,
      busy: "refresh",
      summary: previousSummary,
      summaryWorkspaceKey: "team:team-a",
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
  const previousSummary = summary({ teamName: "team-name" })
  const next = connectionsStateReducer(
    {
      ...initialConnectionsState,
      summary: previousSummary,
      summaryWorkspaceKey: null,
    },
    { type: "refreshFailed", error, workspaceKey: "team:acme" },
  )

  assert.equal(next.summary, null)
  assert.equal(next.summaryError, error)
  assert.equal(next.summaryWorkspaceKey, "team:acme")
})

test("connectionsStateReducer keeps current summaries visible when refresh fails for the same workspace", () => {
  const currentSummary = summary({ teamName: "acme" })
  const next = connectionsStateReducer(
    {
      ...initialConnectionsState,
      summary: currentSummary,
      summaryWorkspaceKey: "team:acme",
    },
    { type: "refreshFailed", error, workspaceKey: "team:acme" },
  )

  assert.equal(next.summary, currentSummary)
  assert.equal(next.summaryError, error)
  assert.equal(next.summaryWorkspaceKey, "team:acme")
})

test("connectionsStateReducer updates action busy and polling state", () => {
  const busy = connectionsStateReducer(initialConnectionsState, { type: "busySet", busy: "disconnect" })
  const polling = connectionsStateReducer(busy, { type: "pollingSet", polling: "provider" })
  const failed = connectionsStateReducer(polling, { type: "actionErrorSet", error })
  const cancelled = connectionsStateReducer(failed, { type: "pollingCancelled" })

  assert.equal(failed.busy, "disconnect")
  assert.equal(failed.polling, "provider")
  assert.equal(failed.actionError, error)
  assert.equal(cancelled.busy, null)
  assert.equal(cancelled.polling, null)
  assert.equal(cancelled.actionError, error)
})

test("connectionsStateReducer records synced workspace scope", () => {
  const next = connectionsStateReducer(initialConnectionsState, {
    type: "workspaceScopeSynced",
    workspaceKey: "team:acme",
  })

  assert.equal(next.agentScopeWorkspaceKey, "team:acme")
})

test("connectionsStateReducer derives summary workspace keys consistently", () => {
  const teamName = connectionsStateReducer(initialConnectionsState, {
    summary: summary({ teamName: "team-name" }),
    type: "refreshSucceeded",
  })
  const team = connectionsStateReducer(
    { ...initialConnectionsState, summaryError: error },
    {
      summary: summary({ teamName: "acme" }),
      type: "summarySet",
    },
  )

  assert.equal(teamName.summaryWorkspaceKey, "team:team-name")
  assert.equal(teamName.summaryError, null)
  assert.equal(team.summaryWorkspaceKey, "team:acme")
  assert.equal(team.summaryError, null)
})

test("connectionsStateReducer hydrates usage only for the active workspace", () => {
  const currentSummary = summary({ teamName: "team-name" })
  const loaded = connectionsStateReducer(initialConnectionsState, { summary: currentSummary, type: "summarySet" })
  const usage = {
    calls: 3,
    days: 7,
    errors: 1,
    points: [{ calls: 3, date: "2026-07-10", errors: 1, success: 2 }],
    recent: { calls: 3, date: "2026-07-10", errors: 1, success: 2 },
    services: [],
    success: 2,
  }

  const ignored = connectionsStateReducer(loaded, {
    type: "usageHydrated",
    usage,
    workspaceKey: "team:other",
  })
  const hydrated = connectionsStateReducer(loaded, {
    type: "usageHydrated",
    usage,
    workspaceKey: "team:team-name",
  })

  assert.equal(ignored, loaded)
  assert.equal(hydrated.summary?.usage.calls, 3)
  assert.equal(hydrated.summary?.usageStatus, "ready")
})

test("connectionsStateReducer clears usage loading when background hydration fails", () => {
  const loaded = connectionsStateReducer(initialConnectionsState, {
    summary: { ...summary({ teamName: "team-name" }), usageStatus: "loading" },
    type: "summarySet",
  })

  const failed = connectionsStateReducer(loaded, {
    type: "usageHydrationFailed",
    workspaceKey: "team:team-name",
  })

  assert.equal(failed.summary?.usageStatus, "unavailable")
})
