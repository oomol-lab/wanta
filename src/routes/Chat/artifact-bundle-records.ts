import type { ArtifactBundle } from "../../../electron/chat/common.ts"

import * as React from "react"
import { useSessionRecordResource } from "./session-record-resource.ts"
import { useChatService } from "@/components/AppContext"

export function useArtifactBundles(sessionId: string | null, messageIdsKey: string): ArtifactBundle[] {
  const chatService = useChatService()
  const key = sessionId && messageIdsKey ? `${sessionId}\0${messageIdsKey}` : null
  const subscribe = React.useCallback(
    (refresh: () => void) =>
      chatService.serverEvents.on("artifactBundleUpdated", (event) => {
        if (event.sessionId === sessionId) {
          refresh()
        }
      }),
    [chatService, sessionId],
  )
  const load = React.useCallback(async (): Promise<ArtifactBundle[]> => {
    if (!sessionId || !messageIdsKey) {
      return []
    }
    const bundles = await chatService.invoke("getArtifactBundles", {
      sessionId,
      messageIds: messageIdsKey.split("\n"),
    })
    return [...bundles].sort((left, right) => left.createdAt - right.createdAt)
  }, [chatService, messageIdsKey, sessionId])
  const onError = React.useCallback((error: unknown): void => {
    console.error("[wanta] getArtifactBundles failed", error)
  }, [])
  return useSessionRecordResource({ key, load, onError, subscribe })
}
