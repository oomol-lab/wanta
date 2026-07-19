import type {
  CreateProjectRequest,
  GenerateSessionTitleRequest,
  GenerateSessionTitleResult,
  SessionInfo,
  SessionProject,
  SessionScope,
  SessionsChangedEvent,
} from "../../electron/session/common.ts"
import type { UserFacingError } from "../lib/user-facing-error.ts"

import * as React from "react"
import { useSessionService } from "../components/AppContext.ts"
import { resolveUserFacingError } from "../lib/user-facing-error.ts"
import { sessionScopeKey } from "@/components/app-shell/app-shell-model"
import { reportRendererHandledError } from "@/lib/renderer-diagnostics"

export function mergeSessionsWithLocalCreated(
  remoteSessions: SessionInfo[],
  localCreatedSessions: Iterable<SessionInfo>,
): SessionInfo[] {
  const seen = new Set(remoteSessions.map((session) => session.id))
  const merged = [...remoteSessions]
  for (const session of localCreatedSessions) {
    if (seen.has(session.id)) {
      continue
    }
    seen.add(session.id)
    merged.push(session)
  }
  return merged.sort((a, b) => b.updatedAt - a.updatedAt)
}

export function applySessionActivity(sessions: SessionInfo[], event: SessionsChangedEvent): SessionInfo[] {
  const activity = event.activity
  if (!activity) {
    return sessions
  }
  const index = sessions.findIndex((session) => session.id === activity.sessionId)
  if (index < 0 || sessions[index]!.updatedAt >= activity.usedAt) {
    return sessions
  }
  const next = [...sessions]
  next[index] = { ...next[index]!, updatedAt: activity.usedAt }
  return next
}

export function applySessionTitle(sessions: SessionInfo[], id: string, title: string): SessionInfo[] {
  return sessions.map((session) => (session.id === id ? { ...session, title } : session))
}

export function applySessionPinned(
  sessions: SessionInfo[],
  id: string,
  pinned: boolean,
  pinnedAt = Date.now(),
): SessionInfo[] {
  return sessions.map((session) => {
    if (session.id !== id) {
      return session
    }
    const next = { ...session }
    if (pinned) {
      next.pinnedAt = pinnedAt
    } else {
      delete next.pinnedAt
    }
    return next
  })
}

function sortSessionProjects(projects: SessionProject[]): SessionProject[] {
  return [...projects].sort((a, b) => {
    const pinnedDiff = (b.pinnedAt ?? 0) - (a.pinnedAt ?? 0)
    return pinnedDiff || b.updatedAt - a.updatedAt
  })
}

function upsertSessionProject(projects: SessionProject[], project: SessionProject): SessionProject[] {
  const next = projects.filter((item) => item.id !== project.id)
  next.push(project)
  return sortSessionProjects(next)
}

export interface UseSessions {
  sessions: SessionInfo[]
  taskSessions: SessionInfo[]
  projectSessions: SessionInfo[]
  projects: SessionProject[]
  loaded: boolean
  loadedScopeKey: string | null
  error: UserFacingError | null
  create: (title?: string, projectId?: string) => Promise<SessionInfo>
  listArchived: () => Promise<SessionInfo[]>
  createProject: (req: Omit<CreateProjectRequest, "scope">) => Promise<SessionProject>
  assignSessionProject: (sessionId: string, projectId?: string) => Promise<void>
  setSessionKnowledgeBases: (id: string, update: KnowledgeBaseIdsUpdate) => Promise<void>
  renameProject: (id: string, name: string) => Promise<void>
  pinProject: (id: string, pinned: boolean) => Promise<void>
  archiveProject: (id: string) => Promise<void>
  removeProject: (id: string) => Promise<void>
  generateTitle: (req: GenerateSessionTitleRequest) => Promise<GenerateSessionTitleResult>
  rename: (id: string, title: string) => Promise<void>
  pin: (id: string, pinned: boolean) => Promise<void>
  archive: (id: string) => Promise<void>
  unarchive: (id: string) => Promise<SessionInfo | null>
  remove: (id: string) => Promise<void>
  refresh: () => Promise<void>
}

export type KnowledgeBaseIdsUpdate = string[] | ((current: string[]) => string[])

interface SessionRefreshFlight {
  activation: number
  promise: Promise<void>
  trailing: boolean
}

