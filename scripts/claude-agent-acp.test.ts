import assert from "node:assert/strict"
import { execFile } from "node:child_process"
import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { promisify } from "node:util"
import { test } from "vitest"
import { bundleClaudeAgentAcp } from "./claude-agent-acp.ts"

const execFileAsync = promisify(execFile)

test("bundles a runnable POSIX claude-agent-acp bridge entry", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "wanta-claude-agent-acp-"))
  try {
    const bundled = await bundleClaudeAgentAcp(directory, "darwin")
    assert.equal(path.basename(bundled.entryPath), "claude-agent-acp")
    assert.equal(path.basename(bundled.scriptPath), "claude-agent-acp.mjs")
    assert.equal(bundled.version, "0.70.0")
    const { stdout } = await execFileAsync(bundled.entryPath, ["--version"], {
      env: { ...process.env, WANTA_NODE_RUNTIME: process.execPath },
    })
    assert.equal(stdout.trim(), bundled.version)

    const claudePath = path.join(directory, "claude")
    await writeFile(claudePath, "#!/bin/sh\necho '2.1.232 (Claude Code)'\n", "utf8")
    await chmod(claudePath, 0o755)
    const native = await execFileAsync(bundled.entryPath, ["--cli", "--version"], {
      env: {
        ...process.env,
        CLAUDE_CODE_EXECUTABLE: claudePath,
        WANTA_NODE_RUNTIME: process.execPath,
      },
    })
    assert.equal(native.stdout.trim(), "2.1.232 (Claude Code)")
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test("bundles a Windows command shim for claude-agent-acp", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "wanta-claude-agent-acp-"))
  try {
    const bundled = await bundleClaudeAgentAcp(directory, "win32")
    assert.equal(path.basename(bundled.entryPath), "claude-agent-acp.cmd")
    const shim = await readFile(bundled.entryPath, "utf8")
    assert.match(shim, /WANTA_NODE_RUNTIME/u)
    assert.match(shim, /claude-agent-acp\.mjs/u)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})
