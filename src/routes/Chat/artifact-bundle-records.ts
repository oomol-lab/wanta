import type { ArtifactBundle } from "../../../electron/chat/common.ts"

import * as React from "react"
import { useChatService } from "@/components/AppContext"

export function useArtifactBundles(sessionId: string | null, messageIdsKey: string): ArtifactBundle[] {
  const chatService = useChatService()
  const [bundles, setBundles] = React.useState<ArtifactBundle[]>([])
  const [refreshToken, setRefreshToken] = React.useState(0)

  React.useEffect(
    () =>
      chatService.serverEvents.on("artifactBundleUpdated", (event) => {
        if (!sessionId || event.sessionId === sessionId) {
          setRefreshToken((value) => value + 1)
        }
      }),
    [chatService, sessionId],
  )

  React.useEffect(() => {
    let cancelled = false
    if (!sessionId || !messageIdsKey) {
      setBundles([])
      return
    }
    void chatService
      .invoke("getArtifactBundles", { sessionId, messageIds: messageIdsKey.split("\n") })
      .then((nextBundles) => {
        if (!cancelled) {
          setBundles(nextBundles.sort((left, right) => left.createdAt - right.createdAt))
        }
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          console.error("[wanta] getArtifactBundles failed", error)
          setBundles([])
        }
      })
    return () => {
      cancelled = true
    }
  }, [chatService, messageIdsKey, refreshToken, sessionId])

  return bundles
}
