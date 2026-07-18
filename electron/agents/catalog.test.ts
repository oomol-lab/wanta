import assert from "node:assert/strict"
import { chmod, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { test } from "vitest"
import { detectCliCommand, readAgentDiscovery, supportedAgents } from "./catalog.ts"

const codexAgent = supportedAgents.find((agent) => agent.id === "codex")
const claudeCodeAgent = supportedAgents.find((agent) => agent.id === "claude-code")

test("Codex and Claude Code are discovered from skill roots without CLI commands", async () => {
  assert.ok(codexAgent)
  assert.ok(claudeCodeAgent)

  const homeDirectory = await mkdtemp(path.join(os.tmpdir(), "wanta-agent-discovery-"))

  try {
    await Promise.all([
      mkdir(path.join(homeDirectory, ".codex", "skills"), { recursive: true }),
      mkdir(path.join(homeDirectory, ".claude", "skills"), { recursive: true }),
    ])

    const entries = await readAgentDiscovery([codexAgent, claudeCodeAgent], {
      homeDirectory,
      pathEnv: "",
    })

    assert.deepEqual(
      entries.map((entry) => [entry.agent.id, entry.hasCli, entry.hasSkillRoot, entry.isDiscovered]),
      [
        ["codex", false, true, true],
        ["claude-code", false, true, true],
      ],
    )
  } finally {
    await rm(homeDirectory, { force: true, recursive: true })
  }
})

test("CLI discovery checks executable availability without launching the command", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "wanta-cli-discovery-"))
  const command = path.join(directory, "invalid-cli")

  try {
    // 该文件可执行但不是有效程序；若探测过程启动它，检测必然失败。
    await writeFile(command, "not an executable program")
    await chmod(command, 0o755)

    assert.equal(await detectCliCommand([command], { pathEnv: "" }), command)
  } finally {
    await rm(directory, { force: true, recursive: true })
  }
})

test("CLI discovery searches PATH and rejects missing commands", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "wanta-cli-path-discovery-"))
  const commandName = "test-agent-cli"
  const command = path.join(directory, process.platform === "win32" ? `${commandName}.EXE` : commandName)

  try {
    await writeFile(command, "not an executable program")
    await chmod(command, 0o755)

    assert.equal(await detectCliCommand([commandName], { pathEnv: directory }), commandName)
    assert.equal(await detectCliCommand(["missing-agent-cli"], { pathEnv: directory }), undefined)
  } finally {
    await rm(directory, { force: true, recursive: true })
  }
})
