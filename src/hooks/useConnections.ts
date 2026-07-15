import type {
  ConnectionConnectInput,
  ConnectionAppDetail,
  ConnectionExecutionLogRequest,
  ConnectionExecutionLogSummary,
  ConnectionProviderDetail,
  ConnectionSummary,
  ConnectionSummaryRequest,
  ConnectionWorkspace,
} from "../../electron/connections/common.ts"
import type { ConnectionErrorOperation } from "../lib/connections-error.ts"
import type { UserFacingError } from "../lib/user-facing-error.ts"
import type { OAuthPendingOperation } from "./connection-oauth-pending.ts"
import type { ConnectionBusy } from "./connections-state.ts"

import * as React from "react"
import { useChatService } from "../components/AppContext.ts"
import { connectionWorkspaceKey } from "../lib/connection-workspace.ts"
import {
  connectProvider,
  disconnectAccount as disconnectAccountRequest,
  disconnectProvider as disconnectProviderRequest,
  getActiveConnectionAppIdsForService,
  getConnectionCatalogSummary,
  getConnectionAppDetail,
  getConnectionExecutionLogs,
  getConnectionProviderDetail,
  getConnectionSummary,
  getConnectionUsageSummary,
  isProviderConnectionActive,
  setDefaultAccount as setDefaultAccountRequest,
  startOAuthConnect,
  updateAlias as updateAliasRequest,
} from "../lib/connections-client.ts"
import { resolveConnectionError } from "../lib/connections-error.ts"
import {
  clearOAuthPendingOperation,
  createOAuthPendingOperation,
  createOAuthPendingKey,
  readOAuthPendingOperation,
  readOAuthPendingOperationsForWorkspace,
  rememberOAuthPendingOperation,
} from "./connection-oauth-pending.ts"
import { connectionsStateReducer, initialConnectionsState } from "./connections-state.ts"
import { applyDefaultAccountUpdate } from "./connections-summary-update.ts"
import { reportRendererHandledError } from "@/lib/renderer-diagnostics"

const POLL_INTERVAL_MS = 2000

interface PollOperation {
  controller: AbortController
  id: number
}

interface ConnectionActionContext {
  actionId: number
  currentWorkspace: ConnectionWorkspace
  isCurrent: () => boolean
}

interface ConnectionRefreshOptions {
  silent?: boolean
}

interface SummaryMutationOptions {
  busy: ConnectionBusy
  operation: ConnectionErrorOperation
  refreshLabel: string
  mutate: (workspace: ConnectionWorkspace) => Promise<void>
}

function wait(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    if (signal.aborted) {
      reject(signal.reason instanceof Error ? signal.reason : new DOMException("Aborted", "AbortError"))
      return
    }

    const onAbort = () => {
      clearTimeout(timer)
      reject(signal.reason instanceof Error ? signal.reason : new DOMException("Aborted", "AbortError"))
    }
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", onAbort)
      resolve()
    }, ms)
    signal.addEventListener("abort", onAbort, { once: true })
  })
}

function sameWorkspace(workspace: ConnectionWorkspace | null, key: string): boolean {
  return workspace ? connectionWorkspaceKey(workspace) === key : key === "pending"
}

function isOAuthOperationConnectedFromActiveAppIds(
  activeAppIds: readonly string[],
  operation: OAuthPendingOperation,
): boolean {
  if (operation.appId) {
    return activeAppIds.includes(operation.appId)
  }
  if (operation.existingActiveAppIds) {
    return activeAppIds.some((appId) => !operation.existingActiveAppIds?.includes(appId))
  }
  return activeAppIds.length > 0
}

export interface UseConnections {
  summary: ConnectionSummary | null
  summaryWorkspaceKey: string | null
  agentScopeWorkspaceKey: string | null
  busy: ConnectionBusy
  polling: string | null
  actionError: UserFacingError | null
  summaryError: UserFacingError | null
  scopeSyncError: UserFacingError | null
  clearActionError: () => void
  refresh: (request?: ConnectionSummaryRequest, options?: ConnectionRefreshOptions) => Promise<ConnectionSummary | null>
  connect: (input: ConnectionConnectInput) => Promise<boolean>
  disconnect: (service: string) => Promise<boolean>
  disconnectAccount: (appId: string) => Promise<boolean>
  cancelPolling: () => void
  getProviderDetail: (service: string) => Promise<ConnectionProviderDetail>
  getAppDetail: (appId: string) => Promise<ConnectionAppDetail>
  getExecutionLogs: (request: ConnectionExecutionLogRequest) => Promise<ConnectionExecutionLogSummary>
  isProviderActive: (service: string) => Promise<boolean>
  openExternal: (url: string) => Promise<void>
  setDefaultAccount: (service: string, appId: string) => Promise<boolean>
  setSummary: (summary: ConnectionSummary) => void
  updateAlias: (appId: string, alias: string) => Promise<boolean>
}

