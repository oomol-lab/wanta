import type { SessionProject, SessionScope } from "../../../electron/session/common.ts"

import * as React from "react"
import {
  projectSidebarCollapsedStorageKey,
  pruneCollapsedProjectIds,
  readStoredCollapsedProjectIds,
  setsEqual,
  writeStoredCollapsedProjectIds,
} from "./sidebar-persistence.ts"

interface UseProjectSidebarCollapseStateOptions {
  accountId?: string
  projects: SessionProject[]
  sessionScope: SessionScope | null
  sessionsLoaded: boolean
}

export function useProjectSidebarCollapseState({
  accountId,
  projects,
  sessionScope,
  sessionsLoaded,
}: UseProjectSidebarCollapseStateOptions) {
  const projectCollapsedStorageKey = React.useMemo(
    () => projectSidebarCollapsedStorageKey(accountId, sessionScope),
    [accountId, sessionScope],
  )
  const [collapsedProjectState, setCollapsedProjectState] = React.useState<{
    ids: Set<string>
    storageKey: string | null
  }>({ ids: new Set(), storageKey: null })
  const collapsedProjectIds =
    collapsedProjectState.storageKey === projectCollapsedStorageKey ? collapsedProjectState.ids : new Set<string>()

  React.useEffect(() => {
    setCollapsedProjectState({
      ids: readStoredCollapsedProjectIds(globalThis.localStorage, projectCollapsedStorageKey),
      storageKey: projectCollapsedStorageKey,
    })
  }, [projectCollapsedStorageKey])

  React.useEffect(() => {
    if (!sessionsLoaded || collapsedProjectState.storageKey !== projectCollapsedStorageKey) {
      return
    }
    const projectIds = new Set(projects.map((project) => project.id))
    setCollapsedProjectState((current) => {
      if (current.storageKey !== projectCollapsedStorageKey) {
        return current
      }
      const nextIds = pruneCollapsedProjectIds(current.ids, projectIds)
      return nextIds === current.ids ? current : { ...current, ids: nextIds }
    })
  }, [collapsedProjectState.storageKey, projectCollapsedStorageKey, projects, sessionsLoaded])

  React.useEffect(() => {
    if (!sessionsLoaded || collapsedProjectState.storageKey !== projectCollapsedStorageKey) {
      return
    }
    writeStoredCollapsedProjectIds(globalThis.localStorage, projectCollapsedStorageKey, collapsedProjectState.ids)
  }, [collapsedProjectState, projectCollapsedStorageKey, sessionsLoaded])

  const handleProjectSidebarExpandedChange = React.useCallback(
    (projectId: string, expanded: boolean): void => {
      setCollapsedProjectState((current) => {
        if (current.storageKey !== projectCollapsedStorageKey) {
          return current
        }
        const nextIds = new Set(current.ids)
        if (expanded) {
          nextIds.delete(projectId)
        } else {
          nextIds.add(projectId)
        }
        return setsEqual(current.ids, nextIds) ? current : { ...current, ids: nextIds }
      })
    },
    [projectCollapsedStorageKey],
  )

  return {
    collapsedProjectIds,
    handleProjectSidebarExpandedChange,
  }
}
