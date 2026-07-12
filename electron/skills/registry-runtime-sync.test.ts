import assert from "node:assert/strict"
import { mkdtemp, mkdir, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { afterEach, test, vi } from "vitest"
import { RegistrySkillRuntimeSynchronizer } from "./registry-runtime-sync.ts"
import { emptyRemovedSkillStore, upsertRemovedSkillRecord } from "./removed-store.ts"

const temporaryRoots: string[] = []

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, { force: true, recursive: true })))
})

async function createSynchronizer(registrySkillRoot: string) {
  const root = await mkdtemp(path.join(os.tmpdir(), "wanta-registry-runtime-"))
  temporaryRoots.push(root)
  const loadInventory = vi.fn(async () => ({ groups: [], summary: { managedSkills: 0 } }) as never)
  const repairSource = vi.fn(async () => undefined)
  return {
    loadInventory,
    repairSource,
    synchronizer: new RegistrySkillRuntimeSynchronizer({
      cacheSkillStoreRoot: path.join(root, "cache"),
      loadInventory,
      manifestPath: path.join(root, "manifest.json"),
      registrySkillRoot,
      repairSource,
      sharedSkillRoot: path.join(root, "shared"),
    }),
  }
}

test("missing registry cache is a no-op", async () => {
  const { synchronizer, loadInventory, repairSource } = await createSynchronizer("/missing/wanta-registry-root")
  assert.equal(await synchronizer.syncMissing(emptyRemovedSkillStore()), false)
  assert.equal(loadInventory.mock.calls.length, 0)
  assert.equal(repairSource.mock.calls.length, 0)
})

test("removed registry skills are not restored into runtime", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "wanta-registry-list-"))
  temporaryRoots.push(root)
  await mkdir(path.join(root, "removed-skill"), { recursive: true })
  const { synchronizer, repairSource } = await createSynchronizer(root)
  const removed = upsertRemovedSkillRecord(emptyRemovedSkillStore(), {
    removedAt: new Date().toISOString(),
    scope: "local-machine",
    skillId: "removed-skill",
  })
  assert.equal(await synchronizer.syncMissing(removed), false)
  assert.equal(repairSource.mock.calls.length, 0)
})
