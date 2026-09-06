import type { AuthState } from "../../electron/auth/common.ts"
import type { SkillInventory, SkillVersionReport } from "../../electron/skills/common.ts"
import type { ResourceView } from "@/lib/resource-store"

import * as React from "react"
import { useAppDataResources } from "@/components/AppDataContext"
import { reportRendererHandledError } from "@/lib/renderer-diagnostics"
import { ResourceStore, toResourceView } from "@/lib/resource-store"

function useResource<T>(
  resource: ResourceStore<T>,
  options: { autoLoad?: boolean; reloadOnInvalidate?: boolean } = {},
): ResourceView<T> {
  const snapshot = React.useSyncExternalStore(
    React.useCallback((listener) => resource.subscribe(listener), [resource]),
    React.useCallback(() => resource.getSnapshot(), [resource]),
    React.useCallback(() => resource.getSnapshot(), [resource]),
  )

  const refresh = React.useCallback(() => {
    void resource.refresh({ silent: options.reloadOnInvalidate }).catch((error: unknown) => {
      reportRendererHandledError("resource", "resource auto-load failed", error)
    })
  }, [resource, options.reloadOnInvalidate])

  React.useEffect(() => {
    if (options.autoLoad !== false) refresh()
  }, [options.autoLoad, refresh])

  React.useEffect(() => {
    if (
      options.autoLoad !== false &&
      options.reloadOnInvalidate &&
      snapshot.updatedAt === null &&
      snapshot.error === null &&
      (snapshot.status === "idle" || snapshot.status === "ready")
    )
      refresh()
  }, [options.autoLoad, options.reloadOnInvalidate, refresh, snapshot])

  return React.useMemo(() => toResourceView(snapshot, resource), [resource, snapshot])
}

export function useAuthStateResource(): ResourceView<AuthState> {
  return useResource(useAppDataResources().authState)
}

export function useSkillInventoryResource(): ResourceView<SkillInventory> {
  return useResource(useAppDataResources().skillInventory)
}

export function useSkillVersionReportResource(options: { autoLoad?: boolean } = {}): ResourceView<SkillVersionReport> {
  return useResource(useAppDataResources().skillVersions, {
    autoLoad: options.autoLoad ?? false,
    reloadOnInvalidate: true,
  })
}
