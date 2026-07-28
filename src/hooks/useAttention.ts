import type { NotificationCapability, NotificationTestResult } from "../../electron/attention/common.ts"

import * as React from "react"
import { useAttentionService } from "../components/AppContext.ts"
import { reportRendererHandledError } from "../lib/renderer-diagnostics.ts"

export function useAttention(): {
  hasUnreadSession: (sessionId: string) => boolean
  hasUnreadTeam: (teamId: string) => boolean
  hasUnreadTeams: boolean
  notificationCapability: NotificationCapability | null
  openSystemNotificationSettings: () => Promise<void>
  testCompletionNotification: () => Promise<NotificationTestResult>
} {
  const service = useAttentionService()
  const [unreadSessionIds, setUnreadSessionIds] = React.useState<Set<string>>(() => new Set())
  const [unreadTeamIds, setUnreadTeamIds] = React.useState<Set<string>>(() => new Set())
  const [notificationCapability, setNotificationCapability] = React.useState<NotificationCapability | null>(null)

  React.useEffect(() => {
    let active = true
    let updateVersion = 0
    const unsubscribe = service.serverEvents.on("attentionStateChanged", (state) => {
      if (!active) return
      updateVersion += 1
      setUnreadSessionIds(new Set(state.unreadSessionIds))
      setUnreadTeamIds(new Set(state.unreadTeamIds))
    })
    const requestVersion = updateVersion
    void service.invoke("getAttentionState").then(
      (state) => {
        if (active && updateVersion === requestVersion) {
          setUnreadSessionIds(new Set(state.unreadSessionIds))
          setUnreadTeamIds(new Set(state.unreadTeamIds))
        }
      },
      (error: unknown) => reportRendererHandledError("attention", "load attention state failed", error),
    )
    return () => {
      active = false
      unsubscribe()
    }
  }, [service])

  React.useEffect(() => {
    let active = true
    let updateVersion = 0
    const refresh = (): void => {
      updateVersion += 1
      const requestVersion = updateVersion
      void service.invoke("getNotificationCapability").then(
        (capability) => {
          if (active && updateVersion === requestVersion) setNotificationCapability(capability)
        },
        (error: unknown) =>
          reportRendererHandledError("attention", "load system notification capability failed", error),
      )
    }
    refresh()
    window.addEventListener("focus", refresh)
    return () => {
      active = false
      window.removeEventListener("focus", refresh)
    }
  }, [service])

  const hasUnreadSession = React.useCallback(
    (sessionId: string): boolean => unreadSessionIds.has(sessionId),
    [unreadSessionIds],
  )
  const hasUnreadTeam = React.useCallback((teamId: string): boolean => unreadTeamIds.has(teamId), [unreadTeamIds])

  const testCompletionNotification = React.useCallback(() => service.invoke("testCompletionNotification"), [service])
  const openSystemNotificationSettings = React.useCallback(
    () => service.invoke("openSystemNotificationSettings"),
    [service],
  )

  return {
    hasUnreadSession,
    hasUnreadTeam,
    hasUnreadTeams: unreadTeamIds.size > 0,
    notificationCapability,
    openSystemNotificationSettings,
    testCompletionNotification,
  }
}
