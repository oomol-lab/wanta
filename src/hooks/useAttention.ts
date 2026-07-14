import * as React from "react"
import { useAttentionService } from "../components/AppContext.ts"
import { reportRendererHandledError } from "../lib/renderer-diagnostics.ts"

export function useAttention(): {
  hasUnreadSession: (sessionId: string) => boolean
  testCompletionNotification: () => Promise<void>
} {
  const service = useAttentionService()
  const [unreadSessionIds, setUnreadSessionIds] = React.useState<Set<string>>(() => new Set())

  React.useEffect(() => {
    let active = true
    void service.invoke("getAttentionState").then(
      (state) => {
        if (active) setUnreadSessionIds(new Set(state.unreadSessionIds))
      },
      (error: unknown) => reportRendererHandledError("attention", "load attention state failed", error),
    )
    const unsubscribe = service.serverEvents.on("attentionStateChanged", (state) => {
      if (active) setUnreadSessionIds(new Set(state.unreadSessionIds))
    })
    return () => {
      active = false
      unsubscribe()
    }
  }, [service])

  const hasUnreadSession = React.useCallback(
    (sessionId: string): boolean => unreadSessionIds.has(sessionId),
    [unreadSessionIds],
  )

  const testCompletionNotification = React.useCallback(() => service.invoke("testCompletionNotification"), [service])

  return { hasUnreadSession, testCompletionNotification }
}
