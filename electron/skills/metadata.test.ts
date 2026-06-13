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
      "example",
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

test("normalizeMetadata treats bundled skill ids as bundled when metadata is invalid", () => {
  assert.deepEqual(normalizeMetadata("{", "oo-find-skills"), {
    kind: "bundled",
  })
})

test("normalizeMetadata treats unsupported kind as unknown", () => {
  assert.equal(normalizeMetadata(JSON.stringify({ kind: "private" }), "custom-skill").kind, "unknown")
})
