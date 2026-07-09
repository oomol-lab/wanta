import type { SessionInfo, SessionProject } from "../../../electron/session/common.ts"
import type { SidebarSessionOrder } from "./sidebar-sessions.ts"

import { compareSidebarSessions, sessionRunStartedAt } from "./sidebar-sessions.ts"

export interface ProjectSidebarGroup {
  hiddenCount: number
  project: SessionProject
  runningStartedAt?: number
  sessions: SessionInfo[]
  updatedAt: number
}

const projectSidebarSessionLimit = 5

function projectRunningStartedAt(sessions: SessionInfo[], order: SidebarSessionOrder): number | undefined {
  const startedAt = Math.max(0, ...sessions.map((session) => sessionRunStartedAt(session, order) ?? 0))
  return startedAt > 0 ? startedAt : undefined
}

function compareProjectSidebarGroups(left: ProjectSidebarGroup, right: ProjectSidebarGroup): number {
  const pinnedDiff = (right.project.pinnedAt ?? 0) - (left.project.pinnedAt ?? 0)
  const leftRunning = left.runningStartedAt ?? 0
  const rightRunning = right.runningStartedAt ?? 0
  if (leftRunning > 0 || rightRunning > 0) {
    return pinnedDiff || rightRunning - leftRunning || right.updatedAt - left.updatedAt
  }
  return pinnedDiff || right.updatedAt - left.updatedAt
}

export function buildProjectSidebarGroups(
  projects: SessionProject[],
  sessions: SessionInfo[],
  order: SidebarSessionOrder = {},
): ProjectSidebarGroup[] {
  const projectById = new Map(projects.map((project) => [project.id, project]))
  const sessionsByProject = new Map<string, SessionInfo[]>()
  for (const session of sessions) {
    if (!session.projectId || session.archivedAt) {
      continue
    }
    const project = projectById.get(session.projectId)
    if (!project || (session.pinnedAt && !project.pinnedAt)) {
      continue
    }
    const current = sessionsByProject.get(session.projectId) ?? []
    current.push(session)
    sessionsByProject.set(session.projectId, current)
  }
  return projects
    .map((project) => {
      const projectSessions = (sessionsByProject.get(project.id) ?? [])
        .filter((session) => !session.archivedAt)
        .sort((a, b) => compareSidebarSessions(a, b, order))
      const visibleSessions = projectSessions.slice(0, projectSidebarSessionLimit)
      const runningStartedAt = projectRunningStartedAt(projectSessions, order)
      const updatedAt = Math.max(
        project.updatedAt,
        runningStartedAt ?? 0,
        ...projectSessions.map((session) => session.updatedAt),
      )
      return {
        project,
        sessions: visibleSessions,
        hiddenCount: Math.max(0, projectSessions.length - visibleSessions.length),
        ...(runningStartedAt ? { runningStartedAt } : {}),
        updatedAt,
      }
    })
    .sort(compareProjectSidebarGroups)
}
