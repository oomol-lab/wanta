import type { ConnectionProviderDetail, ConnectionProviderSummary } from "../../../electron/connections/common.ts"
import type { UserFacingError } from "@/lib/user-facing-error"

import * as React from "react"
import { connectionDetailCacheKey, shouldLoadProviderDetail } from "./connection-route-model.ts"
import { resolveConnectionError } from "@/lib/connections-error"

export function useConnectionProviderDetail({
  getProviderDetail,
  provider,
  workspaceKey,
}: {
  getProviderDetail: (service: string) => Promise<ConnectionProviderDetail>
  provider: ConnectionProviderSummary | null
  workspaceKey: string | null
}) {
  const [detail, setDetail] = React.useState<ConnectionProviderDetail | null>(null)
  const [loadedCacheKey, setLoadedCacheKey] = React.useState<string | null>(null)
  const [loading, setLoading] = React.useState(false)
  const [error, setError] = React.useState<UserFacingError | null>(null)
  const cacheRef = React.useRef(new Map<string, ConnectionProviderDetail>())
  const requestIdRef = React.useRef(0)
  const previousWorkspaceKeyRef = React.useRef(workspaceKey)
  const service = provider?.service ?? null
  const needsDetail = provider ? shouldLoadProviderDetail(provider) : false
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
    cacheRef.current.clear()
    clearState()
  }, [clearState, workspaceKey])

  const loadCached = React.useCallback(
    async (targetService: string): Promise<ConnectionProviderDetail> => {
      const targetKey = workspaceKey ? connectionDetailCacheKey(workspaceKey, targetService) : null
      if (targetKey) {
        if (loadedCacheKey === targetKey && detail) return detail
        const cached = cacheRef.current.get(targetKey)
        if (cached) return cached
      }
      const loaded = await getProviderDetail(targetService)
      if (targetKey) cacheRef.current.set(targetKey, loaded)
      return loaded
    },
    [detail, getProviderDetail, loadedCacheKey, workspaceKey],
  )

  const invalidate = React.useCallback(
    (targetService: string) => {
      if (!workspaceKey) return
      const targetKey = connectionDetailCacheKey(workspaceKey, targetService)
      cacheRef.current.delete(targetKey)
      if (cacheKey === targetKey) clearState()
    },
    [cacheKey, clearState, workspaceKey],
  )

  React.useEffect(() => {
    if (!service || !cacheKey || !needsDetail) {
      clearState()
      return
    }
    const cached = cacheRef.current.get(cacheKey)
    if (cached) {
      setDetail(cached)
      setLoadedCacheKey(cacheKey)
      setError(null)
      setLoading(false)
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
        cacheRef.current.set(cacheKey, loaded)
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
  }, [cacheKey, clearState, getProviderDetail, needsDetail, service])

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
