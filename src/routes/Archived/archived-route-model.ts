import type { SessionInfo } from "../../../electron/session/common.ts"

export type ArchivedSortMode = "createdAt" | "title" | "updatedAt"

export function filterArchivedSessions(sessions: SessionInfo[], query: string): SessionInfo[] {
  const normalizedQuery = query.trim().toLocaleLowerCase()
  if (!normalizedQuery) {
    return sessions
  }
  return sessions.filter((session) => session.title.toLocaleLowerCase().includes(normalizedQuery))
}

export function sortArchivedSessions(sessions: SessionInfo[], sortMode: ArchivedSortMode): SessionInfo[] {
  return [...sessions].sort((a, b) => {
    switch (sortMode) {
      case "createdAt":
        return b.createdAt - a.createdAt
      case "title":
        return a.title.localeCompare(b.title)
      case "updatedAt":
        return b.updatedAt - a.updatedAt
    }
  })
}

export function visibleArchivedSessions(
  sessions: SessionInfo[],
  query: string,
  sortMode: ArchivedSortMode,
): SessionInfo[] {
  return sortArchivedSessions(filterArchivedSessions(sessions, query), sortMode)
}
