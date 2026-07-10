import type { ArtifactBundle, ChatMessage } from "../../../electron/chat/common.ts"

import * as React from "react"
import { useChatService } from "@/components/AppContext"

function assistantMessageIds(messages: ChatMessage[]): string[] {
  return messages.filter((message) => message.role === "assistant").map((message) => message.id)
}

export function useArtifactBundles(sessionId: string | null, messages: ChatMessage[]): ArtifactBundle[] {
  const chatService = useChatService()
  const [bundles, setBundles] = React.useState<ArtifactBundle[]>([])
  const [refreshToken, setRefreshToken] = React.useState(0)
  const messageIdsKey = React.useMemo(() => assistantMessageIds(messages).join("\n"), [messages])

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
