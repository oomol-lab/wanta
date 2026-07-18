import type { SessionInfo } from "../../../electron/session/common.ts"

export interface SidebarSessionGroups {
  pinned: SessionInfo[]
  regular: SessionInfo[]
}

export interface SidebarSessionOrder {
  getSessionRunStartedAt?: (sessionId: string) => number | null
  isSessionRunning?: (sessionId: string) => boolean
}

function validTimestamp(value: number | null | undefined): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0
}

export function sessionRunStartedAt(session: SessionInfo, order: SidebarSessionOrder = {}): number | null {
  if (!order.isSessionRunning?.(session.id)) {
    return null
  }
  const startedAt = order.getSessionRunStartedAt?.(session.id)
  return validTimestamp(startedAt) ? startedAt : session.updatedAt
}

export function compareRunningSessions(left: SessionInfo, right: SessionInfo, order: SidebarSessionOrder = {}): number {
  const leftStartedAt = sessionRunStartedAt(left, order)
  const rightStartedAt = sessionRunStartedAt(right, order)
  if (leftStartedAt === null && rightStartedAt === null) {
    return 0
  }
  if (leftStartedAt === null) {
    return 1
  }
  if (rightStartedAt === null) {
    return -1
  }
  return rightStartedAt - leftStartedAt
}

export function compareSidebarSessions(left: SessionInfo, right: SessionInfo, order: SidebarSessionOrder = {}): number {
  return (
    compareRunningSessions(left, right, order) || right.createdAt - left.createdAt || left.id.localeCompare(right.id)
  )
}

export function groupSidebarSessions(sessions: SessionInfo[], order: SidebarSessionOrder = {}): SidebarSessionGroups {
  return {
    pinned: sessions
      .filter((session) => session.pinnedAt && !session.archivedAt)
      .sort((a, b) => compareRunningSessions(a, b, order) || (b.pinnedAt ?? 0) - (a.pinnedAt ?? 0)),
    regular: sessions
      .filter((session) => !session.pinnedAt && !session.archivedAt)
      .sort((a, b) => compareSidebarSessions(a, b, order)),
  }
}

export function runningProjectIds(
  sessions: SessionInfo[],
  isSessionRunning: (sessionId: string) => boolean,
): Set<string> {
  const projectIds = new Set<string>()
  for (const session of sessions) {
    if (session.projectId && !session.archivedAt && isSessionRunning(session.id)) {
      projectIds.add(session.projectId)
    }
  }
  return projectIds
}

export function nextActiveSessionIdAfterArchive(sessions: SessionInfo[], archivedId: string): string | null {
  const remaining = sessions.filter((session) => session.id !== archivedId && !session.archivedAt)
  return remaining[0]?.id ?? null
}
