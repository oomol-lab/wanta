import type { LocalArtifactItem, LocalArtifactPreviewResult } from "../../../electron/chat/common.ts"
import type { ArtifactPreviewLoadPriority } from "./artifact-preview-scheduler.ts"
import type { SharedRequest } from "@/lib/shared-request"

import * as React from "react"
import { scheduleArtifactPreviewLoad } from "./artifact-preview-scheduler.ts"
import { useChatService } from "@/components/AppContext"
import { createSharedRequest, waitForSharedRequest } from "@/lib/shared-request"

export interface LocalArtifactPreviewCacheEntry {
  estimatedBytes?: number
  request?: SharedRequest<LocalArtifactPreviewResult>
  result?: LocalArtifactPreviewResult
}

export type LocalArtifactPreviewCache = Map<string, LocalArtifactPreviewCacheEntry>

export function artifactPreviewCacheKey(item: LocalArtifactItem): string {
  return JSON.stringify([item.path, item.mime, item.size ?? null, item.modifiedAt ?? null])
}

const previewCacheMaxEntries = 48
const previewCacheMaxEstimatedBytes = 64 * 1024 * 1024
const resourceRefreshMarginMs = 60_000

export function artifactPreviewResourceIsFresh(result: LocalArtifactPreviewResult, now = Date.now()): boolean {
  return !result.resourceUrl || !result.resourceExpiresAt || result.resourceExpiresAt > now + resourceRefreshMarginMs
}

export function artifactPreviewEstimatedBytes(result: LocalArtifactPreviewResult): number {
  if (result.resourceUrl) {
    return result.resourceUrl.length * 2 + 256
  }
  if (result.dataUrl) {
    return result.dataUrl.length * 2
  }
  if (result.text) {
    return result.text.length * 2
  }
  if (result.spreadsheet) {
    const sheets = result.spreadsheet.workbook ?? [
      {
        name: result.spreadsheet.activeSheet,
        columnCount: result.spreadsheet.columnCount,
        rowCount: result.spreadsheet.rowCount,
        rows: result.spreadsheet.rows,
      },
    ]
    return sheets.reduce(
      (total, sheet) =>
        total +
        sheet.name.length * 2 +
        sheet.rows.reduce(
          (sheetTotal, row) => sheetTotal + row.reduce((rowTotal, cell) => rowTotal + cell.length * 2, 0),
          0,
        ),
      0,
    )
  }
  if (result.archive) {
    return result.archive.entries.reduce((total, entry) => total + entry.path.length * 2 + 64, 0)
  }
  return 256
}

function previewCacheEstimatedBytes(cache: LocalArtifactPreviewCache): number {
  let total = 0
  cache.forEach((entry) => {
    total += entry.estimatedBytes ?? 0
  })
  return total
}

export function trimArtifactPreviewCache(cache: LocalArtifactPreviewCache): void {
  let estimatedBytes = previewCacheEstimatedBytes(cache)
  while (cache.size > previewCacheMaxEntries || estimatedBytes > previewCacheMaxEstimatedBytes) {
    const oldest = cache.keys().next().value
    if (!oldest) {
      return
    }
    estimatedBytes -= cache.get(oldest)?.estimatedBytes ?? 0
    cache.delete(oldest)
  }
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
  trimArtifactPreviewCache(cache)
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
  if (!artifactPreviewResourceIsFresh(entry.result)) {
    cache.delete(key)
    return null
  }
  rememberArtifactPreview(cache, key, entry)
  return entry.result
}

