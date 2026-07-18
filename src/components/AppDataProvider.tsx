import type { AuthState } from "../../electron/auth/common.ts"
import type { SkillInventory } from "../../electron/skills/common.ts"
import type { AppDataResources } from "@/components/AppDataContext"

import * as React from "react"
import { useAppContext } from "@/components/AppContext"
import { AppDataContext } from "@/components/AppDataContext"
import { clearBillingOverviewCache } from "@/hooks/useBillingOverview"
import { clearAvatarImageCache } from "@/lib/avatar-image-cache"
import { clearConnectorCache } from "@/lib/connections-client"
import { clearOrganizationDetailsResources } from "@/lib/organization-details-resource"
import { reportRendererHandledError } from "@/lib/renderer-diagnostics"
import { createResource } from "@/lib/resource-store"
import { clearSkillCatalogCache } from "@/lib/skills-catalog-client"

const backgroundRefreshMs = 60_000
const refreshMetadataKeys = new Set(["updatedAt", "checkedAt"])

function normalizeRefreshData(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(normalizeRefreshData)
  }

  if (!value || typeof value !== "object") {
    return value
  }

  return Object.fromEntries(
    Object.entries(value)
      .filter(([key]) => !refreshMetadataKeys.has(key))
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entryValue]) => [key, normalizeRefreshData(entryValue)]),
  )
}

function isRefreshDataEqual<T>(current: T, next: T): boolean {
  return JSON.stringify(normalizeRefreshData(current)) === JSON.stringify(normalizeRefreshData(next))
}

function authCacheScope(state: AuthState | null): string | null {
  if (!state) {
    return null
  }
  return state.status === "authenticated" && state.account ? `account:${state.account.id}` : "unauthenticated"
}

export function AppDataProvider({ children }: { children: React.ReactNode }) {
  const { authService, skillService } = useAppContext()
  const resources = React.useMemo<AppDataResources>(() => {
    return {
      authState: createResource<AuthState>({
        isEqualData: isRefreshDataEqual,
        staleTimeMs: 10_000,
        load: () => authService.invoke("getAuthState"),
      }),
      skillInventory: createResource<SkillInventory>({
        isEqualData: isRefreshDataEqual,
        // 主进程 watcher 会在技能变化时主动失效；较长 TTL 仅兜底发现启动时尚不存在的技能目录。
        staleTimeMs: 5 * 60_000,
        load: () => skillService.invoke("getSkillInventory"),
      }),
      skillVersions: createResource({
        staleTimeMs: 30 * 60_000,
        load: (options) => skillService.invoke("checkSkillVersions", { forceRefresh: options.forceRefresh }),
      }),
    }
  }, [authService, skillService])

  React.useEffect(() => {
    return authService.serverEvents.on("authStateChanged", (nextAuthState) => {
      clearConnectorCache()
      clearSkillCatalogCache()
      const currentAuthState = resources.authState.getSnapshot().data
      if (authCacheScope(currentAuthState) !== authCacheScope(nextAuthState)) {
        clearAvatarImageCache()
        clearBillingOverviewCache()
        clearOrganizationDetailsResources()
      }
      resources.authState.setData(nextAuthState)
      resources.skillInventory.invalidate()
      resources.skillVersions.invalidate()
      if (nextAuthState.status === "authenticated") {
        void resources.skillInventory
          .refresh({ forceRefresh: true, silent: true })
          .catch((error: unknown) =>
            reportRendererHandledError("app-data", "silent skill inventory refresh failed after auth change", error),
          )
        void resources.skillVersions
          .refresh({ silent: true })
          .catch((error: unknown) =>
            reportRendererHandledError("app-data", "silent skill version refresh failed after auth change", error),
          )
      } else {
        resources.skillInventory.reset()
        resources.skillVersions.reset()
      }
    })
  }, [authService.serverEvents, resources])

  React.useEffect(() => {
    return skillService.serverEvents.on("skillInventoryChanged", () => {
      void resources.skillInventory
        .refresh({ forceRefresh: true, silent: true })
        .catch((error: unknown) =>
          reportRendererHandledError("app-data", "silent skill inventory refresh failed after inventory event", error),
        )
      resources.skillVersions.invalidate()
    })
  }, [resources, skillService.serverEvents])

  React.useEffect(() => {
    let timer: number | undefined

    const refresh = () => {
      if (document.visibilityState !== "visible") {
        return
      }
      void resources.authState
        .refresh({ silent: true })
        .catch((error: unknown) => reportRendererHandledError("app-data", "silent auth state refresh failed", error))
      void resources.skillInventory
        .refresh({ silent: true })
        .catch((error: unknown) =>
          reportRendererHandledError("app-data", "silent skill inventory refresh failed", error),
        )
    }

    const sync = () => {
      if (document.visibilityState === "visible") {
        refresh()
        timer ??= window.setInterval(refresh, backgroundRefreshMs)
        return
      }
      if (timer !== undefined) {
        window.clearInterval(timer)
        timer = undefined
      }
    }

    document.addEventListener("visibilitychange", sync)
    window.addEventListener("focus", refresh)
    sync()

    return () => {
      document.removeEventListener("visibilitychange", sync)
      window.removeEventListener("focus", refresh)
      if (timer !== undefined) {
        window.clearInterval(timer)
      }
    }
  }, [resources])

  return <AppDataContext.Provider value={resources}>{children}</AppDataContext.Provider>
}
