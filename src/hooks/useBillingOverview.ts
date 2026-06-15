import type { BillingOverviewResult, BillingPeriodDays } from "../../electron/chat/common.ts"

import * as React from "react"
import { useChatService } from "@/components/AppContext"

const defaultStaleMs = 60_000

interface BillingOverviewCacheEntry {
  data: BillingOverviewResult | null
  loadedAt: number
  promise: Promise<BillingOverviewResult> | null
}

export interface UseBillingOverviewOptions {
  cacheScope?: string
  enabled?: boolean
  staleMs?: number
}

export interface RefreshBillingOverviewOptions {
  force?: boolean
}

export interface UseBillingOverview {
  data: BillingOverviewResult | null
  loading: boolean
  error: string | null
  refresh: (options?: RefreshBillingOverviewOptions) => Promise<BillingOverviewResult | null>
}

const overviewCache = new Map<string, Map<BillingPeriodDays, BillingOverviewCacheEntry>>()

export function useBillingOverview(
  days: BillingPeriodDays,
  { cacheScope = "default", enabled = true, staleMs = defaultStaleMs }: UseBillingOverviewOptions = {},
): UseBillingOverview {
  const chatService = useChatService()
  const [data, setData] = React.useState<BillingOverviewResult | null>(() => freshCachedData(cacheScope, days, staleMs))
  const [loading, setLoading] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const requestId = React.useRef(0)
  const mounted = React.useRef(true)

  React.useEffect(() => {
    return () => {
      mounted.current = false
    }
  }, [])

  React.useEffect(() => {
    requestId.current += 1
    setData(freshCachedData(cacheScope, days, staleMs))
    setError(null)
    setLoading(false)
  }, [cacheScope, days, staleMs])

  const refresh = React.useCallback(
    async ({ force = false }: RefreshBillingOverviewOptions = {}): Promise<BillingOverviewResult | null> => {
      const currentRequest = requestId.current + 1
      requestId.current = currentRequest
      const entry = cacheEntry(cacheScope, days)
      if (!force && isFresh(entry, staleMs)) {
        setData(entry.data)
        setError(null)
        return entry.data
      }

      setLoading(true)
      setError(null)

      const promise =
        force || !entry.promise
          ? startBillingOverviewRequest(entry, () => {
              return chatService.invoke("getBillingOverview", { days })
            })
          : entry.promise

      try {
        const nextData = await promise
        if (mounted.current && requestId.current === currentRequest) {
          setData(nextData)
          setError(null)
        }
        return nextData
      } catch (nextError) {
        if (mounted.current && requestId.current === currentRequest) {
          setError(errorMessage(nextError))
        }
        return null
      } finally {
        if (mounted.current && requestId.current === currentRequest) {
          setLoading(false)
        }
      }
    },
    [cacheScope, chatService, days, staleMs],
  )

  React.useEffect(() => {
    if (enabled) {
      void refresh()
    }
  }, [enabled, refresh])

  return { data, loading, error, refresh }
}

function cacheEntry(cacheScope: string, days: BillingPeriodDays): BillingOverviewCacheEntry {
  let scopedCache = overviewCache.get(cacheScope)
  if (!scopedCache) {
    scopedCache = new Map()
    overviewCache.set(cacheScope, scopedCache)
  }
  let entry = scopedCache.get(days)
  if (!entry) {
    entry = { data: null, loadedAt: 0, promise: null }
    scopedCache.set(days, entry)
  }
  return entry
}

function freshCachedData(cacheScope: string, days: BillingPeriodDays, staleMs: number): BillingOverviewResult | null {
  const entry = overviewCache.get(cacheScope)?.get(days)
  return entry && isFresh(entry, staleMs) ? entry.data : null
}

function isFresh(
  entry: BillingOverviewCacheEntry,
  staleMs: number,
): entry is BillingOverviewCacheEntry & {
  data: BillingOverviewResult
} {
  return Boolean(entry.data && Date.now() - entry.loadedAt < staleMs)
}

function startBillingOverviewRequest(
  entry: BillingOverviewCacheEntry,
  request: () => Promise<BillingOverviewResult>,
): Promise<BillingOverviewResult> {
  const promise = request()
  entry.promise = promise
  void promise.then(
    (nextData) => {
      if (entry.promise === promise) {
        entry.data = nextData
        entry.loadedAt = Date.now()
        entry.promise = null
      }
    },
    () => {
      if (entry.promise === promise) {
        entry.promise = null
      }
    },
  )
  return promise
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message
  }
  return String(error)
}
