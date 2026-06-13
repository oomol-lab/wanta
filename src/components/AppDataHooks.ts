import type { AuthState } from "../../electron/auth/common.ts"
import type {
  MyPublishedSkillCatalog,
  SkillInventory,
  SkillShareInfo,
  SkillVersionReport,
} from "../../electron/skills/common.ts"
import type { ResourceView } from "@/lib/resource-store"
import type { SkillShareInfoEntry, SkillShareInfoSnapshot } from "@/lib/skill-share-info-store"

import * as React from "react"
import { useAppDataResources } from "@/components/AppDataContext"
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

    void resource.refresh().catch(() => {
      // 错误保存在 resource snapshot 中，页面按状态展示。
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

export function useMyPublishedSkillsResource(): ResourceView<MyPublishedSkillCatalog> {
  return useResource(useAppDataResources().myPublishedSkills)
}

export function useSkillInventoryResource(): ResourceView<SkillInventory> {
  return useResource(useAppDataResources().skillInventory)
}

export function useSkillShareInfoStore(): {
  ensure(packageNames: readonly (string | undefined)[]): void
  getEntry(packageName: string | undefined): SkillShareInfoEntry | undefined
  refreshPackage(packageName: string | undefined, options?: { forceRefresh?: boolean }): Promise<SkillShareInfo>
  setInfo(packageName: string | undefined, info: SkillShareInfo): void
  snapshot: SkillShareInfoSnapshot
} {
  const store = useAppDataResources().skillShareInfo
  const snapshot = React.useSyncExternalStore(
    React.useCallback((listener) => store.subscribe(listener), [store]),
    React.useCallback(() => store.getSnapshot(), [store]),
    React.useCallback(() => store.getSnapshot(), [store]),
  )

  return React.useMemo(
    () => ({
      ensure: (packageNames) => store.ensure(packageNames),
      getEntry: (packageName) => {
        const normalized = packageName?.trim()
        return normalized ? snapshot[normalized] : undefined
      },
      refreshPackage: (packageName, options) => store.refreshPackage(packageName, options),
      setInfo: (packageName, info) => store.setInfo(packageName, info),
      snapshot,
    }),
    [snapshot, store],
  )
}

export function useSkillVersionReportResource(): ResourceView<SkillVersionReport> {
  return useResource(useAppDataResources().skillVersions, { autoLoad: false })
}
