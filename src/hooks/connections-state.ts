import type { ConnectionSummary, ConnectionUsageSummary } from "../../electron/connections/common.ts"
import type { UserFacingError } from "../lib/user-facing-error.ts"

import { connectionWorkspaceKey } from "../lib/connection-workspace.ts"

export type ConnectionBusy = "connect" | "disconnect" | "refresh" | "update_alias" | null

export interface ConnectionsState {
  actionError: UserFacingError | null
  agentScopeWorkspaceKey: string | null
  busy: ConnectionBusy
  polling: string | null
  scopeSyncError: UserFacingError | null
  summary: ConnectionSummary | null
  summaryError: UserFacingError | null
  summaryWorkspaceKey: string | null
}

export type ConnectionsStateAction =
  | { type: "actionErrorSet"; error: UserFacingError | null }
  | { type: "busySet"; busy: ConnectionBusy }
  | { type: "pollingCancelled" }
  | { type: "pollingSet"; polling: string | null }
  | { type: "refreshFailed"; error: UserFacingError; workspaceKey: string }
  | { type: "refreshFinished" }
  | { type: "refreshStarted" }
  | { type: "refreshSucceeded"; summary: ConnectionSummary }
  | { type: "summarySet"; summary: ConnectionSummary }
  | { type: "usageHydrationFailed"; workspaceKey: string }
  | { type: "usageHydrated"; usage: ConnectionUsageSummary; workspaceKey: string }
  | { type: "workspacePending" }
  | { type: "workspaceScopeSyncFailed"; error: UserFacingError }
  | { type: "workspaceScopeSynced"; workspaceKey: string }
  | { type: "workspaceSyncStarted" }

export const initialConnectionsState: ConnectionsState = {
  actionError: null,
  agentScopeWorkspaceKey: null,
  busy: null,
  polling: null,
  scopeSyncError: null,
  summary: null,
  summaryError: null,
  summaryWorkspaceKey: null,
}

export function preserveConnectionSummaryOnPartialRefresh(
  current: ConnectionSummary | null,
  next: ConnectionSummary,
): ConnectionSummary {
  if (
    !current ||
    !next.appsStatus ||
    next.appsStatus === "ready" ||
    connectionSummaryWorkspaceKey(current) !== connectionSummaryWorkspaceKey(next)
  ) {
    return next
  }

  // Apps 读取失败不能把上一次确认可用的账号伪装成“全部未连接”；保留旧摘要并暴露本次降级状态。
  return {
    ...current,
    appsStatus: next.appsStatus,
    updatedAt: next.updatedAt,
    usageLoading: next.usageLoading,
  }
}

export function connectionsStateReducer(state: ConnectionsState, action: ConnectionsStateAction): ConnectionsState {
  switch (action.type) {
    case "actionErrorSet":
      return { ...state, actionError: action.error }
    case "busySet":
      return { ...state, busy: action.busy }
    case "pollingCancelled":
      return { ...state, busy: null, polling: null }
    case "pollingSet":
      return { ...state, polling: action.polling }
    case "refreshFailed":
      return {
        ...state,
        summary: state.summaryWorkspaceKey === action.workspaceKey ? state.summary : null,
        summaryError: action.error,
        summaryWorkspaceKey: action.workspaceKey,
      }
    case "refreshFinished":
      return { ...state, busy: state.busy === "refresh" ? null : state.busy }
    case "refreshStarted":
      return { ...state, busy: state.busy ?? "refresh" }
    case "refreshSucceeded":
    case "summarySet":
      return {
        ...state,
        summary: action.summary,
        summaryError: null,
        summaryWorkspaceKey: connectionSummaryWorkspaceKey(action.summary),
      }
    case "usageHydrated":
      if (!state.summary || state.summaryWorkspaceKey !== action.workspaceKey) {
        return state
      }
      return {
        ...state,
        summary: { ...state.summary, usage: action.usage, usageLoading: false },
      }
    case "usageHydrationFailed":
      if (!state.summary || state.summaryWorkspaceKey !== action.workspaceKey) {
        return state
      }
      return {
        ...state,
        summary: { ...state.summary, usageLoading: false },
      }
    case "workspacePending":
      return initialConnectionsState
    case "workspaceScopeSyncFailed":
      return {
        ...state,
        busy: state.busy === "refresh" ? null : state.busy,
        scopeSyncError: action.error,
        summary: null,
        summaryError: action.error,
        summaryWorkspaceKey: null,
      }
    case "workspaceScopeSynced":
      return { ...state, agentScopeWorkspaceKey: action.workspaceKey }
    case "workspaceSyncStarted":
      return {
        ...state,
        actionError: null,
        agentScopeWorkspaceKey: null,
        busy: "refresh",
        polling: null,
        scopeSyncError: null,
        summary: null,
        summaryError: null,
        summaryWorkspaceKey: null,
      }
  }
}

function connectionSummaryWorkspaceKey(summary: ConnectionSummary): string {
  return connectionWorkspaceKey(summary.workspace)
}
