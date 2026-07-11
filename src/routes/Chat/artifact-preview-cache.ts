import type { LocalArtifactItem, LocalArtifactPreviewResult } from "../../../electron/chat/common.ts"
import type { ArtifactPreviewLoadPriority } from "./artifact-preview-scheduler.ts"

import * as React from "react"
import { scheduleArtifactPreviewLoad } from "./artifact-preview-scheduler.ts"
import { useChatService } from "@/components/AppContext"

export interface LocalArtifactPreviewCacheEntry {
  estimatedBytes?: number
  promise?: Promise<LocalArtifactPreviewResult>
  result?: LocalArtifactPreviewResult
}

export type LocalArtifactPreviewCache = Map<string, LocalArtifactPreviewCacheEntry>

export function artifactPreviewCacheKey(item: LocalArtifactItem): string {
  return JSON.stringify([item.path, item.mime, item.size ?? null, item.modifiedAt ?? null])
}

const previewCacheMaxEntries = 48
const previewCacheMaxEstimatedBytes = 64 * 1024 * 1024

export function artifactPreviewEstimatedBytes(result: LocalArtifactPreviewResult): number {
  if (result.resourceUrl) {
    return result.resourceUrl.length * 2 + 256
  }
  if (result.dataUrl) {
    return result.dataUrl.length
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
  rememberArtifactPreview(cache, key, entry)
  return entry.result
}

function loadCachedArtifactPreview(
  cache: LocalArtifactPreviewCache,
  item: LocalArtifactItem,
  load: () => Promise<LocalArtifactPreviewResult>,
  priority: ArtifactPreviewLoadPriority,
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
  const promise = scheduleArtifactPreviewLoad(load, priority)
    .then((result) => {
      rememberArtifactPreview(cache, key, { estimatedBytes: artifactPreviewEstimatedBytes(result), result })
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
  priority: ArtifactPreviewLoadPriority = "interactive",
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
    void loadCachedArtifactPreview(
      previewCache,
      item,
      () => chatService.invoke("getLocalArtifactPreview", { path: item.path }),
      priority,
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
  }, [chatService, item, previewCache, priority])

  return { loading, preview }
}
