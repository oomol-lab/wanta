import type { SessionInfo, SessionProject } from "../../../electron/session/common.ts"
import type { SidebarSegment, SidebarTaskSortMode } from "./sidebar-persistence.ts"

import * as React from "react"
import {
  buildProjectSidebarGroups,
  pinnedProjectSidebarSessions,
  projectSidebarSessionsInRenderOrder,
} from "./app-sidebar-model.ts"
import { groupSidebarSessions } from "./sidebar-sessions.ts"

export function useAppShellSidebarSessions({
  getSessionRunStartedAt,
  isSessionRunning,
  projectSessions,
  projects,
  selectedSessionId,
  sidebarSegment,
  taskSessions,
  taskSortMode,
}: {
  getSessionRunStartedAt: (sessionId: string) => number | null
  isSessionRunning: (sessionId: string) => boolean
  projectSessions: SessionInfo[]
  projects: SessionProject[]
  selectedSessionId: string | null
  sidebarSegment: SidebarSegment
  taskSessions: SessionInfo[]
  taskSortMode: SidebarTaskSortMode
}) {
  const sessionOrder = React.useMemo(
    () => ({ getSessionRunStartedAt, isSessionRunning, sortMode: taskSortMode }),
    [getSessionRunStartedAt, isSessionRunning, taskSortMode],
  )
  const projectSessionOrder = React.useMemo(
    () => ({ getSessionRunStartedAt, isSessionRunning }),
    [getSessionRunStartedAt, isSessionRunning],
  )
  const taskGroups = React.useMemo(() => groupSidebarSessions(taskSessions, sessionOrder), [sessionOrder, taskSessions])
  const pinnedProjectSessions = React.useMemo(
    () => pinnedProjectSidebarSessions(projectSessions, projectSessionOrder),
    [projectSessionOrder, projectSessions],
  )
  const projectGroups = React.useMemo(
    () => buildProjectSidebarGroups(projects, projectSessions, projectSessionOrder, { selectedSessionId }),
    [projectSessionOrder, projectSessions, projects, selectedSessionId],
  )
  const pinnedProjectGroups = React.useMemo(
    () => projectGroups.filter((group) => group.project.pinnedAt),
    [projectGroups],
  )
  const regularProjectGroups = React.useMemo(
    () => projectGroups.filter((group) => !group.project.pinnedAt),
    [projectGroups],
  )
  const selectableTaskSessions = React.useMemo(() => [...taskGroups.pinned, ...taskGroups.regular], [taskGroups])
  const selectableProjectSessions = React.useMemo(
    () =>
      projectSidebarSessionsInRenderOrder({
        pinnedGroups: pinnedProjectGroups,
        pinnedSessions: pinnedProjectSessions,
        regularGroups: regularProjectGroups,
      }),
    [pinnedProjectGroups, pinnedProjectSessions, regularProjectGroups],
  )

  return {
    pinnedProjectGroups,
    pinnedProjectSessions,
    projectGroups,
    regularProjectGroups,
    selectableSessions: sidebarSegment === "projects" ? selectableProjectSessions : selectableTaskSessions,
    taskGroups,
  }
}
