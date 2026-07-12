import type { RemovedSkillStore } from "./removed-store.ts"
import type { InstalledSkill, SkillManifestRecord } from "./types.ts"

import { access } from "node:fs/promises"
import path from "node:path"
import { resolveAgentSkillRoot, supportedAgents } from "../agents/catalog.ts"
import { logDiagnostic } from "../diagnostics-log.ts"
import { assertCanReplaceSharedSkillTarget, normalizeSkillId, replaceDirectory } from "./file-operations.ts"
import { readManifestStore, writeManifestStore } from "./manifest.ts"
import { isSkillRemovedByUser } from "./removed-store.ts"
import { assertSafeResetPaths } from "./reset.ts"
import { isExternalRuntimeMirrorRecord, reconcileExternalRuntimeSkillMirrors } from "./runtime-mirrors.ts"
import { scanInstalledSkills } from "./scan.ts"

type RemovedStore = Awaited<ReturnType<RemovedSkillStore["read"]>>

export interface ExternalSkillRuntimeSynchronizerOptions {
  bundledSkillRoot: string
  manifestPath: string
  sharedSkillRoot: string
}

/** 把外部 agent skills 镜像到 Wanta 私有 runtime，并串行化扫描、复制、manifest 与陈旧镜像清理。 */
export class ExternalSkillRuntimeSynchronizer {
  private readonly options: ExternalSkillRuntimeSynchronizerOptions
  private tail: Promise<void> = Promise.resolve()

  public constructor(options: ExternalSkillRuntimeSynchronizerOptions) {
    this.options = options
  }

  public async sync(removedStore: RemovedStore): Promise<boolean> {
    let synced = false
    const operation = this.tail
      .catch(() => undefined)
      .then(async () => {
        synced = await this.syncNow(removedStore)
      })
    this.tail = operation.then(
      () => undefined,
      () => undefined,
    )
    await operation
    return synced
  }

  private async syncNow(removedStore: RemovedStore): Promise<boolean> {
    const externalSkills = await scanInstalledSkills()
    const manifestStore = await readManifestStore(this.options.manifestPath)
    const externalSkillRoots = supportedAgents.map((agent) => resolveAgentSkillRoot(agent))
    const sortedSkills = [...externalSkills].sort((left, right) => {
      const leftAgentIndex = supportedAgents.findIndex((agent) => agent.id === left.agent.id)
      const rightAgentIndex = supportedAgents.findIndex((agent) => agent.id === right.agent.id)
      return (
        normalizeAgentSortIndex(leftAgentIndex) - normalizeAgentSortIndex(rightAgentIndex) ||
        left.name.localeCompare(right.name) ||
        left.path.localeCompare(right.path)
      )
    })
    const mirroredSkillIds = new Set<string>()
    const activeMirrorTargets = new Set<string>()
    let synced = false

    for (const skill of sortedSkills) {
      let skillId: string
      try {
        skillId = normalizeSkillId(skill.name)
      } catch {
        continue
      }
      if (
        mirroredSkillIds.has(skillId) ||
        isSkillRemovedByUser(removedStore, { packageName: skill.metadata.packageName, skillId }) ||
        (await pathExists(path.join(this.options.bundledSkillRoot, skillId)))
      ) {
        continue
      }
      mirroredSkillIds.add(skillId)
      const targetPath = this.targetPath(skillId)
      const mirrorRecord = readRuntimeMirrorManifestRecord(manifestStore, targetPath)
      const managedMirrorRecord =
        mirrorRecord && isExternalRuntimeMirrorRecord(mirrorRecord, this.options.sharedSkillRoot, externalSkillRoots)
          ? mirrorRecord
          : undefined
      const targetExists = await pathExists(targetPath)
      if (targetExists && !managedMirrorRecord) {
        continue
      }
      activeMirrorTargets.add(targetPath)
      if (targetExists && managedMirrorRecord?.sourcePath === skill.path && managedMirrorRecord.hash === skill.hash) {
        continue
      }
      try {
        await this.syncSkill(skill, skillId, { force: targetExists })
        synced = true
      } catch (error) {
        console.warn("[wanta] failed to sync external skill to runtime:", {
          agentId: skill.agent.id,
          error: error instanceof Error ? error.message : String(error),
          skillId,
        })
        logDiagnostic(
          "skills",
          "failed to sync external skill to runtime",
          { agentId: skill.agent.id, error, skillId },
          "warn",
        )
      }
    }

    const reconciliation = await reconcileExternalRuntimeSkillMirrors({
      activeTargetPaths: activeMirrorTargets,
      externalSkillRoots,
      manifestPath: this.options.manifestPath,
      sharedSkillRoot: this.options.sharedSkillRoot,
    })
    for (const result of reconciliation.skipped) {
      console.warn("[wanta] skipped stale external runtime skill cleanup:", result)
      logDiagnostic(
        "skills",
        "skipped stale external runtime skill cleanup",
        { path: result.path, reason: result.reason, status: result.status },
        "warn",
      )
    }
    return synced || reconciliation.changed
  }

  private async syncSkill(skill: InstalledSkill, skillId: string, options: { force: boolean }): Promise<void> {
    const targetPath = this.targetPath(skillId)
    assertSafeResetPaths(skill.path, targetPath)
    await assertCanReplaceSharedSkillTarget(targetPath, options)
    await replaceDirectory(skill.path, targetPath)
    await this.writeManifestRecord(skill, targetPath)
  }

  private async writeManifestRecord(skill: InstalledSkill, targetPath: string): Promise<void> {
    const manifestStore = await readManifestStore(this.options.manifestPath)
    const records = manifestStore.records.filter(
      (record) => !(record.agentId === "wanta" && record.installedPath === targetPath),
    )
    records.push({
      agentId: "wanta",
      hash: skill.hash,
      installedPath: targetPath,
      packageName: skill.metadata.packageName,
      scannedAt: new Date().toISOString(),
      skillName: skill.name,
      sourcePath: skill.path,
      version: skill.metadata.version,
    })
    await writeManifestStore(this.options.manifestPath, { schemaVersion: manifestStore.schemaVersion, records })
  }

  private targetPath(skillId: string): string {
    return path.join(this.options.sharedSkillRoot, normalizeSkillId(skillId))
  }
}

function readRuntimeMirrorManifestRecord(
  manifestStore: Awaited<ReturnType<typeof readManifestStore>>,
  targetPath: string,
): SkillManifestRecord | undefined {
  return manifestStore.records.find((record) => record.agentId === "wanta" && record.installedPath === targetPath)
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

function normalizeAgentSortIndex(index: number): number {
  return index === -1 ? Number.MAX_SAFE_INTEGER : index
}
