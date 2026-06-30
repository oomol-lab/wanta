import type { SessionInfo } from "../../../electron/session/common.ts"

export interface SidebarSessionGroups {
  pinned: SessionInfo[]
  regular: SessionInfo[]
}

export function groupSidebarSessions(sessions: SessionInfo[]): SidebarSessionGroups {
  const taskSessions = sessions.filter((session) => !session.projectId)
  return {
    pinned: taskSessions
      .filter((session) => session.pinnedAt && !session.archivedAt)
      .sort((a, b) => (b.pinnedAt ?? 0) - (a.pinnedAt ?? 0)),
    regular: taskSessions.filter((session) => !session.pinnedAt && !session.archivedAt),
  }
}

export function projectHasRunningSession(
  projectId: string,
  sessions: SessionInfo[],
  isSessionRunning: (sessionId: string) => boolean,
): boolean {
  return sessions.some(
    (session) => session.projectId === projectId && !session.archivedAt && isSessionRunning(session.id),
  )
}

export function nextActiveSessionIdAfterArchive(sessions: SessionInfo[], archivedId: string): string | null {
  const remaining = sessions.filter((session) => session.id !== archivedId && !session.archivedAt)
  return remaining[0]?.id ?? null
}
