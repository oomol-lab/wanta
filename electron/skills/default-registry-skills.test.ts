import { describe, expect, it } from "vitest"
import { defaultRegistrySkillSetVersion, defaultRegistrySkills } from "./default-registry-skills.ts"

describe("default Registry Skills", () => {
  it("installs the public social research adapter through the Registry runtime", () => {
    expect(defaultRegistrySkillSetVersion).toBe(4)
    expect(defaultRegistrySkills).toContainEqual({
      category: "image-generation",
      enabled: true,
      minimumVersion: "1.1.2",
      packageName: "@zjxuyunshi/gpt-image-2",
      skillId: "gpt-image-2",
    })
    expect(defaultRegistrySkills).toContainEqual({
      category: "other",
      enabled: true,
      packageName: "@alwaysmavs/public-social-research",
      skillId: "public-social-research",
    })
  })
})
