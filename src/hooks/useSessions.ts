import type {
  GenerateSessionTitleRequest,
  GenerateSessionTitleResult,
  SessionInfo,
  SessionScope,
} from "../../electron/session/common.ts"
import type { UserFacingError } from "../lib/user-facing-error.ts"

import * as React from "react"
import { useSessionService } from "../components/AppContext.ts"
import { resolveUserFacingError } from "../lib/user-facing-error.ts"

const personalSessionScope: SessionScope = { type: "personal" }

export interface UseSessions {
  sessions: SessionInfo[]
  loaded: boolean
  error: UserFacingError | null
  create: (title?: string) => Promise<SessionInfo>
  listArchived: () => Promise<SessionInfo[]>
  generateTitle: (req: GenerateSessionTitleRequest) => Promise<GenerateSessionTitleResult>
  rename: (id: string, title: string) => Promise<void>
  pin: (id: string, pinned: boolean) => Promise<void>
  archive: (id: string) => Promise<void>
  unarchive: (id: string) => Promise<void>
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
  const [loaded, setLoaded] = React.useState(false)
  const [error, setError] = React.useState<UserFacingError | null>(null)
  const enabledRef = React.useRef(enabled)
  const requestSequenceRef = React.useRef(0)
  const scopeKey = requestScope.type === "organization" ? `organization:${requestScope.organizationId}` : "personal"

  React.useEffect(() => {
    enabledRef.current = enabled
    if (!enabled) {
      requestSequenceRef.current += 1
    }
  }, [enabled])

  React.useEffect(() => {
    requestSequenceRef.current += 1
    setSessions([])
    setLoaded(false)
    setError(null)
  }, [scopeKey])

  const refresh = React.useCallback(async () => {
    const requestId = ++requestSequenceRef.current
    if (!enabled) {
      setSessions([])
      setLoaded(false)
      setError(null)
      return
    }
    try {
      const nextSessions = await sessionService.invoke("list", { scope: requestScope })
      if (requestId !== requestSequenceRef.current || !enabledRef.current) {
        return
      }
      setSessions(nextSessions)
      setError(null)
    } catch (error) {
      console.error("[wanta] list sessions failed", error)
      if (requestId === requestSequenceRef.current && enabledRef.current) {
        setError(resolveUserFacingError(error, { area: "session" }))
      }
    } finally {
      if (requestId === requestSequenceRef.current && enabledRef.current) {
        setLoaded(true)
      }
    }
  }, [enabled, requestScope, sessionService])

  React.useEffect(() => {
    if (!enabled) {
      setSessions([])
      setLoaded(false)
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
    async (title?: string) => {
      const info = await sessionService.invoke("create", { scope: requestScope, title })
      await refresh()
      return info
    },
    [requestScope, sessionService, refresh],
  )

  const listArchived = React.useCallback(async () => {
    return sessionService.invoke("listArchived", { scope: requestScope })
  }, [requestScope, sessionService])

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
    },
    [sessionService],
  )

  const unarchive = React.useCallback(
    async (id: string) => {
      await sessionService.invoke("unarchive", id)
    },
    [sessionService],
  )

  const remove = React.useCallback(
    async (id: string) => {
      await sessionService.invoke("remove", id)
    },
    [sessionService],
  )

  return {
    sessions,
    loaded,
    error,
    create,
    listArchived,
    generateTitle,
    rename,
    pin,
    archive,
    unarchive,
    remove,
    refresh,
  }
}
