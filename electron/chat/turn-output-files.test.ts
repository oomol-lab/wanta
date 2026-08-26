import type { StoredTurnOutputFile } from "./turn-outputs.ts"

import assert from "node:assert/strict"
import { mkdtemp, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { test } from "vitest"
import { boundTurnOutputPatchPayloads, intermediateArtifactProcessFiles, isPathInside } from "./turn-output-files.ts"

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

test("explicit artifact declarations route every undeclared file to execution details", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "wanta-turn-output-declared-"))
  try {
    await writeFile(path.join(root, "report.html"), "<!doctype html><title>Report</title>")
    await writeFile(path.join(root, "q_accounts.json"), JSON.stringify({ results: [] }))
    await writeFile(path.join(root, "build-report.py"), "print('report')\n")
    await writeFile(
      path.join(root, ".wanta-artifact.json"),
      JSON.stringify({
        title: "Report",
        kind: "web_page",
        display: "single",
        items: [{ path: "report.html", role: "primary", order: 1 }],
      }),
    )

    const files = await intermediateArtifactProcessFiles(root, "Create a website report")

    assert.deepEqual(
      files.map((item) => item.name),
      ["build-report.py", "q_accounts.json"],
    )
    assert.ok(files.every((item) => item.role === "process"))
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
