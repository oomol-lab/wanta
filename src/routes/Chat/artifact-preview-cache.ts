import type { LocalArtifactItem, LocalArtifactPreviewResult } from "../../../electron/chat/common.ts"

import * as React from "react"
import { useChatService } from "@/components/AppContext"

export interface LocalArtifactPreviewCacheEntry {
  promise?: Promise<LocalArtifactPreviewResult>
  result?: LocalArtifactPreviewResult
}

export type LocalArtifactPreviewCache = Map<string, LocalArtifactPreviewCacheEntry>

function artifactPreviewCacheKey(item: LocalArtifactItem): string {
  return JSON.stringify([item.path, item.mime, item.size ?? null])
}

function rememberArtifactPreview(
  cache: LocalArtifactPreviewCache,
  key: string,
  entry: LocalArtifactPreviewCacheEntry,
): void {
  if (cache.has(key)) {
    cache.delete(key)
  }
  cache.set(key, entry)
  while (cache.size > 48) {
    const oldest = cache.keys().next().value
    if (!oldest) {
      return
    }
    cache.delete(oldest)
  }
}

function fallbackArtifactPreview(item: LocalArtifactItem): LocalArtifactPreviewResult {
  return { kind: "unsupported", mime: item.mime, size: item.size, reason: "read_failed" }
}

function cachedArtifactPreviewResult(
  cache: LocalArtifactPreviewCache,
  item: LocalArtifactItem,
): LocalArtifactPreviewResult | null {
  const key = artifactPreviewCacheKey(item)
  const entry = cache.get(key)
  if (!entry?.result) {
    return null
  }
  rememberArtifactPreview(cache, key, entry)
  return entry.result
}

function loadCachedArtifactPreview(
  cache: LocalArtifactPreviewCache,
  item: LocalArtifactItem,
  load: () => Promise<LocalArtifactPreviewResult>,
): Promise<LocalArtifactPreviewResult> {
  const key = artifactPreviewCacheKey(item)
  const cached = cache.get(key)
  if (cached?.result) {
    rememberArtifactPreview(cache, key, cached)
    return Promise.resolve(cached.result)
  }
  if (cached?.promise) {
    rememberArtifactPreview(cache, key, cached)
    return cached.promise
  }
  const promise = load()
    .then((result) => {
      rememberArtifactPreview(cache, key, { result })
      return result
    })
    .catch(() => {
      cache.delete(key)
      return fallbackArtifactPreview(item)
    })
  rememberArtifactPreview(cache, key, { promise })
  return promise
}

export function useLocalArtifactPreview(
  item: LocalArtifactItem | null,
  previewCache: LocalArtifactPreviewCache,
): {
  loading: boolean
  preview: LocalArtifactPreviewResult | null
} {
  const chatService = useChatService()
  const [preview, setPreview] = React.useState<LocalArtifactPreviewResult | null>(null)
  const [loading, setLoading] = React.useState(false)

  React.useEffect(() => {
    if (!item || item.kind !== "file") {
      setPreview(null)
      setLoading(false)
      return
    }
    const cached = cachedArtifactPreviewResult(previewCache, item)
    if (cached) {
      setPreview(cached)
      setLoading(false)
      return
    }
    let cancelled = false
    setLoading(true)
    void loadCachedArtifactPreview(previewCache, item, () =>
      chatService.invoke("getLocalArtifactPreview", { path: item.path }),
    )
      .then((result) => {
        if (!cancelled) {
          setPreview(result)
        }
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false)
        }
      })
    return () => {
      cancelled = true
    }
  }, [chatService, item, previewCache])

  return { loading, preview }
}
