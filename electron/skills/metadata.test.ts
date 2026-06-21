import assert from "node:assert/strict"
import { test } from "vitest"
import { normalizeMetadata } from "./metadata.ts"

test("normalizeMetadata reads supported fields", () => {
  assert.deepEqual(
    normalizeMetadata(
      JSON.stringify({
        icon: "sparkles",
        description: "Generate images",
        kind: "registry",
        packageName: "@oomol/example",
        version: "1.2.3",
      }),
    ),
    {
      description: "Generate images",
      icon: "sparkles",
      kind: "registry",
      packageName: "@oomol/example",
      version: "1.2.3",
    },
  )
})

test("normalizeMetadata falls back to unknown when metadata is invalid", () => {
  assert.deepEqual(normalizeMetadata("{"), {
    kind: "unknown",
  })
})

test("normalizeMetadata treats unsupported kind as unknown", () => {
  assert.equal(normalizeMetadata(JSON.stringify({ kind: "private" })).kind, "unknown")
})
