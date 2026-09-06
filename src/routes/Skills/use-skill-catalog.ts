import type { PublicSkillPackageCatalog } from "../../../electron/skills/common.ts"
import type { ListPublicSkillPackagesInput } from "@/lib/skills-catalog-client"

import * as React from "react"
import { initialPublicPackageCatalogState, publicPackageCatalogReducer } from "./skill-route-model.ts"
import { getSkillCatalogInvalidationRevision, subscribeSkillCatalogInvalidation } from "@/lib/skill-catalog-cache"
import { publicSkillPackageListCacheMs } from "@/lib/skills-catalog-client"

export interface SkillCatalogPageOptions {
  forceRefresh?: boolean
  next?: string | null
  replace?: boolean
}

/** Owns pagination and request lifetime; cached responses remain in the shared client. */
export function useSkillCatalog({
  enabled,
  load,
  staleTimeMs = publicSkillPackageListCacheMs,
  debounceMs = 0,
}: {
  enabled: boolean
  staleTimeMs?: number
  debounceMs?: number
  load: (input: ListPublicSkillPackagesInput) => Promise<PublicSkillPackageCatalog>
}) {
  const [catalog, dispatch] = React.useReducer(publicPackageCatalogReducer, initialPublicPackageCatalogState)
  const activeRequest = React.useRef<AbortController | null>(null)
  const requestId = React.useRef(0)
  const loadedScope = React.useRef<{ load: typeof load; revision: number; expiresAt: number } | null>(null)
  const previousLoader = React.useRef(load)
  const revision = React.useSyncExternalStore(subscribeSkillCatalogInvalidation, getSkillCatalogInvalidationRevision)

  const loadPage = React.useCallback(
    async (options: SkillCatalogPageOptions = {}, delayMs = 0) => {
      activeRequest.current?.abort()
      const controller = new AbortController()
      activeRequest.current = controller
      const id = ++requestId.current
      const startedRevision = getSkillCatalogInvalidationRevision()
      const previousExpiry = loadedScope.current?.expiresAt
      loadedScope.current = null
      const next = options.next?.trim() || undefined
      const append = Boolean(next && !options.forceRefresh && !options.replace)
      dispatch({ type: "load-start", append, clearItems: options.replace, requestId: id })
      try {
        if (delayMs) {
          await new Promise<void>((resolve) => {
            const finish = () => {
              window.clearTimeout(timer)
              controller.signal.removeEventListener("abort", finish)
              resolve()
            }
            const timer = window.setTimeout(finish, delayMs)
            controller.signal.addEventListener("abort", finish, { once: true })
          })
          controller.signal.throwIfAborted()
        }
        const result = await load({ next, forceRefresh: options.forceRefresh, signal: controller.signal })
        if (!controller.signal.aborted) {
          const fetchedAt = Date.parse(result.updatedAt)
          const expiresAt = (Number.isFinite(fetchedAt) ? fetchedAt : Date.now()) + staleTimeMs
          loadedScope.current = {
            load,
            revision: startedRevision,
            expiresAt: append ? Math.min(previousExpiry ?? expiresAt, expiresAt) : expiresAt,
          }
          dispatch({ type: "load-success", append, catalog: result, requestId: id })
        }
      } catch (cause) {
        if (!controller.signal.aborted) {
          dispatch({ type: "load-error", error: cause instanceof Error ? cause.message : String(cause), requestId: id })
        }
      } finally {
        if (activeRequest.current === controller) activeRequest.current = null
      }
    },
    [load, staleTimeMs],
  )

  React.useEffect(() => {
    if (
      enabled &&
      (loadedScope.current?.load !== load ||
        loadedScope.current.revision !== revision ||
        Date.now() >= loadedScope.current.expiresAt)
    ) {
      const replace = previousLoader.current !== load
      previousLoader.current = load
      void loadPage({ replace }, debounceMs)
    }
    return () => {
      activeRequest.current?.abort()
    }
  }, [debounceMs, enabled, load, loadPage, revision])

  return { catalog, dispatch, loadPage }
}
