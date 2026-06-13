import type { ManagedSkillMetadata } from "./types.ts"

import { builtInSkillIds } from "./constants.ts"

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined
}

export function normalizeMetadata(content: string, skillName: string): ManagedSkillMetadata {
  try {
    const parsed = JSON.parse(content) as Record<string, unknown>
    const kind = asString(parsed["kind"])

    return {
      description: asString(parsed["description"]),
      icon: asString(parsed["icon"]),
      kind:
        kind === "bundled" || kind === "registry" || kind === "local"
          ? kind
          : builtInSkillIds.includes(skillName as (typeof builtInSkillIds)[number])
            ? "bundled"
            : "unknown",
      packageName: asString(parsed["packageName"]),
      version: asString(parsed["version"]),
    }
  } catch {
    return {
      kind: builtInSkillIds.includes(skillName as (typeof builtInSkillIds)[number]) ? "bundled" : "unknown",
    }
  }
}
