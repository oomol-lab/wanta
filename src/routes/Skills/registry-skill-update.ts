import type { SkillInventory } from "../../../electron/skills/common.ts"

export interface RegistrySkillUpdateOperation {
  invalidateVersions(): void
  refreshVersions(): Promise<unknown>
  reportVersionRefreshError(cause: unknown): void
  setInventory(inventory: SkillInventory): void
  update(): Promise<SkillInventory>
}

/**
 * The mutation is complete once the main process returns its freshly scanned inventory.
 * A full registry version check is only a background consistency refresh and must not
 * keep the update action busy or turn a successful update into a failure.
 */
export async function runRegistrySkillUpdate(operation: RegistrySkillUpdateOperation): Promise<SkillInventory> {
  const inventory = await operation.update()

  operation.setInventory(inventory)
  operation.invalidateVersions()
  void operation.refreshVersions().catch((cause: unknown) => {
    operation.reportVersionRefreshError(cause)
  })

  return inventory
}