/** workspace 由 useOrganizationWorkspace 提供。null 表示组织已选但名称尚未就绪，此时暂停连接器请求。 */
export function useConnections(workspace: ConnectionWorkspace | null): UseConnections {
  const chatService = useChatService()
  const [state, dispatch] = React.useReducer(connectionsStateReducer, initialConnectionsState)
  const {
    actionError,
    agentScopeWorkspaceKey,
    busy,
    polling,
    scopeSyncError,
    summary,
    summaryError,
    summaryWorkspaceKey,
  } = state
  const pollAbort = React.useRef<PollOperation | null>(null)
  const oauthPending = React.useRef<OAuthPendingOperation | null>(null)
  const pollSequence = React.useRef(0)
  const oauthSequence = React.useRef(0)
  const actionSequence = React.useRef(0)
  const effectiveWorkspace = React.useRef<ConnectionWorkspace | null>(workspace)
  const workspaceGeneration = React.useRef(0)
  const summaryRequestSequence = React.useRef(0)
  const visibleSummaryRequestSequence = React.useRef(0)
  const summaryRef = React.useRef<ConnectionSummary | null>(summary)
  effectiveWorkspace.current = workspace
  summaryRef.current = summary

  const setCurrentSummary = React.useCallback((next: ConnectionSummary): void => {
    dispatch({ type: "summarySet", summary: next })
  }, [])

  const isCurrentWorkspace = React.useCallback((generation: number, key: string): boolean => {
    return workspaceGeneration.current === generation && sameWorkspace(effectiveWorkspace.current, key)
  }, [])

  const invalidateWorkspaceWork = React.useCallback((): void => {
    workspaceGeneration.current += 1
    summaryRequestSequence.current += 1
    visibleSummaryRequestSequence.current += 1
    actionSequence.current += 1
    pollSequence.current += 1
    pollAbort.current?.controller.abort()
    oauthPending.current = null
    pollAbort.current = null
  }, [])

  const beginAction = React.useCallback((): ConnectionActionContext | null => {
    const currentWorkspace = effectiveWorkspace.current
    if (!currentWorkspace) {
      return null
    }
    const generation = workspaceGeneration.current
    const key = connectionWorkspaceKey(currentWorkspace)
    const actionId = actionSequence.current + 1
    actionSequence.current = actionId
    summaryRequestSequence.current += 1
    return {
      actionId,
      currentWorkspace,
      isCurrent: () => actionSequence.current === actionId && isCurrentWorkspace(generation, key),
    }
  }, [isCurrentWorkspace])

  const refresh = React.useCallback(
    async (
      request?: ConnectionSummaryRequest,
      options: ConnectionRefreshOptions = {},
    ): Promise<ConnectionSummary | null> => {
      const currentWorkspace = effectiveWorkspace.current
      if (!currentWorkspace) {
        dispatch({ type: "workspacePending" })
        return null
      }
      const requestId = summaryRequestSequence.current + 1
      summaryRequestSequence.current = requestId
      const generation = workspaceGeneration.current
      const key = connectionWorkspaceKey(currentWorkspace)
      const connectorReadOptions = {
        ...request,
        refreshGeneration: `summary:${key}:${requestId}`,
      }
      const visibleRefresh = !options.silent || summaryRef.current === null
      if (visibleRefresh) {
        visibleSummaryRequestSequence.current = requestId
        dispatch({ type: "refreshStarted" })
      }
      try {
        // 创建时立即吸收失败，避免目录读取失败或工作区切换后留下未处理 rejection。
        const usageRequest = getConnectionUsageSummary(currentWorkspace, connectorReadOptions).then(
          (usage) => ({ ok: true as const, usage }),
          (error: unknown) => ({ error, ok: false as const }),
        )
        const next = await getConnectionCatalogSummary(currentWorkspace, connectorReadOptions)
        if (summaryRequestSequence.current === requestId && isCurrentWorkspace(generation, key)) {
          dispatch({ type: "refreshSucceeded", summary: next })
          void usageRequest.then((result) => {
            if (summaryRequestSequence.current === requestId && isCurrentWorkspace(generation, key)) {
              if (result.ok) {
                dispatch({ type: "usageHydrated", usage: result.usage, workspaceKey: key })
              } else {
                reportRendererHandledError("connections", "background connection usage request failed", result.error)
                dispatch({ type: "usageHydrationFailed", workspaceKey: key })
              }
            }
          })
        }
        return next
      } catch (err) {
        if (summaryRequestSequence.current === requestId && isCurrentWorkspace(generation, key)) {
          if (visibleRefresh) {
            dispatch({ type: "refreshFailed", error: resolveConnectionError(err, "summary"), workspaceKey: key })
          }
        }
        return null
      } finally {
        if (
          visibleRefresh &&
          visibleSummaryRequestSequence.current === requestId &&
          isCurrentWorkspace(generation, key)
        ) {
          dispatch({ type: "refreshFinished" })
        }
      }
    },
    [isCurrentWorkspace],
  )

  const activateOAuthPending = React.useCallback((operation: OAuthPendingOperation): OAuthPendingOperation => {
    const actionId = oauthSequence.current + 1
    oauthSequence.current = actionId
    const active = { ...operation, actionId }
    oauthPending.current = active
    rememberOAuthPendingOperation(active)
    return active
  }, [])

  const clearActiveOAuthPending = React.useCallback((operation: OAuthPendingOperation): void => {
    if (oauthPending.current?.key === operation.key && oauthPending.current.actionId === operation.actionId) {
      oauthPending.current = null
    }
    clearOAuthPendingOperation(operation.key)
  }, [])

  const pollOAuthPending = React.useCallback(
    async (
      operation: OAuthPendingOperation,
      currentWorkspace: ConnectionWorkspace,
      errorOperation: "connect" | "reconnect",
    ): Promise<boolean> => {
      const generation = workspaceGeneration.current
      const workspaceKey = connectionWorkspaceKey(currentWorkspace)
      const abort = new AbortController()
      const pollId = pollSequence.current + 1
      pollSequence.current = pollId
      pollAbort.current?.controller.abort()
      pollAbort.current = { controller: abort, id: pollId }

      const isCurrentOAuth = (): boolean => {
        return (
          oauthPending.current?.key === operation.key &&
          oauthPending.current.actionId === operation.actionId &&
          isCurrentWorkspace(generation, workspaceKey)
        )
      }

      dispatch({ type: "pollingSet", polling: operation.pollingKey })
      dispatch({ type: "busySet", busy: null })
      try {
        while (Date.now() < operation.expiresAt) {
          await wait(POLL_INTERVAL_MS, abort.signal)
          if (!isCurrentOAuth()) {
            return false
          }
          const activeAppIds = await getActiveConnectionAppIdsForService(operation.service, currentWorkspace)
          if (!isCurrentOAuth()) {
            return false
          }
          if (isOAuthOperationConnectedFromActiveAppIds(activeAppIds, operation)) {
            const next = await getConnectionSummary(currentWorkspace, {
              forceRefresh: true,
              refreshGeneration: `oauth-complete:${operation.key}:${operation.actionId}`,
            })
            if (!isCurrentOAuth()) {
              return false
            }
            setCurrentSummary(next)
            dispatch({ type: "actionErrorSet", error: null })
            clearActiveOAuthPending(operation)
            dispatch({ type: "pollingSet", polling: null })
            return true
          }
        }

        if (isCurrentOAuth()) {
          dispatch({ type: "actionErrorSet", error: resolveConnectionError("WANTA_OAUTH_PENDING", errorOperation) })
          clearActiveOAuthPending(operation)
          dispatch({ type: "pollingSet", polling: null })
        }
        return false
      } catch (err) {
        if (!isCurrentOAuth()) {
          return false
        }
        if (err instanceof DOMException && err.name === "AbortError") {
          dispatch({
            type: "actionErrorSet",
            error: resolveConnectionError("WANTA_OAUTH_CANCELLED", errorOperation),
          })
        } else {
          dispatch({ type: "actionErrorSet", error: resolveConnectionError(err, errorOperation) })
        }
        clearActiveOAuthPending(operation)
        dispatch({ type: "pollingSet", polling: null })
        return false
      } finally {
        if (pollAbort.current?.id === pollId) {
          pollAbort.current = null
        }
      }
    },
    [clearActiveOAuthPending, isCurrentWorkspace, setCurrentSummary],
  )

  // workspace 变化（含首帧）：同步 agent 组织作用域 + 重拉摘要。
  const appliedWorkspaceKey = React.useRef<string | null>(null)
  React.useEffect(() => {
    if (!workspace) {
      if (appliedWorkspaceKey.current === "pending") {
        return
      }
      appliedWorkspaceKey.current = "pending"
      invalidateWorkspaceWork()
      dispatch({ type: "workspacePending" })
      return
    }
    const key = connectionWorkspaceKey(workspace)
    if (appliedWorkspaceKey.current === key) {
      return
    }
    appliedWorkspaceKey.current = key
    invalidateWorkspaceWork()
    dispatch({ type: "workspaceSyncStarted" })
    const organizationName = workspace.organizationName
    const generation = workspaceGeneration.current
    void (async () => {
      try {
        await chatService.invoke("setAgentOrganization", { organizationName })
        if (!isCurrentWorkspace(generation, key)) {
          return
        }
        dispatch({ type: "workspaceScopeSynced", workspaceKey: key })
        void refresh({ forceRefresh: true })
      } catch (error) {
        if (!isCurrentWorkspace(generation, key)) {
          return
        }
        const resolved = resolveConnectionError(error, "summary")
        reportRendererHandledError("connections", "agent organization scope sync failed", error)
        dispatch({ type: "workspaceScopeSyncFailed", error: resolved })
      }
    })()
  }, [chatService, invalidateWorkspaceWork, isCurrentWorkspace, refresh, workspace])

  React.useEffect(
    () => () => {
      pollAbort.current?.controller.abort()
      oauthPending.current = null
    },
    [],
  )

  React.useEffect(() => {
    if (!workspace || pollAbort.current) {
      return
    }
    const pending = readOAuthPendingOperationsForWorkspace(workspace)[0]
    if (!pending) {
      return
    }
    const active = oauthPending.current?.key === pending.key ? oauthPending.current : activateOAuthPending(pending)
    dispatch({ type: "actionErrorSet", error: null })
    dispatch({ type: "pollingSet", polling: active.pollingKey })
    void pollOAuthPending(active, workspace, active.appId ? "reconnect" : "connect")
  }, [activateOAuthPending, pollOAuthPending, workspace])

  const connect = React.useCallback(
    async (input: ConnectionConnectInput): Promise<boolean> => {
      const operation = "appId" in input && input.appId ? "reconnect" : "connect"
      const currentWorkspace = effectiveWorkspace.current
      if (!currentWorkspace) {
        dispatch({ type: "actionErrorSet", error: resolveConnectionError("Workspace is still loading.", operation) })
        return false
      }

      if (input.authType === "oauth2") {
        const duplicateOAuthKey = createOAuthPendingKey(currentWorkspace, input)
        const pending = readOAuthPendingOperation(duplicateOAuthKey)
        if (pending) {
          const active =
            oauthPending.current?.key === pending.key ? oauthPending.current : activateOAuthPending(pending)
          dispatch({ type: "actionErrorSet", error: null })
          dispatch({ type: "pollingSet", polling: active.pollingKey })
          if (!pollAbort.current) {
            void pollOAuthPending(active, currentWorkspace, "appId" in input && input.appId ? "reconnect" : "connect")
          }
          return false
        }
      }

      const action = beginAction()
      if (!action) {
        dispatch({ type: "actionErrorSet", error: resolveConnectionError("Workspace is still loading.", operation) })
        return false
      }
      const { actionId } = action
      const isCurrentAction = action.isCurrent
      const applySummary = (next: ConnectionSummary): void => {
        if (isCurrentAction()) {
          setCurrentSummary(next)
        }
      }
      const applyActionError = (error: UserFacingError): void => {
        if (isCurrentAction()) {
          dispatch({ type: "actionErrorSet", error })
        }
      }
      const applyBusy = (next: ConnectionBusy): void => {
        if (isCurrentAction()) {
          dispatch({ type: "busySet", busy: next })
        }
      }
      const applyPolling = (next: string | null): void => {
        if (isCurrentAction()) {
          dispatch({ type: "pollingSet", polling: next })
        }
      }
      dispatch({ type: "actionErrorSet", error: null })
      dispatch({ type: "busySet", busy: "connect" })
      let startedOAuthPending: OAuthPendingOperation | null = null
      try {
        if (input.authType !== "oauth2") {
          await connectProvider(input, currentWorkspace)
          applySummary(
            await getConnectionSummary(currentWorkspace, {
              forceRefresh: true,
              refreshGeneration: `connect:${connectionWorkspaceKey(currentWorkspace)}:${action.actionId}`,
            }),
          )
          return isCurrentAction()
        }

        // oauth2：建立“当前服务已有连接”的最小基线即可；不为此阻塞性重拉 Provider 目录和用量统计。
        const existingActiveAppIds = await getActiveConnectionAppIdsForService(input.service, currentWorkspace)
        if (!isCurrentAction()) {
          return false
        }
        const pending = createOAuthPendingOperation(
          action.currentWorkspace,
          input,
          actionId,
          Date.now(),
          existingActiveAppIds,
        )
        startedOAuthPending = pending
        oauthPending.current = pending
        rememberOAuthPendingOperation(pending)
        applyPolling(pending.pollingKey)
        const isCurrentOAuthStart = (): boolean => {
          return (
            oauthPending.current?.key === pending.key &&
            oauthPending.current.actionId === pending.actionId &&
            isCurrentAction()
          )
        }
        const { authorizationUrl } = await startOAuthConnect(input, action.currentWorkspace)
        if (!isCurrentOAuthStart()) {
          return false
        }
        await chatService.invoke("openExternalUrl", { url: authorizationUrl })
        if (!isCurrentOAuthStart()) {
          return false
        }

        return await pollOAuthPending(pending, action.currentWorkspace, operation)
      } catch (err) {
        if (err instanceof DOMException && err.name === "AbortError") {
          applyActionError(resolveConnectionError("WANTA_OAUTH_CANCELLED", operation))
          return false
        }
        if (
          startedOAuthPending &&
          oauthPending.current?.key === startedOAuthPending.key &&
          oauthPending.current.actionId === startedOAuthPending.actionId
        ) {
          clearActiveOAuthPending(startedOAuthPending)
          applyPolling(null)
        }
        applyActionError(resolveConnectionError(err, operation))
        return false
      } finally {
        applyBusy(null)
      }
    },
    [activateOAuthPending, beginAction, chatService, clearActiveOAuthPending, pollOAuthPending, setCurrentSummary],
  )

  const runSummaryMutation = React.useCallback(
    async ({ busy: actionBusy, operation, refreshLabel, mutate }: SummaryMutationOptions): Promise<boolean> => {
      const action = beginAction()
      if (!action) {
        dispatch({
          type: "actionErrorSet",
          error: resolveConnectionError("Workspace is still loading.", operation),
        })
        return false
      }
      const isCurrentAction = action.isCurrent
      dispatch({ type: "actionErrorSet", error: null })
      dispatch({ type: "busySet", busy: actionBusy })
      try {
        await mutate(action.currentWorkspace)
        const next = await getConnectionSummary(action.currentWorkspace, {
          forceRefresh: true,
          refreshGeneration: `${refreshLabel}:${connectionWorkspaceKey(action.currentWorkspace)}:${action.actionId}`,
        })
        if (isCurrentAction()) {
          setCurrentSummary(next)
        }
        return isCurrentAction()
      } catch (err) {
        if (isCurrentAction()) {
          dispatch({ type: "actionErrorSet", error: resolveConnectionError(err, operation) })
        }
        return false
      } finally {
        if (isCurrentAction()) {
          dispatch({ type: "busySet", busy: null })
        }
      }
    },
    [beginAction, setCurrentSummary],
  )

  const disconnect = React.useCallback(
    async (svc: string): Promise<boolean> =>
      runSummaryMutation({
        busy: "disconnect",
        operation: "disconnect",
        refreshLabel: "disconnect",
        mutate: (currentWorkspace) => disconnectProviderRequest(svc, currentWorkspace),
      }),
    [runSummaryMutation],
  )

  const disconnectAccount = React.useCallback(
    async (appId: string): Promise<boolean> =>
      runSummaryMutation({
        busy: "disconnect",
        operation: "disconnect",
        refreshLabel: "disconnect",
        mutate: (currentWorkspace) => disconnectAccountRequest(appId, currentWorkspace),
      }),
    [runSummaryMutation],
  )

  const setDefaultAccount = React.useCallback(
    async (svc: string, appId: string): Promise<boolean> => {
      const action = beginAction()
      if (!action) {
        dispatch({
          type: "actionErrorSet",
          error: resolveConnectionError("Workspace is still loading.", "set_default"),
        })
        return false
      }
      const isCurrentAction = action.isCurrent
      dispatch({ type: "actionErrorSet", error: null })
      dispatch({ type: "busySet", busy: "set_default" })
      try {
        const updatedApp = await setDefaultAccountRequest(svc, appId, action.currentWorkspace)
        if (isCurrentAction() && summaryRef.current) {
          setCurrentSummary(applyDefaultAccountUpdate(summaryRef.current, svc, appId, updatedApp))
        }
        const next = await getConnectionSummary(action.currentWorkspace, {
          forceRefresh: true,
          refreshGeneration: `set-default:${connectionWorkspaceKey(action.currentWorkspace)}:${action.actionId}`,
        })
        if (isCurrentAction()) {
          setCurrentSummary(applyDefaultAccountUpdate(next, svc, appId, updatedApp))
        }
        return isCurrentAction()
      } catch (err) {
        if (isCurrentAction()) {
          dispatch({ type: "actionErrorSet", error: resolveConnectionError(err, "set_default") })
        }
        return false
      } finally {
        if (isCurrentAction()) {
          dispatch({ type: "busySet", busy: null })
        }
      }
    },
    [beginAction, setCurrentSummary],
  )

  const updateAlias = React.useCallback(
    async (appId: string, alias: string): Promise<boolean> =>
      runSummaryMutation({
        busy: "update_alias",
        operation: "update_alias",
        refreshLabel: "update-alias",
        mutate: (currentWorkspace) => updateAliasRequest(appId, alias, currentWorkspace),
      }),
    [runSummaryMutation],
  )

  const cancelPolling = React.useCallback(() => {
    actionSequence.current += 1
    oauthSequence.current += 1
    pollSequence.current += 1
    if (oauthPending.current) {
      clearOAuthPendingOperation(oauthPending.current.key)
    }
    pollAbort.current?.controller.abort()
    oauthPending.current = null
    pollAbort.current = null
    dispatch({ type: "pollingCancelled" })
  }, [])
  const clearActionError = React.useCallback(() => dispatch({ type: "actionErrorSet", error: null }), [])

  const getProviderDetail = React.useCallback((svc: string) => {
    const currentWorkspace = effectiveWorkspace.current
    if (!currentWorkspace) {
      return Promise.reject(new Error("Workspace is still loading."))
    }
    return getConnectionProviderDetail(svc, currentWorkspace)
  }, [])
  const getAppDetail = React.useCallback((appId: string) => {
    const currentWorkspace = effectiveWorkspace.current
    if (!currentWorkspace) {
      return Promise.reject(new Error("Workspace is still loading."))
    }
    return getConnectionAppDetail(appId, currentWorkspace)
  }, [])
  const getExecutionLogs = React.useCallback((request: ConnectionExecutionLogRequest) => {
    const currentWorkspace = effectiveWorkspace.current
    if (!currentWorkspace) {
      return Promise.reject(new Error("Workspace is still loading."))
    }
    return getConnectionExecutionLogs(request, currentWorkspace)
  }, [])
  const isProviderActive = React.useCallback((service: string) => {
    const currentWorkspace = effectiveWorkspace.current
    if (!currentWorkspace) {
      return Promise.resolve(false)
    }
    return isProviderConnectionActive(service, currentWorkspace)
  }, [])
  const openExternal = React.useCallback((url: string) => chatService.invoke("openExternalUrl", { url }), [chatService])

  return {
    summary,
    summaryWorkspaceKey,
    busy,
    polling,
    actionError,
    agentScopeWorkspaceKey,
    summaryError,
    scopeSyncError,
    clearActionError,
    refresh,
    connect,
    disconnect,
    disconnectAccount,
    cancelPolling,
    getProviderDetail,
    getAppDetail,
    getExecutionLogs,
    isProviderActive,
    openExternal,
    setDefaultAccount,
    setSummary: setCurrentSummary,
    updateAlias,
  }
}
