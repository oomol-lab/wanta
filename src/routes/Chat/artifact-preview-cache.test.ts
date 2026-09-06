import type { LocalArtifactItem, LocalArtifactPreviewResult } from "../../../electron/chat/common.ts"
import type { LocalArtifactPreviewCache } from "./artifact-preview-cache.ts"

import assert from "node:assert/strict"
import { test, vi } from "vitest"
import {
  artifactPreviewCacheKey,
  artifactPreviewEstimatedBytes,
  artifactPreviewResourceIsFresh,
  loadCachedArtifactPreview,
  trimArtifactPreviewCache,
} from "./artifact-preview-cache.ts"
import { scheduleArtifactPreviewLoad } from "./artifact-preview-scheduler.ts"

test("artifact preview cache key changes when a file is replaced in place", () => {
  const base = { kind: "file" as const, mime: "image/png", name: "chart.png", path: "/tmp/chart.png", size: 100 }
  assert.notEqual(
    artifactPreviewCacheKey({ ...base, modifiedAt: 1 }),
    artifactPreviewCacheKey({ ...base, modifiedAt: 2 }),
  )
})

test("artifact resource previews refresh before their lease expires", () => {
  assert.equal(
    artifactPreviewResourceIsFresh(
      { kind: "image", mime: "image/png", resourceExpiresAt: 70_001, resourceUrl: "x" },
      10_000,
    ),
    true,
  )
  assert.equal(
    artifactPreviewResourceIsFresh(
      { kind: "image", mime: "image/png", resourceExpiresAt: 70_000, resourceUrl: "x" },
      10_000,
    ),
    false,
  )
})

test("artifact preview cache trims the oldest entries to its byte budget", () => {
  const cache: LocalArtifactPreviewCache = new Map([
    ["old", { estimatedBytes: 40 * 1024 * 1024 }],
    ["new", { estimatedBytes: 40 * 1024 * 1024 }],
  ])

  trimArtifactPreviewCache(cache)

  assert.deepEqual([...cache.keys()], ["new"])
})

test("artifact preview byte estimate includes spreadsheet cell text", () => {
  assert.equal(
    artifactPreviewEstimatedBytes({
      kind: "spreadsheet",
      mime: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      spreadsheet: {
        activeSheet: "S",
        columnCount: 1,
        rowCount: 1,
        rows: [["value"]],
        sheets: ["S"],
      },
    }),
    12,
  )
})

test("artifact preview data URLs count their UTF-16 storage", () => {
  assert.equal(
    artifactPreviewEstimatedBytes({ kind: "image", mime: "image/png", dataUrl: "data:image/png;base64,AAAA" }),
    "data:image/png;base64,AAAA".length * 2,
  )
})

test("one artifact preview consumer cannot cancel another consumer", async () => {
  const cache: LocalArtifactPreviewCache = new Map()
  const item = { kind: "file" as const, mime: "text/plain", name: "notes.txt", path: "/tmp/notes.txt", size: 5 }
  let resolveLoad: (result: { kind: "text"; mime: string; text: string }) => void = () => undefined
  const load = () =>
    new Promise<{ kind: "text"; mime: string; text: string }>((resolve) => {
      resolveLoad = resolve
    })
  const firstController = new AbortController()
  const secondController = new AbortController()
  const first = loadCachedArtifactPreview(cache, item, load, "interactive", firstController.signal)
  const second = loadCachedArtifactPreview(cache, item, load, "interactive", secondController.signal)

  firstController.abort()
  await assert.rejects(first)
  resolveLoad({ kind: "text", mime: "text/plain", text: "ready" })
  assert.deepEqual(await second, { kind: "text", mime: "text/plain", text: "ready" })
})

const previewItem: LocalArtifactItem = {
  kind: "file",
  path: "/tmp/preview.txt",
  name: "preview.txt",
  mime: "text/plain",
  size: 1,
}
const textResult = (text: string): LocalArtifactPreviewResult => ({ kind: "text", mime: "text/plain", text })
function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((r) => {
    resolve = r
  })
  return { promise, resolve }
}

