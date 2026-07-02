import type {
  ConnectionConnectInput,
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
  getConnectionExecutionLogs,
  getConnectionProviderDetail,
  getConnectionSummary,
  isProviderConnectionActive,
  setDefaultAccount as setDefaultAccountRequest,
  startOAuthConnect,
  updateAlias as updateAliasRequest,
} from "../lib/connections-client.ts"
import { resolveConnectionError } from "../lib/connections-error.ts"
import {
  connectionWorkspaceKey,
  createConnectionPollingKey,
  createOAuthPendingKey,
} from "./connection-oauth-pending.ts"

const POLL_INTERVAL_MS = 2000
const POLL_TIMEOUT_MS = 5 * 60_000

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

export interface UseConnections {
  summary: ConnectionSummary | null
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
  const [busy, setBusy] = React.useState<UseConnections["busy"]>(null)
  const [polling, setPolling] = React.useState<string | null>(null)
  const [actionError, setActionError] = React.useState<UserFacingError | null>(null)
  const [summaryError, setSummaryError] = React.useState<UserFacingError | null>(null)
  const pollAbort = React.useRef<PollOperation | null>(null)
  const oauthPending = React.useRef<OAuthPendingOperation | null>(null)
  const pollSequence = React.useRef(0)
  const actionSequence = React.useRef(0)
  const effectiveWorkspace = React.useRef<ConnectionWorkspace | null>(workspace)
  const workspaceGeneration = React.useRef(0)
  const summaryRequestSequence = React.useRef(0)
  effectiveWorkspace.current = workspace

  const isCurrentWorkspace = React.useCallback((generation: number, key: string): boolean => {
    return workspaceGeneration.current === generation && sameWorkspace(effectiveWorkspace.current, key)
  }, [])