export function resolveKnowledgeBaseIdsUpdate(current: string[], update: KnowledgeBaseIdsUpdate): string[] {
  const next = typeof update === "function" ? update(current) : update
  return [...new Set(next.map((item) => item.trim()).filter(Boolean))]
}

function applySessionKnowledgeBaseIds(session: SessionInfo, knowledgeBaseIds: string[]): SessionInfo {
  const next = { ...session }
  if (knowledgeBaseIds.length > 0) next.knowledgeBaseIds = knowledgeBaseIds
  else delete next.knowledgeBaseIds
  return next
}

function applyIntendedKnowledgeBaseIds(
  sessions: SessionInfo[],
  intendedBySession: ReadonlyMap<string, string[]>,
): SessionInfo[] {
  return sessions.map((session) => {
    const intended = intendedBySession.get(session.id)
    return intended ? applySessionKnowledgeBaseIds(session, intended) : session
  })
}

export function useSessions({ enabled = true, scope }: { enabled?: boolean; scope: SessionScope | null }): UseSessions {
  const sessionService = useSessionService()
  const teamId = scope?.teamId ?? ""
  const teamName = scope?.teamName ?? ""
  const requestScope = React.useMemo<SessionScope>(() => ({ teamId, teamName }), [teamId, teamName])
  const [sessions, setSessions] = React.useState<SessionInfo[]>([])
  const sessionsRef = React.useRef(sessions)
  sessionsRef.current = sessions
  const [projects, setProjects] = React.useState<SessionProject[]>([])
  const [loaded, setLoaded] = React.useState(false)
  const [loadedScopeKey, setLoadedScopeKey] = React.useState<string | null>(null)
  const [error, setError] = React.useState<UserFacingError | null>(null)
  const enabledRef = React.useRef(enabled)
  const requestSequenceRef = React.useRef(0)
  const refreshActivationRef = React.useRef(0)
  const refreshFlightsRef = React.useRef(new Map<string, SessionRefreshFlight>())
  const localCreatedSessionsRef = React.useRef(new Map<string, SessionInfo>())
  const knowledgeBasesWriteQueuesRef = React.useRef(new Map<string, Promise<void>>())
  const knowledgeBasesWriteVersionsRef = React.useRef(new Map<string, number>())
  const knowledgeBasesNextWriteVersionRef = React.useRef(0)
  const knowledgeBasesIntendedIdsRef = React.useRef(new Map<string, string[]>())
  const knowledgeBasesPersistedIdsRef = React.useRef(new Map<string, string[]>())
  const scopeKey = sessionScopeKey(requestScope)
  const currentScopeKeyRef = React.useRef(scopeKey)
  currentScopeKeyRef.current = scopeKey
  const taskSessions = React.useMemo(
    () => sessions.filter((session) => !session.projectId && !session.archivedAt),
    [sessions],
  )
  const projectSessions = React.useMemo(
    () => sessions.filter((session) => Boolean(session.projectId) && !session.archivedAt),
    [sessions],
  )

  const isCurrentScope = React.useCallback(
    (expectedScopeKey: string): boolean => enabledRef.current && currentScopeKeyRef.current === expectedScopeKey,
    [],
  )

  React.useEffect(() => {
    refreshActivationRef.current += 1
  }, [enabled, scopeKey])

  React.useEffect(() => {
    enabledRef.current = enabled
    if (!enabled) {
      requestSequenceRef.current += 1
      localCreatedSessionsRef.current.clear()
      knowledgeBasesWriteQueuesRef.current.clear()
      knowledgeBasesWriteVersionsRef.current.clear()
      knowledgeBasesIntendedIdsRef.current.clear()
      knowledgeBasesPersistedIdsRef.current.clear()
    }
  }, [enabled])

  React.useEffect(() => {
    requestSequenceRef.current += 1
    localCreatedSessionsRef.current.clear()
    knowledgeBasesWriteQueuesRef.current.clear()
    knowledgeBasesWriteVersionsRef.current.clear()
    knowledgeBasesIntendedIdsRef.current.clear()
    knowledgeBasesPersistedIdsRef.current.clear()
    setSessions([])
    setProjects([])
    setLoaded(false)
    setLoadedScopeKey(null)
    setError(null)
  }, [scopeKey])

  const refreshOnce = React.useCallback(async () => {
    const refreshScopeKey = scopeKey
    if (currentScopeKeyRef.current !== refreshScopeKey) {
      return
    }
    const requestId = ++requestSequenceRef.current
    if (!enabled) {
      setSessions([])
      setProjects([])
      setLoaded(false)
      setLoadedScopeKey(null)
      setError(null)
      return
    }
    try {
      const [nextSessions, nextProjects] = await Promise.all([
        sessionService.invoke("list", { placement: "all", scope: requestScope }),
        sessionService.invoke("listProjects", { scope: requestScope }),
      ])
      if (requestId !== requestSequenceRef.current || !isCurrentScope(refreshScopeKey)) {
        return
      }
      for (const session of nextSessions) {
        localCreatedSessionsRef.current.delete(session.id)
        if (!knowledgeBasesWriteQueuesRef.current.has(session.id)) {
          knowledgeBasesPersistedIdsRef.current.set(session.id, session.knowledgeBaseIds ?? [])
        }
      }
      const localCreatedSessions = [...localCreatedSessionsRef.current.values()]
      setSessions(
        applyIntendedKnowledgeBaseIds(
          mergeSessionsWithLocalCreated(nextSessions, localCreatedSessions),
          knowledgeBasesIntendedIdsRef.current,
        ),
      )
      setProjects(nextProjects)
      setError(null)
    } catch (error) {
      console.error("[wanta] list sessions failed", error)
      reportRendererHandledError("session", "list sessions failed", error)
      if (requestId === requestSequenceRef.current && isCurrentScope(refreshScopeKey)) {
        setError(resolveUserFacingError(error, { area: "session" }))
      }
    } finally {
      if (requestId === requestSequenceRef.current && isCurrentScope(refreshScopeKey)) {
        setLoaded(true)
        setLoadedScopeKey(scopeKey)
      }
    }
  }, [enabled, isCurrentScope, requestScope, scopeKey, sessionService])

  const runRefresh = React.useCallback(
    (trailingIfRunning: boolean): Promise<void> => {
      const activation = refreshActivationRef.current
      const activeFlight = refreshFlightsRef.current.get(scopeKey)
      if (activeFlight?.activation === activation) {
        if (trailingIfRunning) {
          activeFlight.trailing = true
        }
        return activeFlight.promise
      }

      const entry: SessionRefreshFlight = {
        activation,
        promise: Promise.resolve(),
        trailing: false,
      }
      entry.promise = (async () => {
        do {
          entry.trailing = false
          await refreshOnce()
        } while (
          entry.trailing &&
          enabledRef.current &&
          refreshActivationRef.current === activation &&
          currentScopeKeyRef.current === scopeKey
        )
      })().finally(() => {
        if (refreshFlightsRef.current.get(scopeKey) === entry) {
          refreshFlightsRef.current.delete(scopeKey)
        }
      })
      refreshFlightsRef.current.set(scopeKey, entry)
      return entry.promise
    },
    [refreshOnce, scopeKey],
  )

  const refresh = React.useCallback((): Promise<void> => runRefresh(false), [runRefresh])

  React.useEffect(() => {
    if (!enabled) {
      setSessions([])
      setProjects([])
      setLoaded(false)
      setLoadedScopeKey(null)
      setError(null)
      return
    }
    void refresh()
    return sessionService.serverEvents.on("sessionsChanged", (event) => {
      if (!enabledRef.current) {
        return
      }
      if (event.activity) {
        setSessions((current) => applySessionActivity(current, event))
        return
      }
      void runRefresh(true)
    })
  }, [enabled, sessionService, refresh, runRefresh])

  const create = React.useCallback(
    async (title?: string, projectId?: string) => {
      const mutationScopeKey = scopeKey
      const info = await sessionService.invoke("create", { projectId, scope: requestScope, title })
      if (!isCurrentScope(mutationScopeKey)) {
        return info
      }
      localCreatedSessionsRef.current.set(info.id, info)
      setSessions((current) => mergeSessionsWithLocalCreated(current, [info]))
      return info
    },
    [isCurrentScope, requestScope, scopeKey, sessionService],
  )

  const listArchived = React.useCallback(async () => {
    return sessionService.invoke("listArchived", { scope: requestScope })
  }, [requestScope, sessionService])

  const createProject = React.useCallback(
    async (req: Omit<CreateProjectRequest, "scope">) => {
      const mutationScopeKey = scopeKey
      const project = await sessionService.invoke("createProject", { ...req, scope: requestScope })
      if (isCurrentScope(mutationScopeKey)) {
        setProjects((current) => upsertSessionProject(current, project))
      }
      return project
    },
    [isCurrentScope, requestScope, scopeKey, sessionService],
  )

  const assignSessionProject = React.useCallback(
    async (sessionId: string, projectId?: string) => {
      const mutationScopeKey = scopeKey
      await sessionService.invoke("assignSessionProject", { sessionId, projectId })
      if (!isCurrentScope(mutationScopeKey)) {
        return
      }
      setSessions((current) =>
        current.map((session) => {
          if (session.id !== sessionId) {
            return session
          }
          const next = { ...session }
          if (projectId) {
            next.projectId = projectId
          } else {
            delete next.projectId
          }
          return next
        }),
      )
    },
    [isCurrentScope, scopeKey, sessionService],
  )

  const setSessionKnowledgeBases = React.useCallback(
    async (id: string, update: KnowledgeBaseIdsUpdate) => {
      const mutationScopeKey = scopeKey
      const session = sessionsRef.current.find((item) => item.id === id)
      const currentIds = knowledgeBasesIntendedIdsRef.current.get(id) ?? session?.knowledgeBaseIds ?? []
      const normalizedIds = resolveKnowledgeBaseIdsUpdate(currentIds, update)
      if (!knowledgeBasesPersistedIdsRef.current.has(id)) {
        knowledgeBasesPersistedIdsRef.current.set(id, session?.knowledgeBaseIds ?? [])
      }
      knowledgeBasesIntendedIdsRef.current.set(id, normalizedIds)
      setSessions((current) =>
        current.map((item) => (item.id === id ? applySessionKnowledgeBaseIds(item, normalizedIds) : item)),
      )
      const version = knowledgeBasesNextWriteVersionRef.current + 1
      knowledgeBasesNextWriteVersionRef.current = version
      knowledgeBasesWriteVersionsRef.current.set(id, version)
      const previousWrite = knowledgeBasesWriteQueuesRef.current.get(id) ?? Promise.resolve()
      const queuedWrite = previousWrite
        .catch(() => undefined)
        .then(async () => {
          await sessionService.invoke("setKnowledgeBases", { id, knowledgeBaseIds: normalizedIds })
          if (isCurrentScope(mutationScopeKey)) {
            knowledgeBasesPersistedIdsRef.current.set(id, normalizedIds)
          }
        })
      const trackedWrite = queuedWrite.catch(() => undefined).then(() => undefined)
      knowledgeBasesWriteQueuesRef.current.set(id, trackedWrite)
      void trackedWrite.finally(() => {
        if (knowledgeBasesWriteQueuesRef.current.get(id) === trackedWrite) {
          knowledgeBasesWriteQueuesRef.current.delete(id)
        }
      })

      try {
        await queuedWrite
      } catch (error) {
        if (knowledgeBasesWriteVersionsRef.current.get(id) === version && isCurrentScope(mutationScopeKey)) {
          knowledgeBasesIntendedIdsRef.current.delete(id)
          const persistedIds = knowledgeBasesPersistedIdsRef.current.get(id) ?? []
          setSessions((current) =>
            current.map((item) => (item.id === id ? applySessionKnowledgeBaseIds(item, persistedIds) : item)),
          )
        }
        throw error
      }
      if (knowledgeBasesWriteVersionsRef.current.get(id) !== version || !isCurrentScope(mutationScopeKey)) return
      knowledgeBasesIntendedIdsRef.current.delete(id)
    },
    [isCurrentScope, scopeKey, sessionService],
  )

  const removeProject = React.useCallback(
    async (id: string) => {
      const mutationScopeKey = scopeKey
      await sessionService.invoke("removeProject", id)
      if (isCurrentScope(mutationScopeKey)) {
        setProjects((current) => current.filter((project) => project.id !== id))
        setSessions((current) =>
          current.map((session) => {
            if (session.projectId !== id) {
              return session
            }
            const next = { ...session }
            delete next.projectId
            return next
          }),
        )
      }
    },
    [isCurrentScope, scopeKey, sessionService],
  )

  const renameProject = React.useCallback(
    async (id: string, name: string) => {
      const mutationScopeKey = scopeKey
      await sessionService.invoke("renameProject", { id, name })
      if (isCurrentScope(mutationScopeKey)) {
        setProjects((current) =>
          sortSessionProjects(
            current.map((project) => (project.id === id ? { ...project, name, updatedAt: Date.now() } : project)),
          ),
        )
      }
    },
    [isCurrentScope, scopeKey, sessionService],
  )

  const pinProject = React.useCallback(
    async (id: string, pinned: boolean) => {
      const mutationScopeKey = scopeKey
      await sessionService.invoke("pinProject", { id, pinned })
      if (isCurrentScope(mutationScopeKey)) {
        const pinnedAt = Date.now()
        setProjects((current) =>
          sortSessionProjects(
            current.map((project) => {
              if (project.id !== id) {
                return project
              }
              const next = { ...project }
              if (pinned) {
                next.pinnedAt = pinnedAt
              } else {
                delete next.pinnedAt
              }
              return next
            }),
          ),
        )
      }
    },
    [isCurrentScope, scopeKey, sessionService],
  )

  const archiveProject = React.useCallback(
    async (id: string) => {
      const mutationScopeKey = scopeKey
      await sessionService.invoke("archiveProject", id)
      if (!isCurrentScope(mutationScopeKey)) {
        return
      }
      setProjects((current) => current.filter((project) => project.id !== id))
      setSessions((current) => current.filter((session) => session.projectId !== id))
    },
    [isCurrentScope, scopeKey, sessionService],
  )

  const generateTitle = React.useCallback(
    async (req: GenerateSessionTitleRequest) => {
      return sessionService.invoke("generateTitle", req)
    },
    [sessionService],
  )

  const rename = React.useCallback(
    async (id: string, title: string) => {
      const mutationScopeKey = scopeKey
      await sessionService.invoke("rename", { id, title })
      if (isCurrentScope(mutationScopeKey)) {
        setSessions((current) => applySessionTitle(current, id, title))
      }
    },
    [isCurrentScope, scopeKey, sessionService],
  )

  const pin = React.useCallback(
    async (id: string, pinned: boolean) => {
      const mutationScopeKey = scopeKey
      await sessionService.invoke("pin", { id, pinned })
      if (isCurrentScope(mutationScopeKey)) {
        setSessions((current) => applySessionPinned(current, id, pinned))
      }
    },
    [isCurrentScope, scopeKey, sessionService],
  )

  const archive = React.useCallback(
    async (id: string) => {
      const mutationScopeKey = scopeKey
      await sessionService.invoke("archive", id)
      if (!isCurrentScope(mutationScopeKey)) {
        return
      }
      localCreatedSessionsRef.current.delete(id)
      knowledgeBasesWriteQueuesRef.current.delete(id)
      knowledgeBasesWriteVersionsRef.current.delete(id)
      knowledgeBasesIntendedIdsRef.current.delete(id)
      knowledgeBasesPersistedIdsRef.current.delete(id)
      setSessions((current) => current.filter((session) => session.id !== id))
    },
    [isCurrentScope, scopeKey, sessionService],
  )

  const unarchive = React.useCallback(
    async (id: string) => {
      return sessionService.invoke("unarchive", id)
    },
    [sessionService],
  )

  const remove = React.useCallback(
    async (id: string) => {
      const mutationScopeKey = scopeKey
      await sessionService.invoke("remove", id)
      if (!isCurrentScope(mutationScopeKey)) {
        return
      }
      localCreatedSessionsRef.current.delete(id)
      knowledgeBasesWriteQueuesRef.current.delete(id)
      knowledgeBasesWriteVersionsRef.current.delete(id)
      knowledgeBasesIntendedIdsRef.current.delete(id)
      knowledgeBasesPersistedIdsRef.current.delete(id)
      setSessions((current) => current.filter((session) => session.id !== id))
    },
    [isCurrentScope, scopeKey, sessionService],
  )

  return {
    sessions,
    taskSessions,
    projectSessions,
    projects,
    loaded,
    loadedScopeKey,
    error,
    create,
    listArchived,
    createProject,
    assignSessionProject,
    setSessionKnowledgeBases,
    renameProject,
    pinProject,
    archiveProject,
    removeProject,
    generateTitle,
    rename,
    pin,
    archive,
    unarchive,
    remove,
    refresh,
  }
}
