import { describe, expect, it } from "vitest"
import { defaultRegistrySkillSetVersion, defaultRegistrySkills } from "./default-registry-skills.ts"

describe("default Registry Skills", () => {
  it("installs the public TikHub adapter through the Registry runtime", () => {
    expect(defaultRegistrySkillSetVersion).toBe(2)
    expect(defaultRegistrySkills).toContainEqual({
      category: "other",
      enabled: true,
      packageName: "@alwaysmavs/tikhub-social-research",
      skillId: "tikhub-social-research",
    })
  })
})
