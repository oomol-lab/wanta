import type { StoredTurnOutputFile } from "./turn-outputs.ts"

import assert from "node:assert/strict"
import { test } from "vitest"
import { boundTurnOutputPatchPayloads, isPathInside } from "./turn-output-files.ts"

function file(path: string, patch: string): StoredTurnOutputFile {
  return {
    path,
    name: path,
    role: "project_change",
    changeKind: "modified",
    mime: "text/plain",
    additions: 1,
    deletions: 1,
    diff: { kind: "text", path, mime: "text/plain", additions: 1, deletions: 1, patch },
  }
}

test("boundTurnOutputPatchPayloads enforces a per-turn persisted patch budget", () => {
  const bounded = boundTurnOutputPatchPayloads([file("one.ts", "1234"), file("two.ts", "5678")], 6)

  assert.equal(bounded[0]?.diff.patch, "1234")
  assert.equal(bounded[1]?.diff.patch, undefined)
  assert.equal(bounded[1]?.diff.kind, "too_large")
  assert.equal(bounded[1]?.diff.truncated, true)
})

test("isPathInside accepts a child whose name starts with two dots", () => {
  assert.equal(isPathInside("/repo", "/repo/..config/file.txt"), true)
  assert.equal(isPathInside("/repo", "/outside/file.txt"), false)
})
