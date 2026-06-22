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
import { resolveUserFacingError } from "../lib/user-facing-error.ts"

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
  error: UserFacingError | null
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

/**
 * workspace 由 useOrganizationWorkspace 提供（个人 / 组织）。null 表示组织已选但名称尚未就绪，
 * 此时沿用上一个已知 workspace（与旧主进程 setWorkspace 跳过 null 的行为一致）。workspace 变化时
 * 重拉摘要，并经 setAgentOrganization IPC 同步 agent 的组织作用域（agent 仍由主进程持有）。
 */
export function useConnections(workspace: ConnectionWorkspace | null): UseConnections {
  const chatService = useChatService()
  const [summary, setSummary] = React.useState<ConnectionSummary | null>(null)
  const [busy, setBusy] = React.useState<UseConnections["busy"]>(null)
  const [polling, setPolling] = React.useState<string | null>(null)
  const [error, setError] = React.useState<UserFacingError | null>(null)
  const pollAbort = React.useRef<AbortController | null>(null)
  // 始终持有"有效 workspace"（最近一个非 null），供各连接器请求附带组织头。
  const effectiveWorkspace = React.useRef<ConnectionWorkspace>(workspace ?? personalWorkspace)
  if (workspace) {
    effectiveWorkspace.current = workspace
  }

  const refresh = React.useCallback(async (request?: ConnectionSummaryRequest): Promise<ConnectionSummary | null> => {
    setBusy((current) => current ?? "refresh")
    try {
      const next = await getConnectionSummary(effectiveWorkspace.current, request)
      setSummary(next)
      setError(null)
      return next
    } catch (err) {
      setError(resolveUserFacingError(err, { area: "connections" }))
      return null
    } finally {
      setBusy((current) => (current === "refresh" ? null : current))
    }
  }, [])

  // workspace 变化（含首帧）：同步 agent 组织作用域 + 重拉摘要。
  const appliedWorkspaceKey = React.useRef<string | null>(null)
  React.useEffect(() => {
    if (!workspace) {
      return
    }
    const key = workspaceKey(workspace)
    if (appliedWorkspaceKey.current === key) {
      return
    }
    appliedWorkspaceKey.current = key
    const organizationName = workspace.type === "organization" ? workspace.organizationName : undefined
    void chatService.invoke("setAgentOrganization", { organizationName }).catch(() => undefined)
    void refresh({ forceRefresh: true })
  }, [chatService, refresh, workspace])

  // 无组织 workspace（纯个人，永不为 null）场景下的首帧拉取。
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
      setError(null)
      setBusy("connect")
      try {
        if (input.authType !== "oauth2") {
          await connectProvider(input, effectiveWorkspace.current)
          setSummary(await getConnectionSummary(effectiveWorkspace.current, { forceRefresh: true }))
          return true
        }

        // oauth2：渲染层取授权 URL → 交主进程用系统浏览器打开 → 轮询直到连上。
        const { authorizationUrl } = await startOAuthConnect(input, effectiveWorkspace.current)
        await chatService.invoke("openExternalUrl", { url: authorizationUrl })
        setSummary(await getConnectionSummary(effectiveWorkspace.current, { forceRefresh: true }))

        pollAbort.current?.abort()
        const abort = new AbortController()
        pollAbort.current = abort
        setPolling(input.service)
        setBusy(null)

        const startedAt = Date.now()
        while (Date.now() - startedAt < POLL_TIMEOUT_MS) {
          await wait(POLL_INTERVAL_MS, abort.signal)
          const next = await getConnectionSummary(effectiveWorkspace.current, { forceRefresh: true })
          setSummary(next)
          if (isOAuthConnected(next, input.service)) {
            return true
          }
        }

        setError(resolveUserFacingError("LUMO_OAUTH_PENDING", { area: "connections" }))
        return false
      } catch (err) {
        if (err instanceof DOMException && err.name === "AbortError") {
          setError(resolveUserFacingError("LUMO_OAUTH_CANCELLED", { area: "connections" }))
          return false
        }
        setError(resolveUserFacingError(err, { area: "connections" }))
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
    setError(null)
    setBusy("disconnect")
    try {
      await disconnectProviderRequest(svc, effectiveWorkspace.current)
      setSummary(await getConnectionSummary(effectiveWorkspace.current, { forceRefresh: true }))
      return true
    } catch (err) {
      setError(resolveUserFacingError(err, { area: "connections" }))
      return false
    } finally {
      setBusy(null)
    }
  }, [])

  const disconnectAccount = React.useCallback(async (appId: string): Promise<boolean> => {
    setError(null)
    setBusy("disconnect")
    try {
      await disconnectAccountRequest(appId, effectiveWorkspace.current)
      setSummary(await getConnectionSummary(effectiveWorkspace.current, { forceRefresh: true }))
      return true
    } catch (err) {
      setError(resolveUserFacingError(err, { area: "connections" }))
      return false
    } finally {
      setBusy(null)
    }
  }, [])

  const setDefaultAccount = React.useCallback(async (svc: string, appId: string): Promise<boolean> => {
    setError(null)
    try {
      await setDefaultAccountRequest(svc, appId, effectiveWorkspace.current)
      setSummary(await getConnectionSummary(effectiveWorkspace.current, { forceRefresh: true }))
      return true
    } catch (err) {
      setError(resolveUserFacingError(err, { area: "connections" }))
      return false
    }
  }, [])

  const updateAlias = React.useCallback(async (appId: string, alias: string): Promise<boolean> => {
    setError(null)
    try {
      await updateAliasRequest(appId, alias, effectiveWorkspace.current)
      setSummary(await getConnectionSummary(effectiveWorkspace.current, { forceRefresh: true }))
      return true
    } catch (err) {
      setError(resolveUserFacingError(err, { area: "connections" }))
      return false
    }
  }, [])

  const cancelPolling = React.useCallback(() => {
    pollAbort.current?.abort()
    pollAbort.current = null
    setPolling(null)
    setBusy(null)
  }, [])

  const getProviderDetail = React.useCallback(
    (svc: string) => getConnectionProviderDetail(svc, effectiveWorkspace.current),
    [],
  )
  const getExecutionLogs = React.useCallback(
    (request: ConnectionExecutionLogRequest) => getConnectionExecutionLogs(request, effectiveWorkspace.current),
    [],
  )
  const openExternal = React.useCallback((url: string) => chatService.invoke("openExternalUrl", { url }), [chatService])

  return {
    summary,
    busy,
    polling,
    error,
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
