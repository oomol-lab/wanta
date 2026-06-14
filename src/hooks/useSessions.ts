import type { GenerateSessionTitleRequest, SessionInfo } from "../../electron/session/common.ts"

import * as React from "react"
import { useSessionService } from "@/components/AppContext"

export interface UseSessions {
  sessions: SessionInfo[]
  create: (title?: string) => Promise<SessionInfo>
  generateTitle: (req: GenerateSessionTitleRequest) => Promise<string>
  rename: (id: string, title: string) => Promise<void>
  remove: (id: string) => Promise<void>
  refresh: () => Promise<void>
}

export function useSessions(): UseSessions {
  const sessionService = useSessionService()
  const [sessions, setSessions] = React.useState<SessionInfo[]>([])

  const refresh = React.useCallback(async () => {
    try {
      setSessions(await sessionService.invoke("list"))
    } catch (error) {
      console.error("[lumo] list sessions failed", error)
    }
  }, [sessionService])

  React.useEffect(() => {
    void refresh()
    return sessionService.serverEvents.on("sessionsChanged", (event) => {
      setSessions(event.sessions)
    })
  }, [sessionService, refresh])

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

  return { sessions, create, generateTitle, rename, remove, refresh }
}
