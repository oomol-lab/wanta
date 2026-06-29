import assert from "node:assert/strict"
import { execFile } from "node:child_process"
import { mkdtemp, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { promisify } from "node:util"
import { test } from "vitest"
import { buildUnifiedDiff, captureGitTurnBaseline, collectGitTurnDiffs } from "./turn-diff.ts"

const execFileAsync = promisify(execFile)

async function git(cwd: string, args: string[]): Promise<void> {
  await execFileAsync("git", args, { cwd, encoding: "utf8" })
}

test("buildUnifiedDiff reports added and deleted lines", () => {
  const diff = buildUnifiedDiff("demo.txt", "one\ntwo", "one\nthree", "text/plain")

  assert.equal(diff.kind, "text")
  assert.equal(diff.additions, 1)
  assert.equal(diff.deletions, 1)
  assert.match(diff.patch ?? "", /\+three/)
  assert.match(diff.patch ?? "", /-two/)
})

test("collectGitTurnDiffs compares against dirty turn baseline instead of HEAD", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "wanta-turn-diff-"))
  try {
    await git(root, ["init"])
    await git(root, ["config", "user.email", "test@example.com"])
    await git(root, ["config", "user.name", "Test User"])
    await writeFile(path.join(root, "report.txt"), "base\n", "utf8")
    await git(root, ["add", "report.txt"])
    await git(root, ["commit", "-m", "initial"])

    await writeFile(path.join(root, "report.txt"), "user edit\n", "utf8")
    const baseline = await captureGitTurnBaseline(root)
    await writeFile(path.join(root, "report.txt"), "user edit\nagent edit\n", "utf8")

    const diffs = await collectGitTurnDiffs(baseline, () => "text/plain")

    assert.equal(diffs.length, 1)
    assert.equal(diffs[0]?.path, "report.txt")
    assert.equal(diffs[0]?.diff.additions, 1)
    assert.equal(diffs[0]?.diff.deletions, 0)
    assert.match(diffs[0]?.diff.patch ?? "", /\+agent edit/)
    assert.doesNotMatch(diffs[0]?.diff.patch ?? "", /-base/)
  } finally {
    await rm(root, { force: true, recursive: true })
  }
})
