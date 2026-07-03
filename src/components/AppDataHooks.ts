import type { AuthState } from "../../electron/auth/common.ts"
import type { SkillInventory, SkillVersionReport } from "../../electron/skills/common.ts"
import type { ResourceView } from "@/lib/resource-store"

import * as React from "react"
import { useAppDataResources } from "@/components/AppDataContext"
import { reportRendererHandledError } from "@/lib/renderer-diagnostics"
import { ResourceStore, toResourceView } from "@/lib/resource-store"

function useResource<T>(resource: ResourceStore<T>, options: { autoLoad?: boolean } = {}): ResourceView<T> {
  const snapshot = React.useSyncExternalStore(
    React.useCallback((listener) => resource.subscribe(listener), [resource]),
    React.useCallback(() => resource.getSnapshot(), [resource]),
    React.useCallback(() => resource.getSnapshot(), [resource]),
  )

  React.useEffect(() => {
    if (options.autoLoad === false) {
      return
    }

    void resource.refresh().catch((error: unknown) => {
      // 错误保存在 resource snapshot 中，页面按状态展示。
      reportRendererHandledError("resource", "resource auto-load failed", error)
    })
  }, [options.autoLoad, resource])

  return React.useMemo(() => toResourceView(snapshot, resource), [resource, snapshot])
}

export function useAuthStateResource(): ResourceView<AuthState> {
  return useResource(useAppDataResources().authState)
}

export function useHomeSummaryResource(): ResourceView<null> {
  return useResource(useAppDataResources().homeSummary, { autoLoad: false })
}

export function useSkillInventoryResource(): ResourceView<SkillInventory> {
  return useResource(useAppDataResources().skillInventory)
}

export function useSkillVersionReportResource(): ResourceView<SkillVersionReport> {
  return useResource(useAppDataResources().skillVersions, { autoLoad: false })
}
