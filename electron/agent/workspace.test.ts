import assert from "node:assert/strict"
import { access, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { test } from "vitest"
import { AGENT_TOOL_FILES } from "./tool-sources.ts"
import { ensureAgentWorkspace } from "./workspace.ts"

async function exists(pathname: string): Promise<boolean> {
  try {
    await access(pathname)
    return true
  } catch {
    return false
  }
}

async function writeSkill(skillsDir: string, name: string): Promise<void> {
  const dir = path.join(skillsDir, name)
  await mkdir(path.join(dir, "references"), { recursive: true })
  await writeFile(path.join(dir, "SKILL.md"), `---\nname: ${name}\n---\n# ${name}\n`, "utf-8")
  await writeFile(path.join(dir, "references", "extra.md"), "ref", "utf-8")
}

test("ensureAgentWorkspace writes tool sources and copies bundled skills into .opencode/skill", async () => {
  const base = await mkdtemp(path.join(os.tmpdir(), "lumo-workspace-"))
  try {
    const workspaceDir = path.join(base, "workspace")
    const bundledSkillsDir = path.join(base, "bundled-skills")
    await writeSkill(bundledSkillsDir, "oo")
    await writeSkill(bundledSkillsDir, "oo-find-skills")

    const result = await ensureAgentWorkspace(workspaceDir, bundledSkillsDir)
    assert.equal(result, workspaceDir)

    for (const toolName of Object.keys(AGENT_TOOL_FILES)) {
      assert.ok(await exists(path.join(workspaceDir, ".opencode", "tools", toolName)), `tool ${toolName} written`)
    }

    const skillRoot = path.join(workspaceDir, ".opencode", "skill")
    assert.ok(await exists(path.join(skillRoot, "oo", "SKILL.md")), "oo SKILL.md copied")
    assert.ok(await exists(path.join(skillRoot, "oo", "references", "extra.md")), "oo references copied")
    assert.ok(await exists(path.join(skillRoot, "oo-find-skills", "SKILL.md")), "oo-find-skills SKILL.md copied")
  } finally {
    await rm(base, { force: true, recursive: true })
  }
})

test("ensureAgentWorkspace rebuilds .opencode/skill so removed bundled skills do not linger", async () => {
  const base = await mkdtemp(path.join(os.tmpdir(), "lumo-workspace-"))
  try {
    const workspaceDir = path.join(base, "workspace")
    const bundledSkillsDir = path.join(base, "bundled-skills")
    await writeSkill(bundledSkillsDir, "oo")
    await writeSkill(bundledSkillsDir, "stale-skill")
    await ensureAgentWorkspace(workspaceDir, bundledSkillsDir)
    assert.ok(await exists(path.join(workspaceDir, ".opencode", "skill", "stale-skill", "SKILL.md")))

    // 第二次：bundled 源里移除 stale-skill，workspace 应同步清除。
    await rm(path.join(bundledSkillsDir, "stale-skill"), { force: true, recursive: true })
    await ensureAgentWorkspace(workspaceDir, bundledSkillsDir)

    assert.ok(await exists(path.join(workspaceDir, ".opencode", "skill", "oo", "SKILL.md")), "kept skill remains")
    assert.equal(
      await exists(path.join(workspaceDir, ".opencode", "skill", "stale-skill")),
      false,
      "removed skill cleared",
    )
  } finally {
    await rm(base, { force: true, recursive: true })
  }
})

test("ensureAgentWorkspace works without a bundled skills directory", async () => {
  const base = await mkdtemp(path.join(os.tmpdir(), "lumo-workspace-"))
  try {
    const workspaceDir = path.join(base, "workspace")
    await ensureAgentWorkspace(workspaceDir, path.join(base, "does-not-exist"))
    assert.ok(await exists(path.join(workspaceDir, ".opencode", "tools")), "tools still written")
    assert.equal(await exists(path.join(workspaceDir, ".opencode", "skill")), false, "no skill dir when source missing")
  } finally {
    await rm(base, { force: true, recursive: true })
  }
})
