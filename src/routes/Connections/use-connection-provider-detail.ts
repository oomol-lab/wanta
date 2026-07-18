import type { ConnectionProviderDetail, ConnectionProviderSummary } from "../../../electron/connections/common.ts"
import type { UserFacingError } from "@/lib/user-facing-error"

import * as React from "react"
import { connectionDetailCacheKey, shouldLoadProviderDetail } from "./connection-route-model.ts"
import { resolveConnectionError } from "@/lib/connections-error"

export function useConnectionProviderDetail({
  enabled = true,
  getProviderDetail,
  provider,
  workspaceKey,
}: {
  enabled?: boolean
  getProviderDetail: (service: string) => Promise<ConnectionProviderDetail>
  provider: ConnectionProviderSummary | null
  workspaceKey: string | null
}) {
  const [detail, setDetail] = React.useState<ConnectionProviderDetail | null>(null)
  const [loadedCacheKey, setLoadedCacheKey] = React.useState<string | null>(null)
  const [loading, setLoading] = React.useState(false)
  const [error, setError] = React.useState<UserFacingError | null>(null)
  const [generation, setGeneration] = React.useState(0)
  const requestIdRef = React.useRef(0)
  const previousWorkspaceKeyRef = React.useRef(workspaceKey)
  const service = provider?.service ?? null
  const needsDetail = enabled && provider ? shouldLoadProviderDetail(provider) : false
  const cacheKey = workspaceKey && service ? connectionDetailCacheKey(workspaceKey, service) : null

  const clearState = React.useCallback(() => {
    requestIdRef.current += 1
    setDetail(null)
    setLoadedCacheKey(null)
    setError(null)
    setLoading(false)
  }, [])

  React.useEffect(() => {
    if (previousWorkspaceKeyRef.current === workspaceKey) return
    previousWorkspaceKeyRef.current = workspaceKey
    clearState()
  }, [clearState, workspaceKey])

  const loadCached = React.useCallback(
    async (targetService: string): Promise<ConnectionProviderDetail> => {
      const targetKey = workspaceKey ? connectionDetailCacheKey(workspaceKey, targetService) : null
      if (targetKey && loadedCacheKey === targetKey && detail) return detail
      return getProviderDetail(targetService)
    },
    [detail, getProviderDetail, loadedCacheKey, workspaceKey],
  )

  const invalidate = React.useCallback(
    (targetService: string) => {
      if (!workspaceKey) return
      const targetKey = connectionDetailCacheKey(workspaceKey, targetService)
      if (cacheKey === targetKey) {
        clearState()
        setGeneration((current) => current + 1)
      }
    },
    [cacheKey, clearState, workspaceKey],
  )

  React.useEffect(() => {
    if (!service || !cacheKey || !needsDetail) {
      clearState()
      return
    }
    let cancelled = false
    const requestId = ++requestIdRef.current
    setDetail(null)
    setLoadedCacheKey(null)
    setError(null)
    setLoading(true)
    void getProviderDetail(service)
      .then((loaded) => {
        if (cancelled || requestIdRef.current !== requestId) return
        setDetail(loaded)
        setLoadedCacheKey(cacheKey)
      })
      .catch((cause) => {
        if (!cancelled && requestIdRef.current === requestId) setError(resolveConnectionError(cause, "detail"))
      })
      .finally(() => {
        if (!cancelled && requestIdRef.current === requestId) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [cacheKey, clearState, generation, getProviderDetail, needsDetail, service])

  return {
    cacheKey,
    detail: cacheKey && loadedCacheKey === cacheKey ? detail : null,
    error: cacheKey ? error : null,
    invalidate,
    loadCached,
    loading: Boolean(cacheKey) && loading,
    needsDetail,
    reportError: (cause: unknown) => setError(resolveConnectionError(cause, "detail")),
  }
}
