import assert from "node:assert/strict"
import { execFile } from "node:child_process"
import { mkdtemp, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { promisify } from "node:util"
import { test } from "vitest"
import { scopedCommandSequence } from "./command-sequence.ts"

test("output filters retain dependency steps and following commands", () => {
  assert.deepEqual(scopedCommandSequence("npm install 2>&1 | tail -5 && npm test", "/work/project"), [
    { command: "npm install 2>&1 | tail -5", cwd: "/work/project" },
    { command: "npm test", cwd: "/work/project" },
  ])
  assert.deepEqual(scopedCommandSequence("npm install; npm test\nnpm run build", "/work/project"), [
    { command: "npm install", cwd: "/work/project" },
    { command: "npm test", cwd: "/work/project" },
    { command: "npm run build", cwd: "/work/project" },
  ])
})

test("unconditional separators account for every earlier directory change in the success chain", () => {
  assert.deepEqual(scopedCommandSequence("cd /work/project && npm install; npm test", "/work/other"), [
    { command: "npm install", cwd: "/work/project" },
    { command: "npm test", cwd: undefined },
  ])
  assert.deepEqual(scopedCommandSequence("cd /work/project; cd /work/project && npm install", "/work/other"), [
    { command: "npm install", cwd: "/work/project" },
  ])
  assert.deepEqual(scopedCommandSequence("cd /work/other && cd /work/project; npm install", "/work/project"), [
    { command: "npm install", cwd: undefined },
  ])
  assert.deepEqual(scopedCommandSequence("cd /work/project; npm install", "/work/project"), [
    { command: "npm install", cwd: "/work/project" },
  ])
})

test("ambiguous pipelines and control flow never establish dependency scope", () => {
  for (const command of [
    "cd /work/project | tail -5; npm install",
    "cd /work/project | tail -5 && npm install",
    "npm install | sh && npm test",
    "npm install | tail -5 &&",
    "npm install |",
    "npm install || npm test",
    "npm install & npm test",
    "source setup.sh; npm install",
    "if true; then cd /work/project; fi; npm install",
    "! cd /work/project; npm install",
    "alias enter='cd /work/project'; enter; npm install",
    "trap 'cd /work/project' DEBUG; npm install",
  ])
    assert.equal(scopedCommandSequence(command, "/work/other"), undefined, command)
})

test.skipIf(process.platform === "win32")(
  "a real failed cd followed by a separator keeps the original shell directory",
  async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "wanta-command-sequence-"))
    const missing = path.join(root, "missing")
    const quote = (value: string) => `'${value.replaceAll("'", "'\\''")}'`
    try {
      const command = `cd ${quote(missing)} && printf skipped; pwd`
      const { stdout } = await promisify(execFile)("sh", ["-c", command], { cwd: root })
      assert.ok(stdout.trim().endsWith(path.basename(root)))
      assert.equal(scopedCommandSequence(command, root)?.at(-1)?.cwd, undefined)
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  },
)

test("UNC directories retain Windows scope while POSIX backslashes remain literal", () => {
  const unc = String.raw`\\server\share\project`
  assert.deepEqual(scopedCommandSequence(`cd '${unc}' && npm install`, "/work/project"), [
    { command: "npm install", cwd: unc },
  ])
  assert.deepEqual(scopedCommandSequence("cd child && npm install", unc), [
    { command: "npm install", cwd: String.raw`\\server\share\project\child` },
  ])
  assert.deepEqual(scopedCommandSequence(String.raw`cd 'folder\name' && npm install`, "/work/project"), [
    { command: "npm install", cwd: String.raw`/work/project/folder\name` },
  ])
})

test("a standalone pipeline cannot be expanded into the same permission request", () => {
  assert.equal(scopedCommandSequence("npm install 2>&1 | tail -5"), undefined)
  assert.equal(scopedCommandSequence("npm install 2>&1 | head -20 | tail -5", "/outside"), undefined)
  assert.deepEqual(scopedCommandSequence("cd /work/project && npm install 2>&1 | tail -5"), [
    { command: "npm install 2>&1 | tail -5", cwd: "/work/project" },
  ])
})
