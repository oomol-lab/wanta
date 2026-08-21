import type { SkillInventory } from "./common.ts"

import { describe, expect, it } from "vitest"
import { defaultRegistrySkillNeedsUpdate } from "./default-registry-install.ts"

function inventory(version?: string): SkillInventory {
  return {
    groups: [
      {
        externalHosts: [],
        hosts: [],
        id: "gpt-image-2",
        kind: "registry",
        name: "gpt-image-2",
        packageName: "@zjxuyunshi/gpt-image-2",
        runtimeHosts: [
          {
            agentId: "wanta",
            agentName: "Wanta",
            scope: "runtime",
            status: "installed",
            version,
          },
        ],
        version,
      },
    ],
    summary: {
      localSkills: 0,
      managedSkills: 1,
      modifiedHosts: 0,
      needsAttention: 0,
      publishableSkills: 0,
      registrySkills: 1,
      skills: [],
      sourceMissingHosts: 0,
    },
    updatedAt: new Date(0).toISOString(),
  }
}

const spec = {
  enabled: true,
  minimumVersion: "1.1.2",
  packageName: "@zjxuyunshi/gpt-image-2",
  skillId: "gpt-image-2",
}

describe("defaultRegistrySkillNeedsUpdate", () => {
  it("updates a runtime below the required baseline", () => {
    expect(defaultRegistrySkillNeedsUpdate(inventory("1.1.1"), spec)).toBe(true)
    expect(defaultRegistrySkillNeedsUpdate(inventory(undefined), spec)).toBe(true)
  })

  it("leaves the baseline and newer versions unchanged", () => {
    expect(defaultRegistrySkillNeedsUpdate(inventory("1.1.2"), spec)).toBe(false)
    expect(defaultRegistrySkillNeedsUpdate(inventory("1.2.0"), spec)).toBe(false)
  })

  it("does not update defaults without a version requirement", () => {
    expect(defaultRegistrySkillNeedsUpdate(inventory("0.0.1"), { ...spec, minimumVersion: undefined })).toBe(false)
  })

  it("does not replace a local or differently packaged skill with the same id", () => {
    const localInventory = inventory("1.1.1")
    localInventory.groups[0] = { ...localInventory.groups[0]!, kind: "local" }
    expect(defaultRegistrySkillNeedsUpdate(localInventory, spec)).toBe(false)

    const otherPackageInventory = inventory("1.1.1")
    otherPackageInventory.groups[0] = {
      ...otherPackageInventory.groups[0]!,
      packageName: "@someone-else/gpt-image-2",
    }
    expect(defaultRegistrySkillNeedsUpdate(otherPackageInventory, spec)).toBe(false)
  })
})
