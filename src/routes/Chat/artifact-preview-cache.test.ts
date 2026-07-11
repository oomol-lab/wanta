import type { LocalArtifactPreviewCache } from "./artifact-preview-cache.ts"

import assert from "node:assert/strict"
import { test } from "vitest"
import {
  artifactPreviewCacheKey,
  artifactPreviewEstimatedBytes,
  artifactPreviewResourceIsFresh,
  trimArtifactPreviewCache,
} from "./artifact-preview-cache.ts"

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
