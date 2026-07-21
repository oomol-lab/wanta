import type { SkillInventory } from "./common.ts"
import type { DefaultRegistrySkillSpec } from "./default-registry-skills.ts"

import { normalizeSkillId } from "./file-operations.ts"

export function normalizeDefaultRegistrySkillRequest(spec: DefaultRegistrySkillSpec): {
  packageName: string
  skillId: string
} {
  const packageName = spec.packageName.trim()
  if (!packageName) {
    throw new Error("Default registry Skill packageName is empty.")
  }

  return {
    packageName,
    skillId: normalizeSkillId(spec.skillId),
  }
}

export function isRuntimeSkillInstalled(inventory: SkillInventory, skillId: string): boolean {
  const normalizedSkillId = normalizeSkillId(skillId)
  const group = inventory.groups.find((item) => item.id === normalizedSkillId)
  return group?.runtimeHosts.some((host) => host.status === "installed") ?? false
}

export function runtimeErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
