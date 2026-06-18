import type { GenerateSessionTitleRequest, SessionInfo } from "../../electron/session/common.ts"
import type { UserFacingError } from "@/lib/user-facing-error"

import * as React from "react"
import { useSessionService } from "@/components/AppContext"
import { resolveUserFacingError } from "@/lib/user-facing-error"

export interface UseSessions {
  sessions: SessionInfo[]
  loaded: boolean
  error: UserFacingError | null
  create: (title?: string) => Promise<SessionInfo>
  generateTitle: (req: GenerateSessionTitleRequest) => Promise<string>
  rename: (id: string, title: string) => Promise<void>
  remove: (id: string) => Promise<void>
  refresh: () => Promise<void>
}

export function useSessions({ enabled = true }: { enabled?: boolean } = {}): UseSessions {
  const sessionService = useSessionService()
  const [sessions, setSessions] = React.useState<SessionInfo[]>([])
  const [loaded, setLoaded] = React.useState(false)
  const [error, setError] = React.useState<UserFacingError | null>(null)
  const enabledRef = React.useRef(enabled)
  const requestSequenceRef = React.useRef(0)

  React.useEffect(() => {
    enabledRef.current = enabled
    if (!enabled) {
      requestSequenceRef.current += 1
    }
  }, [enabled])

  const refresh = React.useCallback(async () => {
    const requestId = ++requestSequenceRef.current
    if (!enabled) {
      setSessions([])
      setLoaded(false)
      setError(null)
      return
    }
    try {
      const nextSessions = await sessionService.invoke("list")
      if (requestId !== requestSequenceRef.current || !enabledRef.current) {
        return
      }
      setSessions(nextSessions)
      setError(null)
    } catch (error) {
      console.error("[lumo] list sessions failed", error)
      if (requestId === requestSequenceRef.current && enabledRef.current) {
        setError(resolveUserFacingError(error, { area: "session" }))
      }
    } finally {
      if (requestId === requestSequenceRef.current && enabledRef.current) {
        setLoaded(true)
      }
    }
  }, [enabled, sessionService])

  React.useEffect(() => {
    if (!enabled) {
      setSessions([])
      setLoaded(false)
      setError(null)
      return
    }
    void refresh()
    return sessionService.serverEvents.on("sessionsChanged", (event) => {
      if (!enabledRef.current) {
        return
      }
      setSessions(event.sessions)
      setLoaded(true)
      setError(null)
    })
  }, [enabled, sessionService, refresh])

  const create = React.useCallback(
    async (title?: string) => {
      const info = await sessionService.invoke("create", title)
      await refresh()
      return info
    },
    [sessionService, refresh],
  )

  const generateTitle = React.useCallback(
    async (req: GenerateSessionTitleRequest) => {
      const result = await sessionService.invoke("generateTitle", req)
      return result.title
    },
    [sessionService],
  )

  const rename = React.useCallback(
    async (id: string, title: string) => {
      await sessionService.invoke("rename", { id, title })
    },
    [sessionService],
  )

  const remove = React.useCallback(
    async (id: string) => {
      await sessionService.invoke("remove", id)
    },
    [sessionService],
  )

  return { sessions, loaded, error, create, generateTitle, rename, remove, refresh }
}
