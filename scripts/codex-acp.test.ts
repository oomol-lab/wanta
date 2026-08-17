import assert from "node:assert/strict"
import { mkdtemp, readFile, rm, stat } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { test } from "vitest"
import { bundleCodexAcp } from "./codex-acp.ts"

test("bundles a runnable POSIX codex-acp bridge entry", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "wanta-codex-acp-"))
  try {
    const bundled = bundleCodexAcp(directory, "darwin")
    assert.equal(path.basename(bundled.entryPath), "codex-acp")
    assert.equal(path.basename(bundled.scriptPath), "codex-acp.js")
    assert.match(bundled.version, /^\d+\.\d+\.\d+/u)
    assert.match(await readFile(bundled.entryPath, "utf8"), /WANTA_NODE_RUNTIME/u)
    assert.notEqual((await stat(bundled.entryPath)).mode & 0o111, 0)
    assert.ok((await stat(bundled.scriptPath)).size > 0)
  } finally {
    await rm(directory, { force: true, recursive: true })
  }
})

test("bundles a Windows command shim for codex-acp", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "wanta-codex-acp-"))
  try {
    const bundled = bundleCodexAcp(directory, "win32")
    assert.equal(path.basename(bundled.entryPath), "codex-acp.cmd")
    assert.match(await readFile(bundled.entryPath, "utf8"), /ELECTRON_RUN_AS_NODE=1/u)
    assert.ok((await stat(bundled.scriptPath)).size > 0)
  } finally {
    await rm(directory, { force: true, recursive: true })
  }
})
