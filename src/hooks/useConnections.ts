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
import type { UserFacingError } from "../lib/user-facing-error.ts"
import type { OAuthPendingOperation } from "./connection-oauth-pending.ts"

import * as React from "react"
import { useChatService } from "../components/AppContext.ts"
import {
  connectProvider,
  disconnectAccount as disconnectAccountRequest,
  disconnectProvider as disconnectProviderRequest,
  getConnectionAppDetail,
  getConnectionExecutionLogs,
  getConnectionProviderDetail,
  getConnectionSummary,
  setDefaultAccount as setDefaultAccountRequest,
  startOAuthConnect,
  updateAlias as updateAliasRequest,
} from "../lib/connections-client.ts"
import { resolveConnectionError } from "../lib/connections-error.ts"
import {
  clearOAuthPendingOperation,
  connectionWorkspaceKey,
  createOAuthPendingOperation,
  createOAuthPendingKey,
  readOAuthPendingOperation,
  readOAuthPendingOperationsForWorkspace,
  rememberOAuthPendingOperation,
} from "./connection-oauth-pending.ts"
import { reportRendererHandledError } from "@/lib/renderer-diagnostics"

const POLL_INTERVAL_MS = 2000

interface PollOperation {
  controller: AbortController
  id: number
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

function activeAppIdsForService(summary: ConnectionSummary | null, service: string): string[] {
  return (
    summary?.apps
      .filter((app) => app.service === service && app.status === "active")
      .map((app) => app.id)
      .filter(Boolean) ?? []
  )
}

function isOAuthOperationConnected(next: ConnectionSummary, operation: OAuthPendingOperation): boolean {
  const activeAppIds = activeAppIdsForService(next, operation.service)
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
  busy: "connect" | "disconnect" | "refresh" | null
  polling: string | null
  actionError: UserFacingError | null
  summaryError: UserFacingError | null
  clearActionError: () => void
  refresh: (request?: ConnectionSummaryRequest) => Promise<ConnectionSummary | null>
  connect: (input: ConnectionConnectInput) => Promise<boolean>
  disconnect: (service: string) => Promise<boolean>
  disconnectAccount: (appId: string) => Promise<boolean>
  cancelPolling: () => void
  getProviderDetail: (service: string) => Promise<ConnectionProviderDetail>
  getAppDetail: (appId: string) => Promise<ConnectionAppDetail>
  getExecutionLogs: (request: ConnectionExecutionLogRequest) => Promise<ConnectionExecutionLogSummary>
  openExternal: (url: string) => Promise<void>
  setDefaultAccount: (service: string, appId: string) => Promise<boolean>
  setSummary: (summary: ConnectionSummary) => void
  updateAlias: (appId: string, alias: string) => Promise<boolean>
}

/** workspace 由 useOrganizationWorkspace 提供。null 表示组织已选但名称尚未就绪，此时暂停连接器请求。 */
export function useConnections(workspace: ConnectionWorkspace | null): UseConnections {
  const chatService = useChatService()
  const [summary, setSummary] = React.useState<ConnectionSummary | null>(null)
  const [summaryWorkspaceKey, setSummaryWorkspaceKey] = React.useState<string | null>(null)
  const [busy, setBusy] = React.useState<UseConnections["busy"]>(null)
  const [polling, setPolling] = React.useState<string | null>(null)
  const [actionError, setActionError] = React.useState<UserFacingError | null>(null)
  const [summaryError, setSummaryError] = React.useState<UserFacingError | null>(null)
  const pollAbort = React.useRef<PollOperation | null>(null)
  const oauthPending = React.useRef<OAuthPendingOperation | null>(null)
  const pollSequence = React.useRef(0)
  const oauthSequence = React.useRef(0)
  const actionSequence = React.useRef(0)
  const effectiveWorkspace = React.useRef<ConnectionWorkspace | null>(workspace)
  const workspaceGeneration = React.useRef(0)
  const summaryRequestSequence = React.useRef(0)
  effectiveWorkspace.current = workspace

  const setCurrentSummary = React.useCallback((next: ConnectionSummary): void => {
    setSummary(next)
    setSummaryWorkspaceKey(connectionWorkspaceKey(next.workspace))
  }, [])

  const isCurrentWorkspace = React.useCallback((generation: number, key: string): boolean => {
    return workspaceGeneration.current === generation && sameWorkspace(effectiveWorkspace.current, key)
  }, [])

  const refresh = React.useCallback(
    async (request?: ConnectionSummaryRequest): Promise<ConnectionSummary | null> => {
      const currentWorkspace = effectiveWorkspace.current
      if (!currentWorkspace) {
        setSummary(null)
        setSummaryWorkspaceKey(null)
        setBusy(null)
        setSummaryError(null)
        return null
      }
      const requestId = summaryRequestSequence.current + 1
      summaryRequestSequence.current = requestId
      const generation = workspaceGeneration.current
      const key = connectionWorkspaceKey(currentWorkspace)
      setBusy((current) => current ?? "refresh")
      try {
        const next = await getConnectionSummary(currentWorkspace, request)
        if (summaryRequestSequence.current === requestId && isCurrentWorkspace(generation, key)) {
          setCurrentSummary(next)
          setSummaryError(null)
        }
        return next
      } catch (err) {
        if (summaryRequestSequence.current === requestId && isCurrentWorkspace(generation, key)) {
          setSummaryWorkspaceKey(key)
          setSummaryError(resolveConnectionError(err, "summary"))
        }
        return null
      } finally {
        if (summaryRequestSequence.current === requestId && isCurrentWorkspace(generation, key)) {
          setBusy((current) => (current === "refresh" ? null : current))
        }
      }
    },
    [isCurrentWorkspace, setCurrentSummary],
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

      setPolling(operation.pollingKey)
      setBusy(null)
      try {
        while (Date.now() < operation.expiresAt) {
          await wait(POLL_INTERVAL_MS, abort.signal)
          if (!isCurrentOAuth()) {
            return false
          }
          const next = await getConnectionSummary(currentWorkspace, { forceRefresh: true })
          if (!isCurrentOAuth()) {
            return false
          }
          if (isOAuthOperationConnected(next, operation)) {
            setCurrentSummary(next)
            setActionError(null)
            clearActiveOAuthPending(operation)
            setPolling(null)
            return true
          }
        }

        if (isCurrentOAuth()) {
          setActionError(resolveConnectionError("WANTA_OAUTH_PENDING", errorOperation))
          clearActiveOAuthPending(operation)
          setPolling(null)
        }
        return false
      } catch (err) {
        if (!isCurrentOAuth()) {
          return false
        }
        if (err instanceof DOMException && err.name === "AbortError") {
          setActionError(resolveConnectionError("WANTA_OAUTH_CANCELLED", errorOperation))
        } else {
          setActionError(resolveConnectionError(err, errorOperation))
        }
        clearActiveOAuthPending(operation)
        setPolling(null)
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
      workspaceGeneration.current += 1
      summaryRequestSequence.current += 1
      actionSequence.current += 1
      pollSequence.current += 1
      pollAbort.current?.controller.abort()
      oauthPending.current = null
      pollAbort.current = null
      setPolling(null)
      setBusy(null)
      setActionError(null)
      setSummaryError(null)
      setSummary(null)
      setSummaryWorkspaceKey(null)
      return
    }
    const key = connectionWorkspaceKey(workspace)
    if (appliedWorkspaceKey.current === key) {
      return
    }
    appliedWorkspaceKey.current = key
    workspaceGeneration.current += 1
    summaryRequestSequence.current += 1
    actionSequence.current += 1
    pollSequence.current += 1
    pollAbort.current?.controller.abort()
    oauthPending.current = null
    pollAbort.current = null
    setPolling(null)
    setSummaryWorkspaceKey(null)
    const organizationName = workspace.type === "organization" ? workspace.organizationName : undefined
    setActionError(null)
    setSummaryError(null)
    setBusy("refresh")
    void chatService.invoke("setAgentOrganization", { organizationName }).catch((error: unknown) => {
      reportRendererHandledError("connections", "agent organization scope sync failed", error)
    })
    void refresh({ forceRefresh: true })
  }, [chatService, refresh, workspace])

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
    setActionError(null)
    setPolling(active.pollingKey)
    void pollOAuthPending(active, workspace, active.appId ? "reconnect" : "connect")
  }, [activateOAuthPending, pollOAuthPending, workspace])

  const connect = React.useCallback(
    async (input: ConnectionConnectInput): Promise<boolean> => {
      const operation = "appId" in input && input.appId ? "reconnect" : "connect"
      const currentWorkspace = effectiveWorkspace.current
      if (!currentWorkspace) {
        setActionError(resolveConnectionError("Workspace is still loading.", operation))
        return false
      }

      if (input.authType === "oauth2") {
        const duplicateOAuthKey = createOAuthPendingKey(currentWorkspace, input)
        const pending = readOAuthPendingOperation(duplicateOAuthKey)
        if (pending) {
          const active =
            oauthPending.current?.key === pending.key ? oauthPending.current : activateOAuthPending(pending)
          setActionError(null)
          setPolling(active.pollingKey)
          if (!pollAbort.current) {
            void pollOAuthPending(active, currentWorkspace, "appId" in input && input.appId ? "reconnect" : "connect")
          }
          return false
        }
      }

      const actionId = actionSequence.current + 1
      actionSequence.current = actionId
      summaryRequestSequence.current += 1
      const generation = workspaceGeneration.current
      const key = connectionWorkspaceKey(currentWorkspace)
      const isCurrentAction = (): boolean => {
        return actionSequence.current === actionId && isCurrentWorkspace(generation, key)
      }
      const applySummary = (next: ConnectionSummary): void => {
        if (isCurrentAction()) {
          setCurrentSummary(next)
        }
      }
      const applyActionError = (error: UserFacingError): void => {
        if (isCurrentAction()) {
          setActionError(error)
        }
      }
      const applyBusy = (next: UseConnections["busy"]): void => {
        if (isCurrentAction()) {
          setBusy(next)
        }
      }
      const applyPolling = (next: string | null): void => {
        if (isCurrentAction()) {
          setPolling(next)
        }
      }
      setActionError(null)
      setBusy("connect")
      let startedOAuthPending: OAuthPendingOperation | null = null
      try {
        if (input.authType !== "oauth2") {
          await connectProvider(input, currentWorkspace)
          applySummary(await getConnectionSummary(currentWorkspace, { forceRefresh: true }))
          return isCurrentAction()
        }

        // oauth2：渲染层取授权 URL → 交主进程用系统浏览器打开 → 轮询直到连上。
        const baselineSummary = await getConnectionSummary(currentWorkspace, { forceRefresh: true })
        if (!isCurrentAction()) {
          return false
        }
        applySummary(baselineSummary)
        const pending = createOAuthPendingOperation(
          currentWorkspace,
          input,
          actionId,
          Date.now(),
          activeAppIdsForService(baselineSummary, input.service),
        )
        startedOAuthPending = pending
        oauthPending.current = pending
        rememberOAuthPendingOperation(pending)
        applyPolling(pending.pollingKey)
        const isCurrentOAuthStart = (): boolean => {
          return (
            oauthPending.current?.key === pending.key &&
            oauthPending.current.actionId === pending.actionId &&
            isCurrentWorkspace(generation, key)
          )
        }
        const { authorizationUrl } = await startOAuthConnect(input, currentWorkspace)
        if (!isCurrentOAuthStart()) {
          return false
        }
        await chatService.invoke("openExternalUrl", { url: authorizationUrl })
        if (!isCurrentOAuthStart()) {
          return false
        }

        return await pollOAuthPending(pending, currentWorkspace, operation)
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
    [
      activateOAuthPending,
      chatService,
      clearActiveOAuthPending,
      isCurrentWorkspace,
      pollOAuthPending,
      setCurrentSummary,
    ],
  )

  const disconnect = React.useCallback(
    async (svc: string): Promise<boolean> => {
      const currentWorkspace = effectiveWorkspace.current
      if (!currentWorkspace) {
        setActionError(resolveConnectionError("Workspace is still loading.", "disconnect"))
        return false
      }
      const generation = workspaceGeneration.current
      const key = connectionWorkspaceKey(currentWorkspace)
      const actionId = actionSequence.current + 1
      actionSequence.current = actionId
      summaryRequestSequence.current += 1
      const isCurrentAction = (): boolean => {
        return actionSequence.current === actionId && isCurrentWorkspace(generation, key)
      }
      setActionError(null)
      setBusy("disconnect")
      try {
        await disconnectProviderRequest(svc, currentWorkspace)
        const next = await getConnectionSummary(currentWorkspace, { forceRefresh: true })
        if (isCurrentAction()) {
          setCurrentSummary(next)
        }
        return isCurrentAction()
      } catch (err) {
        if (isCurrentAction()) {
          setActionError(resolveConnectionError(err, "disconnect"))
        }
        return false
      } finally {
        if (isCurrentAction()) {
          setBusy(null)
        }
      }
    },
    [isCurrentWorkspace, setCurrentSummary],
  )

  const disconnectAccount = React.useCallback(
    async (appId: string): Promise<boolean> => {
      const currentWorkspace = effectiveWorkspace.current
      if (!currentWorkspace) {
        setActionError(resolveConnectionError("Workspace is still loading.", "disconnect"))
        return false
      }
      const generation = workspaceGeneration.current
      const key = connectionWorkspaceKey(currentWorkspace)
      const actionId = actionSequence.current + 1
      actionSequence.current = actionId
      summaryRequestSequence.current += 1
      const isCurrentAction = (): boolean => {
        return actionSequence.current === actionId && isCurrentWorkspace(generation, key)
      }
      setActionError(null)
      setBusy("disconnect")
      try {
        await disconnectAccountRequest(appId, currentWorkspace)
        const next = await getConnectionSummary(currentWorkspace, { forceRefresh: true })
        if (isCurrentAction()) {
          setCurrentSummary(next)
        }
        return isCurrentAction()
      } catch (err) {
        if (isCurrentAction()) {
          setActionError(resolveConnectionError(err, "disconnect"))
        }
        return false
      } finally {
        if (isCurrentAction()) {
          setBusy(null)
        }
      }
    },
    [isCurrentWorkspace, setCurrentSummary],
  )

  const setDefaultAccount = React.useCallback(
    async (svc: string, appId: string): Promise<boolean> => {
      const currentWorkspace = effectiveWorkspace.current
      if (!currentWorkspace) {
        setActionError(resolveConnectionError("Workspace is still loading.", "set_default"))
        return false
      }
      const generation = workspaceGeneration.current
      const key = connectionWorkspaceKey(currentWorkspace)
      const actionId = actionSequence.current + 1
      actionSequence.current = actionId
      summaryRequestSequence.current += 1
      const isCurrentAction = (): boolean => {
        return actionSequence.current === actionId && isCurrentWorkspace(generation, key)
      }
      setActionError(null)
      try {
        await setDefaultAccountRequest(svc, appId, currentWorkspace)
        const next = await getConnectionSummary(currentWorkspace, { forceRefresh: true })
        if (isCurrentAction()) {
          setCurrentSummary(next)
        }
        return isCurrentAction()
      } catch (err) {
        if (isCurrentAction()) {
          setActionError(resolveConnectionError(err, "set_default"))
        }
        return false
      }
    },
    [isCurrentWorkspace, setCurrentSummary],
  )

  const updateAlias = React.useCallback(
    async (appId: string, alias: string): Promise<boolean> => {
      const currentWorkspace = effectiveWorkspace.current
      if (!currentWorkspace) {
        setActionError(resolveConnectionError("Workspace is still loading.", "update_alias"))
        return false
      }
      const generation = workspaceGeneration.current
      const key = connectionWorkspaceKey(currentWorkspace)
      const actionId = actionSequence.current + 1
      actionSequence.current = actionId
      summaryRequestSequence.current += 1
      const isCurrentAction = (): boolean => {
        return actionSequence.current === actionId && isCurrentWorkspace(generation, key)
      }
      setActionError(null)
      try {
        await updateAliasRequest(appId, alias, currentWorkspace)
        const next = await getConnectionSummary(currentWorkspace, { forceRefresh: true })
        if (isCurrentAction()) {
          setCurrentSummary(next)
        }
        return isCurrentAction()
      } catch (err) {
        if (isCurrentAction()) {
          setActionError(resolveConnectionError(err, "update_alias"))
        }
        return false
      }
    },
    [isCurrentWorkspace, setCurrentSummary],
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
    setPolling(null)
    setBusy(null)
  }, [])
  const clearActionError = React.useCallback(() => setActionError(null), [])

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
  const openExternal = React.useCallback((url: string) => chatService.invoke("openExternalUrl", { url }), [chatService])

  return {
    summary,
    summaryWorkspaceKey,
    busy,
    polling,
    actionError,
    summaryError,
    clearActionError,
    refresh,
    connect,
    disconnect,
    disconnectAccount,
    cancelPolling,
    getProviderDetail,
    getAppDetail,
    getExecutionLogs,
    openExternal,
    setDefaultAccount,
    setSummary: setCurrentSummary,
    updateAlias,
  }
}
