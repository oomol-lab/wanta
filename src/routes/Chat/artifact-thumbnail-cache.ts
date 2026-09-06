import type { LocalArtifactItem } from "../../../electron/chat/common.ts"
import type { SharedRequest } from "@/lib/shared-request"

import * as React from "react"
import { scheduleArtifactPreviewLoad } from "./artifact-preview-scheduler.ts"
import { useChatService } from "@/components/AppContext"
import { createSharedRequest, waitForSharedRequest } from "@/lib/shared-request"

const thumbnailCacheMaxEntries = 128
const thumbnailCacheMaxEstimatedBytes = 16 * 1024 * 1024

interface ThumbnailCacheEntry {
  estimatedBytes: number
  request: SharedRequest<string | null>
}

const thumbnailCache = new Map<string, ThumbnailCacheEntry>()

function thumbnailCacheKey(item: LocalArtifactItem): string {
  return JSON.stringify([item.path, item.size ?? null, item.modifiedAt ?? null])
}

function rememberThumbnail(key: string, value: ThumbnailCacheEntry): void {
  if (thumbnailCache.has(key)) {
    thumbnailCache.delete(key)
  }
  thumbnailCache.set(key, value)
  let estimatedBytes = [...thumbnailCache.values()].reduce((total, entry) => total + entry.estimatedBytes, 0)
  while (thumbnailCache.size > thumbnailCacheMaxEntries || estimatedBytes > thumbnailCacheMaxEstimatedBytes) {
    const oldest = thumbnailCache.keys().next().value
    if (!oldest) {
      return
    }
    estimatedBytes -= thumbnailCache.get(oldest)?.estimatedBytes ?? 0
    thumbnailCache.delete(oldest)
  }
}

export function useLocalArtifactThumbnail(item: LocalArtifactItem | null): string | null {
  const chatService = useChatService()
  const key = item ? thumbnailCacheKey(item) : null
  const requestItem = React.useMemo(() => item, [key, item?.kind])
  const [thumbnail, setThumbnail] = React.useState<{ key: string; source: string | null } | null>(null)

  React.useEffect(() => {
    if (!requestItem || requestItem.kind !== "file" || !key) {
      setThumbnail(null)
      return
    }
    const controller = new AbortController()
    let entry = thumbnailCache.get(key)
    if (entry?.request.controller.signal.aborted) {
      thumbnailCache.delete(key)
      entry = undefined
    }
    if (entry) {
      rememberThumbnail(key, entry)
    } else {
      setThumbnail(null)
      const request = createSharedRequest((sharedSignal) =>
        scheduleArtifactPreviewLoad(
          () =>
            chatService
              .invoke("getLocalArtifactThumbnail", { path: requestItem.path })
              .then((result) => result.dataUrl),
          "background",
          sharedSignal,
        ),
      )
      const createdRequest = request
      entry = { estimatedBytes: 0, request: createdRequest }
      void createdRequest.promise.then(
        (result) => {
          if (thumbnailCache.get(key)?.request === createdRequest) {
            if (result === null || createdRequest.controller.signal.aborted) {
              thumbnailCache.delete(key)
            } else {
              rememberThumbnail(key, { estimatedBytes: result.length * 2, request: createdRequest })
            }
          }
        },
        () => {
          if (thumbnailCache.get(key)?.request === createdRequest) {
            thumbnailCache.delete(key)
          }
        },
      )
      rememberThumbnail(key, entry)
    }
    let cancelled = false
    void waitForSharedRequest(entry.request, controller.signal)
      .then((result) => {
        if (!cancelled) {
          setThumbnail({ key, source: result })
        }
      })
      .catch(() => undefined)
    return () => {
      cancelled = true
      controller.abort()
    }
  }, [chatService, requestItem, key])

  return thumbnail?.key === key ? (thumbnail?.source ?? null) : null
}
