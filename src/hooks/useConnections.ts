import type {
  ConnectionActionResult,
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
import { useConnectionsService } from "../components/AppContext.ts"
import { resolveUserFacingError } from "../lib/user-facing-error.ts"

const POLL_INTERVAL_MS = 2000
const POLL_TIMEOUT_MS = 5 * 60_000

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
  setWorkspace: (workspace: ConnectionWorkspace) => Promise<ConnectionSummary | null>
  updateAlias: (appId: string, alias: string) => Promise<boolean>
}

export function useConnections(): UseConnections {
  const service = useConnectionsService()
  const [summary, setSummary] = React.useState<ConnectionSummary | null>(null)
  const [busy, setBusy] = React.useState<UseConnections["busy"]>(null)
  const [polling, setPolling] = React.useState<string | null>(null)
  const [error, setError] = React.useState<UserFacingError | null>(null)
  const pollAbort = React.useRef<AbortController | null>(null)

  const refresh = React.useCallback(
    async (request?: ConnectionSummaryRequest): Promise<ConnectionSummary | null> => {
      setBusy((current) => current ?? "refresh")
      try {
        const next = await service.invoke("getConnectionSummary", request)
        setSummary(next)
        setError(null)
        return next
      } catch (err) {
        setError(resolveUserFacingError(err, { area: "connections" }))
        return null
      } finally {
        setBusy((current) => (current === "refresh" ? null : current))
      }
    },
    [service],
  )

  React.useEffect(() => {
    void refresh()
    return service.serverEvents.on("connectionSummaryChanged", (event) => {
      setSummary(event.summary)
      setError(null)
    })
  }, [service, refresh])

  React.useEffect(() => () => pollAbort.current?.abort(), [])

  const connect = React.useCallback(
    async (input: ConnectionConnectInput): Promise<boolean> => {
      setError(null)
      setBusy("connect")
      try {
        const result: ConnectionActionResult = await service.invoke("connectProvider", input)
        setSummary(result.summary)

        if (input.authType !== "oauth2" || result.status !== "opened") {
          return true
        }

        pollAbort.current?.abort()
        const abort = new AbortController()
        pollAbort.current = abort
        setPolling(input.service)
        setBusy(null)

        const startedAt = Date.now()
        while (Date.now() - startedAt < POLL_TIMEOUT_MS) {
          await wait(POLL_INTERVAL_MS, abort.signal)
          const next = await service.invoke("getConnectionSummary", { forceRefresh: true })
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
    [service],
  )

  const disconnect = React.useCallback(
    async (svc: string): Promise<boolean> => {
      setError(null)
      setBusy("disconnect")
      try {
        const result = await service.invoke("disconnectProvider", svc)
        setSummary(result.summary)
        return true
      } catch (err) {
        setError(resolveUserFacingError(err, { area: "connections" }))
        return false
      } finally {
        setBusy(null)
      }
    },
    [service],
  )

  const disconnectAccount = React.useCallback(
    async (appId: string): Promise<boolean> => {
      setError(null)
      setBusy("disconnect")
      try {
        const result = await service.invoke("disconnectAccount", appId)
        setSummary(result.summary)
        return true
      } catch (err) {
        setError(resolveUserFacingError(err, { area: "connections" }))
        return false
      } finally {
        setBusy(null)
      }
    },
    [service],
  )

  const setDefaultAccount = React.useCallback(
    async (svc: string, appId: string): Promise<boolean> => {
      setError(null)
      try {
        await service.invoke("setDefaultAccount", svc, appId)
        const next = await service.invoke("getConnectionSummary", { forceRefresh: true })
        setSummary(next)
        return true
      } catch (err) {
        setError(resolveUserFacingError(err, { area: "connections" }))
        return false
      }
    },
    [service],
  )

  const updateAlias = React.useCallback(
    async (appId: string, alias: string): Promise<boolean> => {
      setError(null)
      try {
        await service.invoke("updateAlias", appId, alias)
        const next = await service.invoke("getConnectionSummary", { forceRefresh: true })
        setSummary(next)
        return true
      } catch (err) {
        setError(resolveUserFacingError(err, { area: "connections" }))
        return false
      }
    },
    [service],
  )

  const setWorkspace = React.useCallback(
    async (workspace: ConnectionWorkspace): Promise<ConnectionSummary | null> => {
      setBusy((current) => current ?? "refresh")
      try {
        const next = await service.invoke("setWorkspace", workspace)
        setSummary(next)
        setError(null)
        return next
      } catch (err) {
        setError(resolveUserFacingError(err, { area: "connections" }))
        return null
      } finally {
        setBusy((current) => (current === "refresh" ? null : current))
      }
    },
    [service],
  )

  const cancelPolling = React.useCallback(() => {
    pollAbort.current?.abort()
    pollAbort.current = null
    setPolling(null)
    setBusy(null)
  }, [])

  const getProviderDetail = React.useCallback(
    (svc: string) => service.invoke("getConnectionProviderDetail", svc),
    [service],
  )
  const getExecutionLogs = React.useCallback(
    (request: ConnectionExecutionLogRequest) => service.invoke("getConnectionExecutionLogs", request),
    [service],
  )
  const openExternal = React.useCallback((url: string) => service.invoke("openExternal", url), [service])

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
    setWorkspace,
    updateAlias,
  }
}