  const refresh = React.useCallback(
    async (request?: ConnectionSummaryRequest): Promise<ConnectionSummary | null> => {
      const currentWorkspace = effectiveWorkspace.current
      if (!currentWorkspace) {
        setSummary(null)
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
          setSummary(next)
          setSummaryError(null)
        }
        return next
      } catch (err) {
        if (summaryRequestSequence.current === requestId && isCurrentWorkspace(generation, key)) {
          setSummaryError(resolveConnectionError(err, "summary"))
        }
        return null
      } finally {
        if (summaryRequestSequence.current === requestId && isCurrentWorkspace(generation, key)) {
          setBusy((current) => (current === "refresh" ? null : current))
        }
      }
    },
    [isCurrentWorkspace],
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
      return
    }
    const key = connectionWorkspaceKey(workspace)
    if (appliedWorkspaceKey.current === key) {
      return
    }
    appliedWorkspaceKey.current = key
    const generation = workspaceGeneration.current + 1
    workspaceGeneration.current = generation
    summaryRequestSequence.current += 1
    actionSequence.current += 1
    pollSequence.current += 1
    pollAbort.current?.controller.abort()
    oauthPending.current = null
    pollAbort.current = null
    setPolling(null)
    const organizationName = workspace.type === "organization" ? workspace.organizationName : undefined
    setActionError(null)
    setSummaryError(null)
    setBusy("refresh")
    void (async () => {
      try {
        await chatService.invoke("setAgentOrganization", { organizationName })
        if (isCurrentWorkspace(generation, key)) {
          void refresh({ forceRefresh: true })
        }
      } catch (err) {
        if (isCurrentWorkspace(generation, key)) {
          setSummaryError(resolveConnectionError(err, "summary"))
          setBusy((current) => (current === "refresh" ? null : current))
        }
      }
    })()
  }, [chatService, isCurrentWorkspace, refresh, workspace])

  React.useEffect(
    () => () => {
      pollAbort.current?.controller.abort()
      oauthPending.current = null
    },
    [],
  )

  const connect = React.useCallback(
    async (input: ConnectionConnectInput): Promise<boolean> => {
      const operation = "appId" in input && input.appId ? "reconnect" : "connect"
      const currentWorkspace = effectiveWorkspace.current
      if (!currentWorkspace) {
        setActionError(resolveConnectionError("Workspace is still loading.", operation))
        return false
      }
      const duplicateOAuthKey = input.authType === "oauth2" ? createOAuthPendingKey(currentWorkspace, input) : null
      const pollingKey = input.authType === "oauth2" ? createConnectionPollingKey(input.service, input.appId) : null
      if (duplicateOAuthKey && oauthPending.current?.key === duplicateOAuthKey) {
        setActionError(null)
        setPolling(oauthPending.current.pollingKey)
        return false
      }
      const actionId = actionSequence.current + 1
      actionSequence.current = actionId
      summaryRequestSequence.current += 1
      pollSequence.current += 1
      pollAbort.current?.controller.abort()
      oauthPending.current = null
      pollAbort.current = null
      const generation = workspaceGeneration.current
      const key = connectionWorkspaceKey(currentWorkspace)
      const isCurrentAction = (): boolean => {
        return actionSequence.current === actionId && isCurrentWorkspace(generation, key)
      }
      const applySummary = (next: ConnectionSummary): void => {
        if (isCurrentAction()) {
          setSummary(next)
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
      setPolling(pollingKey)
      setBusy("connect")
      let activePollId: number | null = null
      let activeOAuthActionId: number | null = null
      try {
        if (input.authType !== "oauth2") {
          await connectProvider(input, currentWorkspace)
          applySummary(await getConnectionSummary(currentWorkspace, { forceRefresh: true }))
          return isCurrentAction()
        }

        // oauth2：渲染层取授权 URL → 交主进程用系统浏览器打开 → 轮询直到连上。
        const oauthKey = createOAuthPendingKey(currentWorkspace, input)
        activeOAuthActionId = actionId
        oauthPending.current = {
          actionId,
          key: oauthKey,
          pollingKey: pollingKey ?? input.service,
          service: input.service,
        }
        const { authorizationUrl } = await startOAuthConnect(input, currentWorkspace)
        if (!isCurrentAction()) {
          return false
        }
        await chatService.invoke("openExternalUrl", { url: authorizationUrl })
        if (!isCurrentAction()) {
          return false
        }

        const abort = new AbortController()
        const pollId = pollSequence.current + 1
        pollSequence.current = pollId
        activePollId = pollId
        pollAbort.current = { controller: abort, id: pollId }
        applyPolling(pollingKey)
        applyBusy(null)

        const startedAt = Date.now()
        while (Date.now() - startedAt < POLL_TIMEOUT_MS) {
          await wait(POLL_INTERVAL_MS, abort.signal)
          if (!isCurrentAction()) {
            return false
          }
          const connected = await isProviderConnectionActive(input.service, currentWorkspace)
          if (!isCurrentAction()) {
            return false
          }
          if (connected) {
            applySummary(await getConnectionSummary(currentWorkspace, { forceRefresh: true }))
            return isCurrentAction()
          }
        }

        applyActionError(resolveConnectionError("WANTA_OAUTH_PENDING", operation))
        return false
      } catch (err) {
        if (err instanceof DOMException && err.name === "AbortError") {
          applyActionError(resolveConnectionError("WANTA_OAUTH_CANCELLED", operation))
          return false
        }
        applyActionError(resolveConnectionError(err, operation))
        return false
      } finally {
        if (activePollId !== null && pollAbort.current?.id === activePollId) {
          pollAbort.current = null
        }
        if (activeOAuthActionId !== null && oauthPending.current?.actionId === activeOAuthActionId) {
          oauthPending.current = null
        }
        applyPolling(null)
        applyBusy(null)
      }
    },
    [chatService, isCurrentWorkspace],
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
      pollSequence.current += 1
      pollAbort.current?.controller.abort()
      oauthPending.current = null
      pollAbort.current = null
      const isCurrentAction = (): boolean => {
        return actionSequence.current === actionId && isCurrentWorkspace(generation, key)
      }
      setActionError(null)
      setPolling(null)
      setBusy("disconnect")
      try {
        await disconnectProviderRequest(svc, currentWorkspace)
        const next = await getConnectionSummary(currentWorkspace, { forceRefresh: true })
        if (isCurrentAction()) {
          setSummary(next)
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
    [isCurrentWorkspace],
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
      pollSequence.current += 1
      pollAbort.current?.controller.abort()
      oauthPending.current = null
      pollAbort.current = null
      const isCurrentAction = (): boolean => {
        return actionSequence.current === actionId && isCurrentWorkspace(generation, key)
      }
      setActionError(null)
      setPolling(null)
      setBusy("disconnect")
      try {
        await disconnectAccountRequest(appId, currentWorkspace)
        const next = await getConnectionSummary(currentWorkspace, { forceRefresh: true })
        if (isCurrentAction()) {
          setSummary(next)
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
    [isCurrentWorkspace],
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
      pollSequence.current += 1
      pollAbort.current?.controller.abort()
      oauthPending.current = null
      pollAbort.current = null
      const isCurrentAction = (): boolean => {
        return actionSequence.current === actionId && isCurrentWorkspace(generation, key)
      }
      setActionError(null)
      setPolling(null)
      try {
        await setDefaultAccountRequest(svc, appId, currentWorkspace)
        const next = await getConnectionSummary(currentWorkspace, { forceRefresh: true })
        if (isCurrentAction()) {
          setSummary(next)
        }
        return isCurrentAction()
      } catch (err) {
        if (isCurrentAction()) {
          setActionError(resolveConnectionError(err, "set_default"))
        }
        return false
      }
    },
    [isCurrentWorkspace],
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
      pollSequence.current += 1
      pollAbort.current?.controller.abort()
      oauthPending.current = null
      pollAbort.current = null
      const isCurrentAction = (): boolean => {
        return actionSequence.current === actionId && isCurrentWorkspace(generation, key)
      }
      setActionError(null)
      setPolling(null)
      try {
        await updateAliasRequest(appId, alias, currentWorkspace)
        const next = await getConnectionSummary(currentWorkspace, { forceRefresh: true })
        if (isCurrentAction()) {
          setSummary(next)
        }
        return isCurrentAction()
      } catch (err) {
        if (isCurrentAction()) {
          setActionError(resolveConnectionError(err, "update_alias"))
        }
        return false
      }
    },
    [isCurrentWorkspace],
  )

  const cancelPolling = React.useCallback(() => {
    actionSequence.current += 1
    pollSequence.current += 1
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
    getExecutionLogs,
    openExternal,
    setDefaultAccount,
    setSummary,
    updateAlias,
  }
}
