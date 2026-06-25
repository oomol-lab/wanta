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

import * as React from "react"
import { useChatService } from "../components/AppContext.ts"
import {
  connectProvider,
  disconnectAccount as disconnectAccountRequest,
  disconnectProvider as disconnectProviderRequest,
  getConnectionExecutionLogs,
  getConnectionProviderDetail,
  getConnectionSummary,
  setDefaultAccount as setDefaultAccountRequest,
  startOAuthConnect,
  updateAlias as updateAliasRequest,
} from "../lib/connections-client.ts"
import { resolveConnectionError } from "../lib/connections-error.ts"

const POLL_INTERVAL_MS = 2000
const POLL_TIMEOUT_MS = 5 * 60_000
const personalWorkspace: ConnectionWorkspace = { type: "personal" }

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

function isOAuthConnected(summary: ConnectionSummary, service: string): boolean {
  return summary.providers.some(
    (provider) => provider.service === service && provider.status === "connected" && provider.appStatus === "active",
  )
}

function workspaceKey(workspace: ConnectionWorkspace): string {
  return workspace.type === "organization" ? `organization:${workspace.organizationName}` : "personal"
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
  const pollAbort = React.useRef<AbortController | null>(null)
  const effectiveWorkspace = React.useRef<ConnectionWorkspace | null>(workspace ?? personalWorkspace)
  effectiveWorkspace.current = workspace

  const refresh = React.useCallback(async (request?: ConnectionSummaryRequest): Promise<ConnectionSummary | null> => {
    const currentWorkspace = effectiveWorkspace.current
    if (!currentWorkspace) {
      setSummary(null)
      setBusy(null)
      setSummaryError(null)
      return null
    }
    setBusy((current) => current ?? "refresh")
    try {
      const next = await getConnectionSummary(currentWorkspace, request)
      setSummary(next)
      setSummaryError(null)
      return next
    } catch (err) {
      setSummaryError(resolveConnectionError(err, "summary"))
      return null
    } finally {
      setBusy((current) => (current === "refresh" ? null : current))
    }
  }, [])

  // workspace 变化（含首帧）：同步 agent 组织作用域 + 重拉摘要。
  const appliedWorkspaceKey = React.useRef<string | null>(null)
  React.useEffect(() => {
    if (!workspace) {
      if (appliedWorkspaceKey.current === "pending") {
        return
      }
      appliedWorkspaceKey.current = "pending"
      pollAbort.current?.abort()
      pollAbort.current = null
      setPolling(null)
      setBusy(null)
      setActionError(null)
      setSummaryError(null)
      setSummary(null)
      void chatService.invoke("setAgentOrganization", { organizationName: undefined }).catch(() => undefined)
      return
    }
    const key = workspaceKey(workspace)
    if (appliedWorkspaceKey.current === key) {
      return
    }
    appliedWorkspaceKey.current = key
    const organizationName = workspace.type === "organization" ? workspace.organizationName : undefined
    setActionError(null)
    setSummaryError(null)
    void chatService.invoke("setAgentOrganization", { organizationName }).catch(() => undefined)
    void refresh({ forceRefresh: true })
  }, [chatService, refresh, workspace])

  // 首帧按当前 workspace 拉取；workspace 为 null 时 refresh 会进入暂停态。
  const didInitialRefresh = React.useRef(false)
  React.useEffect(() => {
    if (didInitialRefresh.current) {
      return
    }
    didInitialRefresh.current = true
    void refresh()
  }, [refresh])

  React.useEffect(() => () => pollAbort.current?.abort(), [])

  const connect = React.useCallback(
    async (input: ConnectionConnectInput): Promise<boolean> => {
      const operation = "appId" in input && input.appId ? "reconnect" : "connect"
      const currentWorkspace = effectiveWorkspace.current
      if (!currentWorkspace) {
        setActionError(resolveConnectionError("Workspace is still loading.", operation))
        return false
      }
      setActionError(null)
      setBusy("connect")
      try {
        if (input.authType !== "oauth2") {
          await connectProvider(input, currentWorkspace)
          setSummary(await getConnectionSummary(currentWorkspace, { forceRefresh: true }))
          return true
        }

        // oauth2：渲染层取授权 URL → 交主进程用系统浏览器打开 → 轮询直到连上。
        const { authorizationUrl } = await startOAuthConnect(input, currentWorkspace)
        await chatService.invoke("openExternalUrl", { url: authorizationUrl })
        setSummary(await getConnectionSummary(currentWorkspace, { forceRefresh: true }))

        pollAbort.current?.abort()
        const abort = new AbortController()
        pollAbort.current = abort
        setPolling(input.service)
        setBusy(null)

        const startedAt = Date.now()
        while (Date.now() - startedAt < POLL_TIMEOUT_MS) {
          await wait(POLL_INTERVAL_MS, abort.signal)
          const next = await getConnectionSummary(currentWorkspace, { forceRefresh: true })
          setSummary(next)
          if (isOAuthConnected(next, input.service)) {
            return true
          }
        }

        setActionError(resolveConnectionError("WANTA_OAUTH_PENDING", operation))
        return false
      } catch (err) {
        if (err instanceof DOMException && err.name === "AbortError") {
          setActionError(resolveConnectionError("WANTA_OAUTH_CANCELLED", operation))
          return false
        }
        setActionError(resolveConnectionError(err, operation))
        return false
      } finally {
        pollAbort.current = null
        setPolling(null)
        setBusy(null)
      }
    },
    [chatService],
  )

  const disconnect = React.useCallback(async (svc: string): Promise<boolean> => {
    const currentWorkspace = effectiveWorkspace.current
    if (!currentWorkspace) {
      setActionError(resolveConnectionError("Workspace is still loading.", "disconnect"))
      return false
    }
    setActionError(null)
    setBusy("disconnect")
    try {
      await disconnectProviderRequest(svc, currentWorkspace)
      setSummary(await getConnectionSummary(currentWorkspace, { forceRefresh: true }))
      return true
    } catch (err) {
      setActionError(resolveConnectionError(err, "disconnect"))
      return false
    } finally {
      setBusy(null)
    }
  }, [])

  const disconnectAccount = React.useCallback(async (appId: string): Promise<boolean> => {
    const currentWorkspace = effectiveWorkspace.current
    if (!currentWorkspace) {
      setActionError(resolveConnectionError("Workspace is still loading.", "disconnect"))
      return false
    }
    setActionError(null)
    setBusy("disconnect")
    try {
      await disconnectAccountRequest(appId, currentWorkspace)
      setSummary(await getConnectionSummary(currentWorkspace, { forceRefresh: true }))
      return true
    } catch (err) {
      setActionError(resolveConnectionError(err, "disconnect"))
      return false
    } finally {
      setBusy(null)
    }
  }, [])

  const setDefaultAccount = React.useCallback(async (svc: string, appId: string): Promise<boolean> => {
    const currentWorkspace = effectiveWorkspace.current
    if (!currentWorkspace) {
      setActionError(resolveConnectionError("Workspace is still loading.", "set_default"))
      return false
    }
    setActionError(null)
    try {
      await setDefaultAccountRequest(svc, appId, currentWorkspace)
      setSummary(await getConnectionSummary(currentWorkspace, { forceRefresh: true }))
      return true
    } catch (err) {
      setActionError(resolveConnectionError(err, "set_default"))
      return false
    }
  }, [])

  const updateAlias = React.useCallback(async (appId: string, alias: string): Promise<boolean> => {
    const currentWorkspace = effectiveWorkspace.current
    if (!currentWorkspace) {
      setActionError(resolveConnectionError("Workspace is still loading.", "update_alias"))
      return false
    }
    setActionError(null)
    try {
      await updateAliasRequest(appId, alias, currentWorkspace)
      setSummary(await getConnectionSummary(currentWorkspace, { forceRefresh: true }))
      return true
    } catch (err) {
      setActionError(resolveConnectionError(err, "update_alias"))
      return false
    }
  }, [])

  const cancelPolling = React.useCallback(() => {
    pollAbort.current?.abort()
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
