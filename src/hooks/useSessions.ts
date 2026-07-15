import type {
  CreateProjectRequest,
  GenerateSessionTitleRequest,
  GenerateSessionTitleResult,
  SessionInfo,
  SessionProject,
  SessionScope,
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
  setSessionPermissionMode: (id: string, permissionMode: SessionInfo["permissionMode"]) => Promise<void>
  setSessionKnowledgeBases: (id: string, knowledgeBaseIds: string[]) => Promise<void>
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

export function useSessions({ enabled = true, scope }: { enabled?: boolean; scope: SessionScope | null }): UseSessions {
  const sessionService = useSessionService()
  const organizationId = scope?.organizationId ?? ""
  const organizationName = scope?.organizationName ?? ""
  const requestScope = React.useMemo<SessionScope>(
    () => ({ organizationId, organizationName }),
    [organizationId, organizationName],
  )
  const [sessions, setSessions] = React.useState<SessionInfo[]>([])
  const [projects, setProjects] = React.useState<SessionProject[]>([])
  const [loaded, setLoaded] = React.useState(false)
  const [loadedScopeKey, setLoadedScopeKey] = React.useState<string | null>(null)
  const [error, setError] = React.useState<UserFacingError | null>(null)
  const enabledRef = React.useRef(enabled)
  const requestSequenceRef = React.useRef(0)
  const localCreatedSessionsRef = React.useRef(new Map<string, SessionInfo>())
  const permissionModeWriteQueuesRef = React.useRef(new Map<string, Promise<void>>())
  const permissionModeWriteVersionsRef = React.useRef(new Map<string, number>())
  const knowledgeBasesWriteQueuesRef = React.useRef(new Map<string, Promise<void>>())
  const knowledgeBasesWriteVersionsRef = React.useRef(new Map<string, number>())
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
    enabledRef.current = enabled
    if (!enabled) {
      requestSequenceRef.current += 1
      localCreatedSessionsRef.current.clear()
    }
  }, [enabled])

  React.useEffect(() => {
    requestSequenceRef.current += 1
    localCreatedSessionsRef.current.clear()
    setSessions([])
    setProjects([])
    setLoaded(false)
    setLoadedScopeKey(null)
    setError(null)
  }, [scopeKey])

  const refresh = React.useCallback(async () => {
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
      }
      const localCreatedSessions = [...localCreatedSessionsRef.current.values()]
      setSessions(mergeSessionsWithLocalCreated(nextSessions, localCreatedSessions))
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
    return sessionService.serverEvents.on("sessionsChanged", () => {
      if (!enabledRef.current) {
        return
      }
      void refresh()
    })
  }, [enabled, sessionService, refresh])

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

  const setSessionPermissionMode = React.useCallback(
    async (id: string, permissionMode: SessionInfo["permissionMode"]) => {
      const mutationScopeKey = scopeKey
      const normalizedPermissionMode = permissionMode ?? "default"
      const version = (permissionModeWriteVersionsRef.current.get(id) ?? 0) + 1
      permissionModeWriteVersionsRef.current.set(id, version)
      const previousWrite = permissionModeWriteQueuesRef.current.get(id) ?? Promise.resolve()
      const queuedWrite = previousWrite
        .catch(() => undefined)
        .then(() => sessionService.invoke("setPermissionMode", { id, permissionMode: normalizedPermissionMode }))
      const trackedWrite = queuedWrite.catch(() => undefined).then(() => undefined)
      permissionModeWriteQueuesRef.current.set(id, trackedWrite)
      void trackedWrite.finally(() => {
        if (permissionModeWriteQueuesRef.current.get(id) === trackedWrite) {
          permissionModeWriteQueuesRef.current.delete(id)
        }
      })

      await queuedWrite
      if (permissionModeWriteVersionsRef.current.get(id) !== version || !isCurrentScope(mutationScopeKey)) {
        return
      }
      const applyPermissionMode = (session: SessionInfo): SessionInfo =>
        session.id === id
          ? (() => {
              const next = { ...session }
              if (normalizedPermissionMode === "full_access") {
                next.permissionMode = normalizedPermissionMode
              } else {
                delete next.permissionMode
              }
              return next
            })()
          : session
      setSessions((current) => current.map(applyPermissionMode))
    },
    [isCurrentScope, scopeKey, sessionService],
  )

  const setSessionKnowledgeBases = React.useCallback(
    async (id: string, knowledgeBaseIds: string[]) => {
      const mutationScopeKey = scopeKey
      const normalizedIds = [...new Set(knowledgeBaseIds.map((item) => item.trim()).filter(Boolean))]
      const version = (knowledgeBasesWriteVersionsRef.current.get(id) ?? 0) + 1
      knowledgeBasesWriteVersionsRef.current.set(id, version)
      const previousWrite = knowledgeBasesWriteQueuesRef.current.get(id) ?? Promise.resolve()
      const queuedWrite = previousWrite
        .catch(() => undefined)
        .then(() => sessionService.invoke("setKnowledgeBases", { id, knowledgeBaseIds: normalizedIds }))
      const trackedWrite = queuedWrite.catch(() => undefined).then(() => undefined)
      knowledgeBasesWriteQueuesRef.current.set(id, trackedWrite)
      void trackedWrite.finally(() => {
        if (knowledgeBasesWriteQueuesRef.current.get(id) === trackedWrite) {
          knowledgeBasesWriteQueuesRef.current.delete(id)
        }
      })

      await queuedWrite
      if (knowledgeBasesWriteVersionsRef.current.get(id) !== version || !isCurrentScope(mutationScopeKey)) return
      setSessions((current) =>
        current.map((session) => {
          if (session.id !== id) return session
          const next = { ...session }
          if (normalizedIds.length > 0) next.knowledgeBaseIds = normalizedIds
          else delete next.knowledgeBaseIds
          return next
        }),
      )
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
      await sessionService.invoke("rename", { id, title })
    },
    [sessionService],
  )

  const pin = React.useCallback(
    async (id: string, pinned: boolean) => {
      await sessionService.invoke("pin", { id, pinned })
    },
    [sessionService],
  )

  const archive = React.useCallback(
    async (id: string) => {
      const mutationScopeKey = scopeKey
      await sessionService.invoke("archive", id)
      if (!isCurrentScope(mutationScopeKey)) {
        return
      }
      localCreatedSessionsRef.current.delete(id)
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
    setSessionPermissionMode,
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
