import assert from "node:assert/strict"
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { test } from "vitest"
import { assertSafeResetPaths, resetSkillTargets } from "./reset.ts"

test("resetSkillTargets replaces target directory with source", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "oo-skill-reset-"))
  const sourcePath = path.join(root, "source")
  const currentPath = path.join(root, "target")

  try {
    await mkdir(sourcePath, { recursive: true })
    await mkdir(currentPath, { recursive: true })
    await writeFile(path.join(sourcePath, "SKILL.md"), "source")
    await writeFile(path.join(currentPath, "SKILL.md"), "changed")
    await writeFile(path.join(currentPath, "extra.txt"), "extra")

    await resetSkillTargets([
      {
        agentId: "codex",
        agentName: "Codex",
        controlState: "modified",
        currentPath,
        sourcePath,
      },
    ])

    assert.equal(await readFile(path.join(currentPath, "SKILL.md"), "utf8"), "source")
    await assert.rejects(readFile(path.join(currentPath, "extra.txt"), "utf8"))
  } finally {
    await rm(root, { force: true, recursive: true })
  }
})

test("assertSafeResetPaths rejects identical source and target", () => {
  assert.throws(() => assertSafeResetPaths("/tmp/example", "/tmp/example"))
})

test("assertSafeResetPaths rejects source and target containment", () => {
  assert.throws(() => assertSafeResetPaths("/tmp/example/source", "/tmp/example/source/target"))
  assert.throws(() => assertSafeResetPaths("/tmp/example/source/target", "/tmp/example/source"))
})
