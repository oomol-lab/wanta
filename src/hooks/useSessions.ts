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

const personalSessionScope: SessionScope = { type: "personal" }

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
  createProject: (req: CreateProjectRequest) => Promise<SessionProject>
  assignSessionProject: (sessionId: string, projectId?: string) => Promise<void>
  setSessionPermissionMode: (id: string, permissionMode: SessionInfo["permissionMode"]) => Promise<void>
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

export function useSessions({ enabled = true, scope }: { enabled?: boolean; scope?: SessionScope } = {}): UseSessions {
  const sessionService = useSessionService()
  const scopeType = scope?.type ?? "personal"
  const organizationId = scope?.type === "organization" ? scope.organizationId : ""
  const organizationName = scope?.type === "organization" ? scope.organizationName : ""
  const requestScope = React.useMemo<SessionScope>(() => {
    if (scopeType === "organization") {
      return { type: "organization", organizationId, organizationName }
    }
    return personalSessionScope
  }, [organizationId, organizationName, scopeType])
  const [sessions, setSessions] = React.useState<SessionInfo[]>([])
  const [taskSessions, setTaskSessions] = React.useState<SessionInfo[]>([])
  const [projectSessions, setProjectSessions] = React.useState<SessionInfo[]>([])
  const [projects, setProjects] = React.useState<SessionProject[]>([])
  const [loaded, setLoaded] = React.useState(false)
  const [loadedScopeKey, setLoadedScopeKey] = React.useState<string | null>(null)
  const [error, setError] = React.useState<UserFacingError | null>(null)
  const enabledRef = React.useRef(enabled)
  const requestSequenceRef = React.useRef(0)
  const localCreatedSessionsRef = React.useRef(new Map<string, SessionInfo>())
  const permissionModeWriteQueuesRef = React.useRef(new Map<string, Promise<void>>())
  const permissionModeWriteVersionsRef = React.useRef(new Map<string, number>())
  const scopeKey = sessionScopeKey(requestScope)

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
    setTaskSessions([])
    setProjectSessions([])
    setProjects([])
    setLoaded(false)
    setLoadedScopeKey(null)
    setError(null)
  }, [scopeKey])

  const refresh = React.useCallback(async () => {
    const requestId = ++requestSequenceRef.current
    if (!enabled) {
      setSessions([])
      setTaskSessions([])
      setProjectSessions([])
      setProjects([])
      setLoaded(false)
      setLoadedScopeKey(null)
      setError(null)
      return
    }
    try {
      const [nextSessions, nextTaskSessions, nextProjectSessions, nextProjects] = await Promise.all([
        sessionService.invoke("list", { placement: "all", scope: requestScope }),
        sessionService.invoke("list", { placement: "task", scope: requestScope }),
        sessionService.invoke("list", { placement: "project", scope: requestScope }),
        sessionService.invoke("listProjects", { scope: requestScope }),
      ])
      if (requestId !== requestSequenceRef.current || !enabledRef.current) {
        return
      }
      for (const session of nextSessions) {
        localCreatedSessionsRef.current.delete(session.id)
      }
      const localCreatedSessions = [...localCreatedSessionsRef.current.values()]
      setSessions(mergeSessionsWithLocalCreated(nextSessions, localCreatedSessions))
      setTaskSessions(
        mergeSessionsWithLocalCreated(
          nextTaskSessions,
          localCreatedSessions.filter((session) => !session.projectId),
        ),
      )
      setProjectSessions(
        mergeSessionsWithLocalCreated(
          nextProjectSessions,
          localCreatedSessions.filter((session) => Boolean(session.projectId)),
        ),
      )
      setProjects(nextProjects)
      setError(null)
    } catch (error) {
      console.error("[wanta] list sessions failed", error)
      reportRendererHandledError("session", "list sessions failed", error)
      if (requestId === requestSequenceRef.current && enabledRef.current) {
        setError(resolveUserFacingError(error, { area: "session" }))
      }
    } finally {
      if (requestId === requestSequenceRef.current && enabledRef.current) {
        setLoaded(true)
        setLoadedScopeKey(scopeKey)
      }
    }
  }, [enabled, requestScope, scopeKey, sessionService])

  React.useEffect(() => {
    if (!enabled) {
      setSessions([])
      setTaskSessions([])
      setProjectSessions([])
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
      const info = await sessionService.invoke("create", { projectId, scope: requestScope, title })
      localCreatedSessionsRef.current.set(info.id, info)
      setSessions((current) => mergeSessionsWithLocalCreated(current, [info]))
      if (info.projectId) {
        setProjectSessions((current) => mergeSessionsWithLocalCreated(current, [info]))
      } else {
        setTaskSessions((current) => mergeSessionsWithLocalCreated(current, [info]))
      }
      await refresh()
      return info
    },
    [requestScope, sessionService, refresh],
  )

  const listArchived = React.useCallback(async () => {
    return sessionService.invoke("listArchived", { scope: requestScope })
  }, [requestScope, sessionService])

  const createProject = React.useCallback(
    async (req: CreateProjectRequest) => {
      const project = await sessionService.invoke("createProject", { ...req, scope: requestScope })
      await refresh()
      return project
    },
    [requestScope, sessionService, refresh],
  )

  const assignSessionProject = React.useCallback(
    async (sessionId: string, projectId?: string) => {
      await sessionService.invoke("assignSessionProject", { sessionId, projectId })
      const existingSession = sessions.find((session) => session.id === sessionId)
      const updatedSession = existingSession ? { ...existingSession } : undefined
      if (updatedSession) {
        if (projectId) {
          updatedSession.projectId = projectId
        } else {
          delete updatedSession.projectId
        }
      }
      setSessions((current) =>
        current.map((session) => {
          if (session.id !== sessionId) {
            return session
          }
          return updatedSession ?? session
        }),
      )
      if (updatedSession) {
        if (projectId) {
          setTaskSessions((current) => current.filter((session) => session.id !== sessionId))
          setProjectSessions((current) =>
            mergeSessionsWithLocalCreated(
              current.filter((session) => session.id !== sessionId),
              [updatedSession],
            ),
          )
        } else {
          setProjectSessions((current) => current.filter((session) => session.id !== sessionId))
          setTaskSessions((current) =>
            mergeSessionsWithLocalCreated(
              current.filter((session) => session.id !== sessionId),
              [updatedSession],
            ),
          )
        }
      }
      await refresh()
    },
    [sessionService, refresh, sessions],
  )

  const setSessionPermissionMode = React.useCallback(
    async (id: string, permissionMode: SessionInfo["permissionMode"]) => {
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
      if (permissionModeWriteVersionsRef.current.get(id) !== version) {
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
      setTaskSessions((current) => current.map(applyPermissionMode))
      setProjectSessions((current) => current.map(applyPermissionMode))
      await refresh()
    },
    [sessionService, refresh],
  )

  const removeProject = React.useCallback(
    async (id: string) => {
      await sessionService.invoke("removeProject", id)
      await refresh()
    },
    [sessionService, refresh],
  )

  const renameProject = React.useCallback(
    async (id: string, name: string) => {
      await sessionService.invoke("renameProject", { id, name })
      await refresh()
    },
    [sessionService, refresh],
  )

  const pinProject = React.useCallback(
    async (id: string, pinned: boolean) => {
      await sessionService.invoke("pinProject", { id, pinned })
      await refresh()
    },
    [sessionService, refresh],
  )

  const archiveProject = React.useCallback(
    async (id: string) => {
      await sessionService.invoke("archiveProject", id)
      setProjects((current) => current.filter((project) => project.id !== id))
      setSessions((current) => current.filter((session) => session.projectId !== id))
      setProjectSessions((current) => current.filter((session) => session.projectId !== id))
      await refresh()
    },
    [sessionService, refresh],
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
      await sessionService.invoke("archive", id)
      localCreatedSessionsRef.current.delete(id)
      setSessions((current) => current.filter((session) => session.id !== id))
      setTaskSessions((current) => current.filter((session) => session.id !== id))
      setProjectSessions((current) => current.filter((session) => session.id !== id))
    },
    [sessionService],
  )

  const unarchive = React.useCallback(
    async (id: string) => {
      return sessionService.invoke("unarchive", id)
    },
    [sessionService],
  )

  const remove = React.useCallback(
    async (id: string) => {
      await sessionService.invoke("remove", id)
      localCreatedSessionsRef.current.delete(id)
      setSessions((current) => current.filter((session) => session.id !== id))
      setTaskSessions((current) => current.filter((session) => session.id !== id))
      setProjectSessions((current) => current.filter((session) => session.id !== id))
    },
    [sessionService],
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