test("transient failure is retried when the same file is requested again", async () => {
  const cache: LocalArtifactPreviewCache = new Map()
  for (const reason of ["read_failed", "missing"] as const) {
    const failed: LocalArtifactPreviewResult = { kind: "unsupported", mime: previewItem.mime, reason }
    assert.deepEqual(
      await loadCachedArtifactPreview(
        cache,
        previewItem,
        async () => failed,
        "interactive",
        new AbortController().signal,
      ),
      failed,
    )
    assert.equal(cache.size, 0)
  }
  const healthy = vi.fn(async () => textResult("recovered"))
  assert.deepEqual(
    await loadCachedArtifactPreview(cache, previewItem, healthy, "interactive", new AbortController().signal),
    textResult("recovered"),
  )
  assert.equal(healthy.mock.calls.length, 1)
})

test("stable unsupported results still use the cache", async () => {
  const cache: LocalArtifactPreviewCache = new Map()
  const load = vi.fn(async (): Promise<LocalArtifactPreviewResult> => ({
    kind: "unsupported",
    mime: previewItem.mime,
    reason: "unsupported_type",
  }))
  await loadCachedArtifactPreview(cache, previewItem, load, "interactive", new AbortController().signal)
  await loadCachedArtifactPreview(cache, previewItem, load, "interactive", new AbortController().signal)
  assert.equal(load.mock.calls.length, 1)
})

test("an invalidated older request cannot overwrite a newer cached result", async () => {
  const cache: LocalArtifactPreviewCache = new Map()
  const old = deferred<LocalArtifactPreviewResult>()
  const oldWait = loadCachedArtifactPreview(
    cache,
    previewItem,
    () => old.promise,
    "interactive",
    new AbortController().signal,
  )
  cache.delete(artifactPreviewCacheKey(previewItem))
  await loadCachedArtifactPreview(
    cache,
    previewItem,
    async () => textResult("new"),
    "interactive",
    new AbortController().signal,
  )
  old.resolve(textResult("old"))
  await oldWait
  assert.equal(cache.get(artifactPreviewCacheKey(previewItem))?.result?.text, "new")
})

test("reacquiring an aborted queued request starts a fresh request", async () => {
  const blocker = deferred<void>()
  const blockers = Array.from({ length: 2 }, () => scheduleArtifactPreviewLoad(() => blocker.promise, "interactive"))
  const cache: LocalArtifactPreviewCache = new Map()
  const controller = new AbortController()
  const load = vi.fn(async () => textResult("ready"))
  const first = loadCachedArtifactPreview(cache, previewItem, load, "interactive", controller.signal).catch(() => null)
  controller.abort()
  const second = loadCachedArtifactPreview(cache, previewItem, load, "interactive", new AbortController().signal)
  blocker.resolve()
  assert.deepEqual(await second, textResult("ready"))
  assert.equal(load.mock.calls.length, 1)
  await Promise.all([...blockers, first])
})

test("direct cache loads refresh expired resource leases", async () => {
  const cache: LocalArtifactPreviewCache = new Map([
    [
      artifactPreviewCacheKey(previewItem),
      { result: { kind: "image", mime: "image/png", resourceUrl: "expired", resourceExpiresAt: Date.now() - 1 } },
    ],
  ])
  const fresh: LocalArtifactPreviewResult = {
    kind: "image",
    mime: "image/png",
    resourceUrl: "fresh",
    resourceExpiresAt: Date.now() + 120_000,
  }
  const load = vi.fn(async () => fresh)
  assert.equal(
    (await loadCachedArtifactPreview(cache, previewItem, load, "interactive", new AbortController().signal))
      .resourceUrl,
    "fresh",
  )
  assert.equal(load.mock.calls.length, 1)
})

test("an already cancelled consumer neither loads nor returns cached data", async () => {
  const cache: LocalArtifactPreviewCache = new Map([
    [artifactPreviewCacheKey(previewItem), { result: textResult("cached") }],
  ])
  const controller = new AbortController()
  controller.abort()
  const load = vi.fn(async () => textResult("unused"))
  await assert.rejects(loadCachedArtifactPreview(cache, previewItem, load, "interactive", controller.signal))
  assert.equal(load.mock.calls.length, 0)
})
