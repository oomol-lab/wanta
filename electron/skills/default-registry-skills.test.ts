import { describe, expect, it } from "vitest"
import { defaultRegistrySkillSetVersion, defaultRegistrySkills } from "./default-registry-skills.ts"

describe("default Registry Skills", () => {
  it("includes the enabled Registry skills installed by default", () => {
    expect(defaultRegistrySkillSetVersion).toBe(5)
    expect(defaultRegistrySkills).toContainEqual({
      category: "other",
      enabled: true,
      minimumVersion: "1.0.0",
      packageName: "oo-oomol-console",
      skillId: "oo-oomol-console",
    })
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
