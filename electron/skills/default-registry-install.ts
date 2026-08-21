import type { SkillInventory } from "./common.ts"
import type { DefaultRegistrySkillSpec } from "./default-registry-skills.ts"

import { normalizeSkillId } from "./file-operations.ts"
import { semanticVersionIsBefore } from "./semantic-version.ts"

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

export function defaultRegistrySkillNeedsUpdate(inventory: SkillInventory, spec: DefaultRegistrySkillSpec): boolean {
  const minimumVersion = spec.minimumVersion?.trim()
  if (!minimumVersion) {
    return false
  }
  const skillId = normalizeSkillId(spec.skillId)
  const group = inventory.groups.find((item) => item.id === skillId)
  if (group?.kind !== "registry" || group.packageName?.trim() !== spec.packageName.trim()) {
    return false
  }
  const runtimeHost = group?.runtimeHosts.find((host) => host.status === "installed")
  if (!runtimeHost) {
    return false
  }
  return semanticVersionIsBefore(runtimeHost.version ?? group?.version, minimumVersion)
}

export function runtimeErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
