import { describe, expect, it } from "vitest"
import { defaultRegistrySkillSetVersion, defaultRegistrySkills } from "./default-registry-skills.ts"

describe("default Registry Skills", () => {
  it("installs the public social research adapter through the Registry runtime", () => {
    expect(defaultRegistrySkillSetVersion).toBe(3)
    expect(defaultRegistrySkills).toContainEqual({
      category: "other",
      enabled: true,
      packageName: "@alwaysmavs/public-social-research",
      skillId: "public-social-research",
    })
  })
})