export function loadCachedArtifactPreview(
  cache: LocalArtifactPreviewCache,
  item: LocalArtifactItem,
  load: () => Promise<LocalArtifactPreviewResult>,
  priority: ArtifactPreviewLoadPriority,
  signal: AbortSignal,
): Promise<LocalArtifactPreviewResult> {
  if (signal.aborted) return Promise.reject(signal.reason)
  const key = artifactPreviewCacheKey(item)
  const cached = cachedArtifactPreviewResult(cache, item)
  if (cached) return Promise.resolve(cached)

  let request = cache.get(key)?.request
  if (!request || request.controller.signal.aborted) {
    request = createSharedRequest((sharedSignal) => scheduleArtifactPreviewLoad(load, priority, sharedSignal))
    const createdRequest = request
    rememberArtifactPreview(cache, key, { request })
    void request.promise.then(
      (result) => {
        // Invalidation or eviction may already have started a newer request for this key.
        if (cache.get(key)?.request !== createdRequest) return
        if (
          createdRequest.controller.signal.aborted ||
          result.reason === "read_failed" ||
          result.reason === "missing"
        ) {
          cache.delete(key)
          return
        }
        rememberArtifactPreview(cache, key, { estimatedBytes: artifactPreviewEstimatedBytes(result), result })
      },
      () => {
        if (cache.get(key)?.request === createdRequest) cache.delete(key)
      },
    )
  }
  return waitForSharedRequest(request, signal).catch((error: unknown) => {
    if (signal.aborted) throw error
    return fallbackArtifactPreview(item)
  })
}

type PreviewState =
  | { key: string | null; status: "loading" }
  | { key: string | null; status: "loaded"; preview: LocalArtifactPreviewResult | null }

export function useLocalArtifactPreview(
  item: LocalArtifactItem | null,
  previewCache: LocalArtifactPreviewCache,
  priority: ArtifactPreviewLoadPriority = "interactive",
): {
  loading: boolean
  preview: LocalArtifactPreviewResult | null
  reload: () => void
  retry: () => void
  resourceLoaded: () => void
} {
  const chatService = useChatService()
  const [state, setState] = React.useState<PreviewState>({ key: null, status: "loaded", preview: null })
  const [reloadVersion, setReloadVersion] = React.useState(0)
  const previewKey = item ? artifactPreviewCacheKey(item) : null
  // The loader only depends on file identity, not a freshly allocated item from the parent.
  const requestItem = React.useMemo(() => item, [previewKey, item?.kind])
  const reloadAttemptRef = React.useRef<{ count: number; key: string | null }>({ count: 0, key: null })

  const invalidate = React.useCallback(() => {
    if (!previewKey) return
    previewCache.delete(previewKey)
    setState({ key: previewKey, status: "loading" })
    setReloadVersion((value) => value + 1)
  }, [previewCache, previewKey])

  const reload = React.useCallback(() => {
    if (reloadAttemptRef.current.key !== previewKey) {
      reloadAttemptRef.current = { count: 0, key: previewKey }
    }
    if (reloadAttemptRef.current.count >= 1) return
    reloadAttemptRef.current.count += 1
    invalidate()
  }, [invalidate, previewKey])

  const retry = React.useCallback(() => {
    // An explicit retry is already a recovery attempt; don't auto-retry it again on failure.
    reloadAttemptRef.current = { count: 1, key: previewKey }
    invalidate()
  }, [invalidate, previewKey])

  const resourceLoaded = React.useCallback(() => {
    // A new URL alone is not success: reset only after the browser/viewer consumes it.
    reloadAttemptRef.current = { count: 0, key: previewKey }
  }, [previewKey])

  React.useEffect(() => {
    if (!requestItem || requestItem.kind !== "file") {
      setState({ key: previewKey, status: "loaded", preview: null })
      return
    }
    const cached = cachedArtifactPreviewResult(previewCache, requestItem)
    if (cached) {
      setState({ key: previewKey, status: "loaded", preview: cached })
      return
    }
    const controller = new AbortController()
    setState({ key: previewKey, status: "loading" })
    void loadCachedArtifactPreview(
      previewCache,
      requestItem,
      () => chatService.invoke("getLocalArtifactPreview", { path: requestItem.path }),
      priority,
      controller.signal,
    ).then(
      (preview) => {
        if (!controller.signal.aborted) setState({ key: previewKey, status: "loaded", preview })
      },
      () => {
        // The only rejection exposed by loadCachedArtifactPreview is consumer cancellation.
      },
    )
    return () => controller.abort()
  }, [chatService, requestItem, previewCache, priority, reloadVersion, previewKey])

  const previewMatchesItem = state.key === previewKey
  return {
    loading: Boolean(item?.kind === "file" && (!previewMatchesItem || state.status === "loading")),
    preview: previewMatchesItem && state.status === "loaded" ? state.preview : null,
    reload,
    retry,
    resourceLoaded,
  }
}
