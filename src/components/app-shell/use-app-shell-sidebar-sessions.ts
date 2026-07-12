import type { SessionInfo, SessionProject } from "../../../electron/session/common.ts"
import type { SidebarSegment } from "./sidebar-persistence.ts"

import * as React from "react"
import { buildProjectSidebarGroups, projectSidebarSessionsInRenderOrder } from "./app-sidebar-model.ts"
import { compareRunningSessions, groupSidebarSessions } from "./sidebar-sessions.ts"

export function useAppShellSidebarSessions({
  getSessionRunStartedAt,
  isSessionRunning,
  projectSessions,
  projects,
  selectedSessionId,
  sidebarSegment,
  taskSessions,
}: {
  getSessionRunStartedAt: (sessionId: string) => number | null
  isSessionRunning: (sessionId: string) => boolean
  projectSessions: SessionInfo[]
  projects: SessionProject[]
  selectedSessionId: string | null
  sidebarSegment: SidebarSegment
  taskSessions: SessionInfo[]
}) {
  const sessionOrder = React.useMemo(
    () => ({ getSessionRunStartedAt, isSessionRunning }),
    [getSessionRunStartedAt, isSessionRunning],
  )
  const taskGroups = React.useMemo(() => groupSidebarSessions(taskSessions, sessionOrder), [sessionOrder, taskSessions])
  const pinnedProjectSessions = React.useMemo(() => {
    const pinnedProjectIds = new Set(projects.filter((project) => project.pinnedAt).map((project) => project.id))
    return projectSessions
      .filter(
        (session) =>
          session.projectId && !pinnedProjectIds.has(session.projectId) && session.pinnedAt && !session.archivedAt,
      )
      .sort((a, b) => compareRunningSessions(a, b, sessionOrder) || (b.pinnedAt ?? 0) - (a.pinnedAt ?? 0))
  }, [projectSessions, projects, sessionOrder])
  const projectGroups = React.useMemo(
    () => buildProjectSidebarGroups(projects, projectSessions, sessionOrder, { selectedSessionId }),
    [projectSessions, projects, selectedSessionId, sessionOrder],
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
