import { access, mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { describe, expect, it } from "vitest"
import { exportBundledSkills, wantaBundledSkillIds, wantaSkillsDir } from "./skills.ts"

describe("Wanta bundled skills", () => {
  it("keeps a tracked SKILL.md source for every bundled Wanta skill", async () => {
    await expect(
      Promise.all(wantaBundledSkillIds.map((skillId) => access(path.join(wantaSkillsDir, skillId, "SKILL.md")))),
    ).resolves.toBeDefined()
  })

  it("adds the tracked Wanta fast path through the bundled Skill export", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "wanta-skill-overrides-"))
    const outDir = path.join(root, "skills")
    await exportBundledSkills(outDir, async (directory) => {
      const publishDir = path.join(directory, "oo-publish-skill")
      await mkdir(publishDir, { recursive: true })
      await writeFile(path.join(publishDir, "SKILL.md"), "# Upstream publish skill\n")
      return JSON.stringify({
        skills: ["oo", "oo-find-skills", "oo-create-skill", "oo-publish-skill"].map((skillId) => ({
          skillId,
          status: "exported",
        })),
        summary: { failed: 0 },
      })
    })

    const content = await readFile(path.join(outDir, "oo-publish-skill", "SKILL.md"), "utf8")
    expect(content).toContain("## Wanta fast path for publishing a new version")
    expect(content).toContain("Do not search logs, shell history, SQLite databases")
  })
})
