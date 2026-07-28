import { access } from "node:fs/promises"
import path from "node:path"
import { describe, expect, it } from "vitest"
import { wantaBundledSkillIds, wantaSkillsDir } from "./skills.ts"

describe("Wanta bundled skills", () => {
  it("keeps a tracked SKILL.md source for every bundled Wanta skill", async () => {
    await expect(
      Promise.all(wantaBundledSkillIds.map((skillId) => access(path.join(wantaSkillsDir, skillId, "SKILL.md")))),
    ).resolves.toBeDefined()
  })
})
