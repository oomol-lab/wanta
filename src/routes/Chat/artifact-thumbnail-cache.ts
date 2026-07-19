import type { LocalArtifactItem } from "../../../electron/chat/common.ts"

import * as React from "react"
import { scheduleArtifactPreviewLoad } from "./artifact-preview-scheduler.ts"
import { useChatService } from "@/components/AppContext"

const thumbnailCacheMaxEntries = 128
const thumbnailCache = new Map<string, Promise<string | null>>()

function thumbnailCacheKey(item: LocalArtifactItem): string {
  return JSON.stringify([item.path, item.size ?? null, item.modifiedAt ?? null])
}

function rememberThumbnail(key: string, value: Promise<string | null>): void {
  if (thumbnailCache.has(key)) {
    thumbnailCache.delete(key)
  }
  thumbnailCache.set(key, value)
  while (thumbnailCache.size > thumbnailCacheMaxEntries) {
    const oldest = thumbnailCache.keys().next().value
    if (!oldest) {
      return
    }
    thumbnailCache.delete(oldest)
  }
}

export function useLocalArtifactThumbnail(item: LocalArtifactItem | null): string | null {
  const chatService = useChatService()
  const [thumbnail, setThumbnail] = React.useState<string | null>(null)

  React.useEffect(() => {
    if (!item || item.kind !== "file") {
      setThumbnail(null)
      return
    }
    const key = thumbnailCacheKey(item)
    const controller = new AbortController()
    let promise = thumbnailCache.get(key)
    if (promise) {
      rememberThumbnail(key, promise)
    } else {
      setThumbnail(null)
      promise = scheduleArtifactPreviewLoad(
        () => chatService.invoke("getLocalArtifactThumbnail", { path: item.path }).then((result) => result.dataUrl),
        "background",
        controller.signal,
      ).catch(() => {
        thumbnailCache.delete(key)
        return null
      })
      rememberThumbnail(key, promise)
    }
    let cancelled = false
    void promise.then((result) => {
      if (!cancelled) {
        setThumbnail(result)
      }
    })
    return () => {
      cancelled = true
      controller.abort()
    }
  }, [chatService, item])

  return thumbnail
}
