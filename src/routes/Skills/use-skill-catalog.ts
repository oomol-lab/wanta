import type { PublicSkillPackageCatalog } from "../../../electron/skills/common.ts"
import type { ListPublicSkillPackagesInput } from "@/lib/skills-catalog-client"

import * as React from "react"
import { initialPublicPackageCatalogState, publicPackageCatalogReducer } from "./skill-route-model.ts"
import { getSkillCatalogInvalidationRevision, subscribeSkillCatalogInvalidation } from "@/lib/skill-catalog-cache"

export interface SkillCatalogPageOptions {
  forceRefresh?: boolean
  next?: string | null
  replace?: boolean
}

/** Owns pagination and request lifetime; cached responses remain in the shared client. */
export function useSkillCatalog({
  enabled,
  load,
}: {
  enabled: boolean
  load: (input: ListPublicSkillPackagesInput) => Promise<PublicSkillPackageCatalog>
}) {
  const [catalog, dispatch] = React.useReducer(publicPackageCatalogReducer, initialPublicPackageCatalogState)
  const activeRequest = React.useRef<AbortController | null>(null)
  const requestId = React.useRef(0)
  const loadedScope = React.useRef<{ load: typeof load; revision: number } | null>(null)
  const previousLoader = React.useRef(load)
  const revision = React.useSyncExternalStore(subscribeSkillCatalogInvalidation, getSkillCatalogInvalidationRevision)

  const loadPage = React.useCallback(
    async (options: SkillCatalogPageOptions = {}) => {
      activeRequest.current?.abort()
      const controller = new AbortController()
      activeRequest.current = controller
      const id = ++requestId.current
      const startedRevision = getSkillCatalogInvalidationRevision()
      loadedScope.current = null
      const next = options.next?.trim() || undefined
      const append = Boolean(next && !options.forceRefresh && !options.replace)
      dispatch({ type: "load-start", append, clearItems: options.replace, requestId: id })
      try {
        const result = await load({ next, forceRefresh: options.forceRefresh, signal: controller.signal })
        if (!controller.signal.aborted) {
          loadedScope.current = { load, revision: startedRevision }
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
    [load],
  )

  React.useEffect(() => {
    if (enabled && (loadedScope.current?.load !== load || loadedScope.current.revision !== revision)) {
      const replace = previousLoader.current !== load
      previousLoader.current = load
      void loadPage({ replace })
    }
    return () => {
      activeRequest.current?.abort()
    }
  }, [enabled, load, loadPage, revision])

  return { catalog, dispatch, loadPage }
}
