import type {
  ConnectionAccount,
  ConnectionAction,
  ConnectionConnectInput,
  ConnectionExecution,
  ConnectionProviderDetail,
  ConnectionSummary,
} from "../../electron/connections/common"

import * as React from "react"
import { useConnectionsService } from "@/components/AppContext"

const POLL_INTERVAL_MS = 2000
const POLL_TIMEOUT_MS = 5 * 60_000

function wait(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, ms)
    signal.addEventListener(
      "abort",
      () => {
        clearTimeout(timer)
        resolve()
      },
      { once: true },
    )
  })
}

export interface UseConnections {
  summary: ConnectionSummary | null
  busy: string | null
  polling: string | null
  error: string | null
  refresh: () => Promise<void>
  connect: (input: ConnectionConnectInput) => Promise<void>
  disconnect: (service: string) => Promise<void>
  disconnectAccount: (appId: string) => Promise<void>
  cancelPolling: () => void
  // 详情视图按需加载（命令式，不进 summary 状态）。
  getProviderDetail: (service: string) => Promise<ConnectionProviderDetail>
  listAccounts: (service: string) => Promise<ConnectionAccount[]>
  listActions: (service: string) => Promise<ConnectionAction[]>
  listExecutions: (service: string) => Promise<ConnectionExecution[]>
  updateAlias: (appId: string, alias: string) => Promise<void>
  setDefaultAccount: (service: string, appId: string) => Promise<void>
  openExternal: (url: string) => Promise<void>
}

export function useConnections(): UseConnections {
  const service = useConnectionsService()
  const [summary, setSummary] = React.useState<ConnectionSummary | null>(null)
  const [busy, setBusy] = React.useState<string | null>(null)
  const [polling, setPolling] = React.useState<string | null>(null)
  const [error, setError] = React.useState<string | null>(null)
  const pollAbort = React.useRef<AbortController | null>(null)

  const refresh = React.useCallback(async () => {
    try {
      setSummary(await service.invoke("getSummary"))
    } catch (err) {
      setError(String(err))
    }
  }, [service])

  React.useEffect(() => {
    void refresh()
    return service.serverEvents.on("connectionSummaryChanged", (event) => setSummary(event.summary))
  }, [service, refresh])

  React.useEffect(() => () => pollAbort.current?.abort(), [])

  const connect = React.useCallback(
    async (input: ConnectionConnectInput) => {
      setError(null)
      setBusy(input.service)
      try {
        const result = await service.invoke("connect", input)
        setSummary(result.summary)
        if (input.authType === "oauth2" && result.status === "opened") {
          pollAbort.current?.abort()
          const abort = new AbortController()
          pollAbort.current = abort
          setPolling(input.service)
          const startedAt = Date.now()
          while (Date.now() - startedAt < POLL_TIMEOUT_MS) {
            await wait(POLL_INTERVAL_MS, abort.signal)
            if (abort.signal.aborted) {
              break
            }
            const next = await service.invoke("getSummary")
            setSummary(next)
            if (next.providers.some((p) => p.service === input.service && p.connected)) {
              break
            }
          }
          setPolling(null)
        }
      } catch (err) {
        setError(String(err))
      } finally {
        setBusy(null)
      }
    },
    [service],
  )

  const disconnect = React.useCallback(
    async (svc: string) => {
      setError(null)
      setBusy(svc)
      try {
        const result = await service.invoke("disconnect", svc)
        setSummary(result.summary)
      } catch (err) {
        setError(String(err))
      } finally {
        setBusy(null)
      }
    },
    [service],
  )

  const disconnectAccount = React.useCallback(
    async (appId: string) => {
      setError(null)
      try {
        const result = await service.invoke("disconnectAccount", appId)
        setSummary(result.summary)
      } catch (err) {
        setError(String(err))
      }
    },
    [service],
  )

  const cancelPolling = React.useCallback(() => {
    pollAbort.current?.abort()
    setPolling(null)
  }, [])

  const getProviderDetail = React.useCallback((svc: string) => service.invoke("getProviderDetail", svc), [service])
  const listAccounts = React.useCallback((svc: string) => service.invoke("listAccounts", svc), [service])
  const listActions = React.useCallback((svc: string) => service.invoke("listActions", svc), [service])
  const listExecutions = React.useCallback((svc: string) => service.invoke("listExecutions", svc), [service])
  const updateAlias = React.useCallback(
    (appId: string, alias: string) => service.invoke("updateAlias", appId, alias),
    [service],
  )
  const setDefaultAccount = React.useCallback(
    (svc: string, appId: string) => service.invoke("setDefaultAccount", svc, appId),
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
    listAccounts,
    listActions,
    listExecutions,
    updateAlias,
    setDefaultAccount,
    openExternal,
  }
}
