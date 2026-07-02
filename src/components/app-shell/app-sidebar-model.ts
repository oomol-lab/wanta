import type { SessionInfo, SessionProject } from "../../../electron/session/common.ts"

export interface ProjectSidebarGroup {
  hiddenCount: number
  project: SessionProject
  sessions: SessionInfo[]
  updatedAt: number
}

const projectSidebarSessionLimit = 5

export function buildProjectSidebarGroups(projects: SessionProject[], sessions: SessionInfo[]): ProjectSidebarGroup[] {
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
        .sort((a, b) => b.updatedAt - a.updatedAt)
      const visibleSessions = projectSessions.slice(0, projectSidebarSessionLimit)
      const updatedAt = Math.max(project.updatedAt, ...projectSessions.map((session) => session.updatedAt))
      return {
        project,
        sessions: visibleSessions,
        hiddenCount: Math.max(0, projectSessions.length - visibleSessions.length),
        updatedAt,
      }
    })
    .sort((a, b) => {
      const pinnedDiff = (b.project.pinnedAt ?? 0) - (a.project.pinnedAt ?? 0)
      return pinnedDiff || b.updatedAt - a.updatedAt
    })
}
