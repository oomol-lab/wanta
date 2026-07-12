import type { SkillInventory, UpdateRegistrySkillRequest } from "./common.ts"
import type { RemovedSkillStore } from "./removed-store.ts"

import { access, readdir } from "node:fs/promises"
import path from "node:path"
import { logDiagnostic } from "../diagnostics-log.ts"
import { assertCanReplaceSharedSkillTarget, normalizeSkillId, replaceDirectory } from "./file-operations.ts"
import { readManifestStore, replaceManifestRecords, writeManifestStore } from "./manifest.ts"
import { isSkillRemovedByUser } from "./removed-store.ts"
import { assertSafeResetPaths } from "./reset.ts"
import { scanWantaInstalledSkills } from "./scan.ts"
import { resolveUsableRegistrySkillSourcePath } from "./source.ts"

type RemovedStore = Awaited<ReturnType<RemovedSkillStore["read"]>>

export interface RegistrySkillRuntimeSynchronizerOptions {
  cacheSkillStoreRoot: string
  loadInventory: () => Promise<SkillInventory>
  manifestPath: string
  repairSource: (request: { packageName: string; skillId: string }) => Promise<void>
  registrySkillRoot: string
  sharedSkillRoot: string
}

/** 把 registry cache 安全同步到 shared runtime，并在 cache 缺失时通过 service 回调修复来源。 */
export class RegistrySkillRuntimeSynchronizer {
  private readonly options: RegistrySkillRuntimeSynchronizerOptions

  public constructor(options: RegistrySkillRuntimeSynchronizerOptions) {
    this.options = options
  }

  public async syncMissing(removedStore: RemovedStore): Promise<boolean> {
    let entries
    try {
      entries = await readdir(this.options.registrySkillRoot, { withFileTypes: true })
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return false
      }
      throw error
    }
    let synced = false
    for (const entry of entries) {
      if (!entry.isDirectory()) {
        continue
      }
      let skillId: string
      try {
        skillId = normalizeSkillId(entry.name)
      } catch {
        continue
      }
      if (isSkillRemovedByUser(removedStore, { skillId }) || (await pathExists(this.targetPath(skillId)))) {
        continue
      }
      try {
        await this.syncSkill(skillId, { force: false })
        synced = true
      } catch (error) {
        console.warn("[wanta] failed to sync cached registry skill to runtime:", {
          error: error instanceof Error ? error.message : String(error),
          skillId,
        })
        logDiagnostic("skills", "failed to sync cached registry skill to runtime", { error, skillId }, "warn")
      }
    }
    return synced
  }

  public async syncUpdated(request: UpdateRegistrySkillRequest): Promise<void> {
    const inventory = await this.options.loadInventory()
    const requestedSkillId = request.skillId?.trim()
    if (requestedSkillId) {
      const group = inventory.groups.find((item) => item.id === requestedSkillId)
      if (group?.kind !== "registry" || !group.packageName?.trim()) {
        return
      }
      await this.syncSkill(requestedSkillId, {
        force: true,
        packageName: request.packageName?.trim() || group.packageName,
      })
      return
    }
    for (const group of inventory.groups) {
      if (group.kind === "registry" && group.packageName?.trim()) {
        await this.syncSkill(group.id, { force: true, packageName: group.packageName })
      }
    }
  }

  public async syncSkill(skillId: string, options: { force: boolean; packageName?: string }): Promise<void> {
    const normalizedSkillId = normalizeSkillId(skillId)
    let sourcePath = await this.resolveSource(normalizedSkillId, { packageName: options.packageName })
    if (!sourcePath && options.packageName) {
      await this.options.repairSource({ packageName: options.packageName, skillId: normalizedSkillId })
      sourcePath = await this.resolveSource(normalizedSkillId, { packageName: options.packageName })
    }
    if (!sourcePath) {
      throw new Error(`Cached Skill source not found: ${normalizedSkillId}`)
    }
    const targetPath = this.targetPath(normalizedSkillId)
    assertSafeResetPaths(sourcePath, targetPath)
    await assertCanReplaceSharedSkillTarget(targetPath, options)
    await replaceDirectory(sourcePath, targetPath)
    await this.refreshManifest([targetPath])
  }

  private resolveSource(
    skillId: string,
    options: { includeCanonicalStore?: boolean; packageName?: string } = {},
  ): Promise<string | undefined> {
    return resolveUsableRegistrySkillSourcePath({
      cacheSkillStoreRoot: this.options.cacheSkillStoreRoot,
      includeCanonicalStore: options.includeCanonicalStore,
      packageName: options.packageName,
      skillId: normalizeSkillId(skillId),
    })
  }

  private async refreshManifest(targetPaths: string[]): Promise<void> {
    const [installedSkills, manifestStore] = await Promise.all([
      scanWantaInstalledSkills({
        cacheSkillStoreRoot: this.options.cacheSkillStoreRoot,
        sharedSkillRoot: this.options.sharedSkillRoot,
      }),
      readManifestStore(this.options.manifestPath),
    ])
    const targets = new Set(targetPaths)
    const targetSkills = installedSkills.filter((skill) => targets.has(skill.path))
    await writeManifestStore(this.options.manifestPath, replaceManifestRecords(manifestStore, targetSkills))
  }

  private targetPath(skillId: string): string {
    return path.join(this.options.sharedSkillRoot, normalizeSkillId(skillId))
  }
}

async function pathExists(pathname: string): Promise<boolean> {
  try {
    await access(pathname)
    return true
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return false
    }
    throw error
  }
}
