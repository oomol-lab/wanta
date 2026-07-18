import type { BillingOverviewResult, BillingPeriodDays } from "../../electron/chat/common.ts"
import type { BillingRequestScope } from "../lib/billing-client.ts"
import type { UserFacingError } from "../lib/user-facing-error.ts"

import * as React from "react"
import { getBillingOverview } from "../lib/billing-client.ts"
import { resolveUserFacingError } from "../lib/user-facing-error.ts"

const defaultStaleMs = 60_000
const billingOverviewRequestTimeoutMs = 15_000

interface BillingOverviewCacheEntry {
  data: BillingOverviewResult | null
  loadedAt: number
  promise: Promise<BillingOverviewResult> | null
}

export interface UseBillingOverviewOptions {
  cacheScope?: string
  enabled?: boolean
  requestScope?: BillingRequestScope | null
  staleMs?: number
}

export interface RefreshBillingOverviewOptions {
  force?: boolean
}

export interface UseBillingOverview {
  data: BillingOverviewResult | null
  loading: boolean
  error: UserFacingError | null
  refresh: (options?: RefreshBillingOverviewOptions) => Promise<BillingOverviewResult | null>
}

const overviewCache = new Map<string, Map<BillingPeriodDays, BillingOverviewCacheEntry>>()

export function useBillingOverview(
  days: BillingPeriodDays,
  {
    cacheScope = "default",
    enabled = true,
    requestScope = null,
    staleMs = defaultStaleMs,
  }: UseBillingOverviewOptions = {},
): UseBillingOverview {
  // 顶部浮层、购买弹窗和账单详情页复用同一份聚合资源。资源内部的组织计划/用量与创建者个人余额
  // 作用域不同；缓存边界仍须包含账号和工作区，避免付款权限或组织统计跨边界复用。
  const requestCanManageBilling = requestScope?.canManageBilling ?? false
  const requestCanManageFunding = requestScope?.canManageFunding ?? false
  const requestTeamId = requestScope?.teamId ?? ""
  const requestOrganizationName = requestScope?.organizationName ?? ""
  const requestScopeReady = requestScope !== null
  const requestScopeKey = requestScope
    ? `organization:${requestTeamId}:${requestOrganizationName}:${requestCanManageBilling}:${requestCanManageFunding}`
    : "blocked"
  const cacheScopeKey = `${cacheScope}\u0000${requestScopeKey}`
  const [data, setData] = React.useState<BillingOverviewResult | null>(() => cachedData(cacheScopeKey, days))
  const [loading, setLoading] = React.useState(false)
  const [error, setError] = React.useState<UserFacingError | null>(null)
  const requestId = React.useRef(0)
  const mounted = React.useRef(true)

  React.useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])

  React.useEffect(() => {
    requestId.current += 1
    setData(cachedData(cacheScopeKey, days))
    setError(null)
    setLoading(false)
  }, [cacheScopeKey, days])

  const refresh = React.useCallback(
    async ({ force = false }: RefreshBillingOverviewOptions = {}): Promise<BillingOverviewResult | null> => {
      if (!requestScopeReady) {
        return null
      }
      const currentRequest = requestId.current + 1
      requestId.current = currentRequest
      const entry = cacheEntry(cacheScopeKey, days)
      if (!force && isFresh(entry, staleMs)) {
        setData(entry.data)
        setError(null)
        return entry.data
      }

      setLoading(true)
      setError(null)

      // 普通刷新复用已在途请求；充值、订阅或登录后的强制刷新必须越过旧请求，避免旧快照回填。
      const scope: BillingRequestScope = {
        canManageBilling: requestCanManageBilling,
        canManageFunding: requestCanManageFunding,
        teamId: requestTeamId,
        organizationName: requestOrganizationName,
      }
      const promise = loadBillingOverviewEntry(entry, () => getBillingOverview(days, scope), { force })

      try {
        const nextData = await promise
        if (mounted.current && requestId.current === currentRequest) {
          setData(nextData)
          setError(null)
        }
        return nextData
      } catch (nextError) {
        if (mounted.current && requestId.current === currentRequest) {
          const resolved = resolveUserFacingError(nextError, { area: "billing" })
          setError(resolved)
          // 会话过期（auth_required）：清掉可能残留的旧余额（含模块级缓存），否则 popover 红点 / 账单页
          // 标题会把陈旧或零值再渲染成假 "$0"。其他错误（网络抖动）保留旧值以免闪烁。
          if (resolved.kind === "auth_required") {
            entry.data = null
            entry.loadedAt = 0
            setData(null)
          }
        }
        return null
      } finally {
        if (mounted.current && requestId.current === currentRequest) {
          setLoading(false)
        }
      }
    },
    [
      cacheScopeKey,
      days,
      requestCanManageBilling,
      requestCanManageFunding,
      requestTeamId,
      requestOrganizationName,
      requestScopeReady,
      staleMs,
    ],
  )

  React.useEffect(() => {
    if (enabled && requestScopeReady) {
      void refresh()
    }
  }, [enabled, refresh, requestScopeReady])

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

function cachedData(cacheScope: string, days: BillingPeriodDays): BillingOverviewResult | null {
  const entry = overviewCache.get(cacheScope)?.get(days)
  return entry?.data ?? null
}

function isFresh(
  entry: BillingOverviewCacheEntry,
  staleMs: number,
): entry is BillingOverviewCacheEntry & {
  data: BillingOverviewResult
} {
  return Boolean(entry.data && Date.now() - entry.loadedAt < staleMs)
}

export function startBillingOverviewRequest(
  entry: BillingOverviewCacheEntry,
  request: () => Promise<BillingOverviewResult>,
  timeoutMs = billingOverviewRequestTimeoutMs,
): Promise<BillingOverviewResult> {
  const promise = withBillingOverviewTimeout(request(), timeoutMs)
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

export function loadBillingOverviewEntry(
  entry: BillingOverviewCacheEntry,
  request: () => Promise<BillingOverviewResult>,
  options: { force?: boolean; timeoutMs?: number } = {},
): Promise<BillingOverviewResult> {
  if (!options.force && entry.promise) {
    return entry.promise
  }
  return startBillingOverviewRequest(entry, request, options.timeoutMs)
}

function withBillingOverviewTimeout(
  request: Promise<BillingOverviewResult>,
  timeoutMs: number,
): Promise<BillingOverviewResult> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error("Billing overview request timed out."))
    }, timeoutMs)

    void request.then(resolve, reject).finally(() => clearTimeout(timer))
  })
}
