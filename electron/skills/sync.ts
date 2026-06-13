import type { SkillSyncDirection } from "./common.ts"

export function createSkillSyncArgs(direction: SkillSyncDirection): string[] {
  return ["skills", "sync", direction, "--json"]
}
