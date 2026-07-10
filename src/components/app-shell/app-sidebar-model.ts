import type { SessionInfo, SessionProject } from "../../../electron/session/common.ts"
import type { SidebarSessionOrder } from "./sidebar-sessions.ts"

import { compareSidebarSessions } from "./sidebar-sessions.ts"

export interface ProjectSidebarGroup {
  hiddenCount: number
  project: SessionProject
  sessions: SessionInfo[]
}

export interface ProjectSidebarOptions {
  selectedSessionId?: string | null
}

const projectSidebarSessionLimit = 5

function compareProjectSidebarGroups(left: ProjectSidebarGroup, right: ProjectSidebarGroup): number {
  const pinnedDiff = (right.project.pinnedAt ?? 0) - (left.project.pinnedAt ?? 0)
  return pinnedDiff || right.project.updatedAt - left.project.updatedAt
}

function visibleProjectSidebarSessions(sessions: SessionInfo[], options: ProjectSidebarOptions = {}): SessionInfo[] {
  const visibleSessions = sessions.slice(0, projectSidebarSessionLimit)
  if (!options.selectedSessionId || visibleSessions.some((session) => session.id === options.selectedSessionId)) {
    return visibleSessions
  }
  const selectedSession = sessions.find((session) => session.id === options.selectedSessionId)
  return selectedSession ? [...visibleSessions, selectedSession] : visibleSessions
}

export function buildProjectSidebarGroups(
  projects: SessionProject[],
  sessions: SessionInfo[],
  order: SidebarSessionOrder = {},
  options: ProjectSidebarOptions = {},
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
      const visibleSessions = visibleProjectSidebarSessions(projectSessions, options)
      return {
        project,
        sessions: visibleSessions,
        hiddenCount: Math.max(0, projectSessions.length - visibleSessions.length),
      }
    })
    .sort(compareProjectSidebarGroups)
}

export function projectSidebarSessionsInRenderOrder({
  pinnedGroups,
  pinnedSessions,
  regularGroups,
}: {
  pinnedGroups: ProjectSidebarGroup[]
  pinnedSessions: SessionInfo[]
  regularGroups: ProjectSidebarGroup[]
}): SessionInfo[] {
  return [
    ...pinnedGroups.flatMap((group) => group.sessions),
    ...pinnedSessions,
    ...regularGroups.flatMap((group) => group.sessions),
  ]
}
