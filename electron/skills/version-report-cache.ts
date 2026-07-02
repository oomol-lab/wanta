import type { SkillInventory } from "./common.ts"

export function createVersionReportCacheKey(inventory: SkillInventory): string {
  return inventory.groups
    .flatMap((group) => {
      return group.hosts.map((host) => {
        return [
          group.id,
          group.kind,
          group.packageName ?? "",
          group.version ?? "",
          host.agentId,
          host.status,
          host.controlState ?? "",
          host.version ?? "",
        ].join(":")
      })
    })
    .sort()
    .join("|")
}
