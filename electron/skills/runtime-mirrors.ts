import type { SafeSkillDirectoryRemoveResult } from "./file-operations.ts"
import type { SkillManifestRecord } from "./types.ts"

import { access } from "node:fs/promises"
import path from "node:path"
import { removeSkillDirectoryIfSafe } from "./file-operations.ts"
import { hashTextFiles } from "./hash.ts"
import { readManifestStore, writeManifestStore } from "./manifest.ts"

export interface RuntimeMirrorReconcileResult {
  changed: boolean
  skipped: SafeSkillDirectoryRemoveResult[]
}

function directChildOf(rootPath: string, candidatePath: string): boolean {
  return path.dirname(path.resolve(candidatePath)) === path.resolve(rootPath)
}

async function sourcePathExists(sourcePath: string): Promise<boolean> {
  try {
    await access(sourcePath)
    return true
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return false
    }
    throw error
  }
}

export function isExternalRuntimeMirrorRecord(
  record: SkillManifestRecord,
  sharedSkillRoot: string,
  externalSkillRoots: readonly string[],
): boolean {
  return (
    record.agentId === "wanta" &&
    directChildOf(sharedSkillRoot, record.installedPath) &&
    externalSkillRoots.some((rootPath) => directChildOf(rootPath, record.sourcePath))
  )
}

export async function reconcileExternalRuntimeSkillMirrors(request: {
  activeTargetPaths: ReadonlySet<string>
  externalSkillRoots: readonly string[]
  manifestPath: string
  sharedSkillRoot: string
}): Promise<RuntimeMirrorReconcileResult> {
  const manifestStore = await readManifestStore(request.manifestPath)
  const activeTargetPaths = new Set([...request.activeTargetPaths].map((targetPath) => path.resolve(targetPath)))
  const removedRecords = new Set<SkillManifestRecord>()
  const skipped: SafeSkillDirectoryRemoveResult[] = []
  let runtimeChanged = false

  for (const record of manifestStore.records) {
    const targetPath = path.resolve(record.installedPath)
    if (
      activeTargetPaths.has(targetPath) ||
      !isExternalRuntimeMirrorRecord(record, request.sharedSkillRoot, request.externalSkillRoots)
    ) {
      continue
    }
    if (await sourcePathExists(record.sourcePath)) {
      // 扫描暂时不可用时不根据一次空结果撤销镜像；只有源目录确实消失才清理。
      continue
    }

    const currentHash = await hashTextFiles(targetPath)
    if (currentHash && currentHash !== record.hash) {
      // 用户已经修改过镜像时保留目录，只解除 Wanta 对该目录的镜像所有权。
      removedRecords.add(record)
      continue
    }

    const result = await removeSkillDirectoryIfSafe({
      allowedRoots: [request.sharedSkillRoot],
      path: targetPath,
      skillId: path.basename(targetPath),
    })
    if (result.status === "removed") {
      runtimeChanged = true
      removedRecords.add(record)
      continue
    }
    if (result.reason === "missing") {
      removedRecords.add(record)
      continue
    }
    skipped.push(result)
  }

  if (removedRecords.size === 0) {
    return { changed: false, skipped }
  }

  await writeManifestStore(request.manifestPath, {
    ...manifestStore,
    records: manifestStore.records.filter((record) => !removedRecords.has(record)),
  })
  return { changed: runtimeChanged || removedRecords.size > 0, skipped }
}
