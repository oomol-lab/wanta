import type {
  LinkRuntimeSelection,
  LinkRuntimeState,
  OpenConnectorAppSummary,
  OpenConnectorRuntimeStatus,
  OpenConnectorTestResult,
} from "../../electron/link-runtime/common.ts"

import * as React from "react"
import { useLinkRuntimeService } from "../components/AppContext.ts"
import { reportRendererHandledError } from "../lib/renderer-diagnostics.ts"

export interface UseLinkRuntime {
  busy: boolean
  error: unknown
  loading: boolean
  state: LinkRuntimeState | null
  status: OpenConnectorRuntimeStatus
  clearOpenConnectorToken: () => Promise<LinkRuntimeState>
  listOpenConnectorApps: () => Promise<OpenConnectorAppSummary[]>
  refreshStatus: () => Promise<OpenConnectorRuntimeStatus>
  removeOpenConnector: () => Promise<LinkRuntimeState>
  saveOpenConnector: (input: {
    baseUrl: string
    consoleUrl?: string
    runtimeToken?: string
  }) => Promise<LinkRuntimeState>
  selectRuntime: (kind: LinkRuntimeSelection) => Promise<LinkRuntimeState>
  testOpenConnector: (input: { baseUrl: string; runtimeToken?: string }) => Promise<OpenConnectorTestResult>
}

export function useLinkRuntime(): UseLinkRuntime {
  const service = useLinkRuntimeService()
  const [state, setState] = React.useState<LinkRuntimeState | null>(null)
  const [status, setStatus] = React.useState<OpenConnectorRuntimeStatus>({ kind: "unknown" })
  const [loading, setLoading] = React.useState(true)
  const [busy, setBusy] = React.useState(false)
  const [error, setError] = React.useState<unknown>(null)

  const refreshStatus = React.useCallback(async () => {
    const next = await service.invoke("getOpenConnectorStatus")
    setStatus(next)
    return next
  }, [service])

  React.useEffect(() => {
    let active = true
    const load = async () => {
      try {
        const [nextState, nextStatus] = await Promise.all([
          service.invoke("getState"),
          service.invoke("getOpenConnectorStatus"),
        ])
        if (!active) return
        setState(nextState)
        setStatus(nextStatus)
        setError(null)
      } catch (cause) {
        if (!active) return
        reportRendererHandledError("link-runtime", "initial Link runtime load failed", cause)
        setError(cause)
      } finally {
        if (active) setLoading(false)
      }
    }
    void load()
    const unsubscribe = service.serverEvents.on("linkRuntimeChanged", (next) => {
      if (!active) return
      setState(next)
      setStatus({ kind: "unknown" })
      void refreshStatus().catch((cause: unknown) => {
        reportRendererHandledError("link-runtime", "Link runtime status refresh failed", cause)
      })
    })
    return () => {
      active = false
      unsubscribe()
    }
  }, [refreshStatus, service])

  const mutate = React.useCallback(
    async (operation: () => Promise<LinkRuntimeState>): Promise<LinkRuntimeState> => {
      setBusy(true)
      setError(null)
      try {
        const next = await operation()
        setState(next)
        setStatus(await service.invoke("getOpenConnectorStatus"))
        return next
      } catch (cause) {
        setError(cause)
        throw cause
      } finally {
        setBusy(false)
      }
    },
    [service],
  )

  return {
    busy,
    error,
    loading,
    state,
    status,
    clearOpenConnectorToken: () => mutate(() => service.invoke("clearOpenConnectorToken")),
    listOpenConnectorApps: () => service.invoke("listOpenConnectorApps"),
    refreshStatus,
    removeOpenConnector: () => mutate(() => service.invoke("removeOpenConnector")),
    saveOpenConnector: (input) => mutate(() => service.invoke("saveOpenConnector", input)),
    selectRuntime: (kind) => mutate(() => service.invoke("selectRuntime", kind)),
    testOpenConnector: async (input) => {
      setBusy(true)
      setError(null)
      try {
        const result = await service.invoke("testOpenConnector", input)
        setStatus({ checkedAt: Date.now(), kind: result.kind })
        return result
      } catch (cause) {
        setError(cause)
        throw cause
      } finally {
        setBusy(false)
      }
    },
  }
}
