import type { ManagedSkillGroup } from "./common.ts"

import { access, cp, mkdir, rename, rm } from "node:fs/promises"
import path from "node:path"
import { logDiagnostic } from "../diagnostics-log.ts"
import { metadataFileName } from "./constants.ts"

export function normalizeSkillId(skillId: string): string {
  const normalizedSkillId = skillId.trim()

  if (
    !normalizedSkillId ||
    normalizedSkillId.includes("/") ||
    normalizedSkillId.includes("\\") ||
    normalizedSkillId === "." ||
    normalizedSkillId === ".."
  ) {
    throw new Error(`Invalid Skill name: ${skillId}`)
  }

  return normalizedSkillId
}

function isPathInside(parentPath: string, childPath: string): boolean {
  const relativePath = path.relative(parentPath, childPath)
  return Boolean(relativePath) && !relativePath.startsWith("..") && !path.isAbsolute(relativePath)
}

export function readDeletableSkillTargetPaths(group: ManagedSkillGroup, skillRoots: string[]): string[] {
  const normalizedSkillId = normalizeSkillId(group.id)
  const normalizedSkillRoots = skillRoots.map((skillRoot) => path.resolve(skillRoot))
  const targetPaths = new Set<string>()

  for (const host of group.hosts) {
    const targetPath = host.path ? path.resolve(host.path) : undefined
    if (!targetPath || host.status !== "installed") {
      continue
    }

    if (path.basename(targetPath) !== normalizedSkillId) {
      continue
    }

    if (!normalizedSkillRoots.some((skillRoot) => isPathInside(skillRoot, targetPath))) {
      continue
    }

    targetPaths.add(targetPath)
  }

  return Array.from(targetPaths)
}

export async function localPathExists(pathname: string): Promise<boolean> {
  try {
    await access(pathname)
    return true
  } catch {
    return false
  }
}

export async function assertCanReplaceSharedSkillTarget(
  targetPath: string,
  options: { force: boolean },
): Promise<void> {
  if (!(await localPathExists(targetPath))) {
    return
  }

  if (options.force) {
    return
  }

  if (await localPathExists(path.join(targetPath, metadataFileName))) {
    return
  }

  throw new Error("A local Skill with the same name already exists in the shared Agent Skills directory.")
}

export async function replaceDirectory(sourcePath: string, targetPath: string): Promise<void> {
  const parentPath = path.dirname(targetPath)
  const targetName = path.basename(targetPath)
  const operationId = `${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}`
  const tempPath = path.join(parentPath, `.${targetName}.tmp-${operationId}`)
  const backupPath = path.join(parentPath, `.${targetName}.backup-${operationId}`)
  let hasBackup = false
  let preserveBackup = false

  await mkdir(parentPath, { recursive: true })
  await rm(tempPath, { force: true, recursive: true })
  await rm(backupPath, { force: true, recursive: true })

  try {
    await cp(sourcePath, tempPath, { recursive: true })

    if (await localPathExists(targetPath)) {
      await rename(targetPath, backupPath)
      hasBackup = true
    }

    try {
      await rename(tempPath, targetPath)
    } catch (cause) {
      if (hasBackup) {
        try {
          await rename(backupPath, targetPath)
          hasBackup = false
        } catch (rollbackError) {
          preserveBackup = true
          console.warn("[wanta] replaceDirectory rollback failed; backup preserved", {
            backupPath,
            error: rollbackError instanceof Error ? rollbackError.message : String(rollbackError),
          })
        }
      }
      throw cause
    }

    if (hasBackup) {
      await rm(backupPath, { force: true, recursive: true })
      hasBackup = false
    }
  } finally {
    await cleanupDirectory(tempPath, "temporary skill directory")
    if (hasBackup && !preserveBackup) {
      await cleanupDirectory(backupPath, "skill backup directory")
    }
  }
}

async function cleanupDirectory(targetPath: string, scope: string): Promise<void> {
  try {
    await rm(targetPath, { force: true, recursive: true })
  } catch (error) {
    console.warn(`[wanta] failed to clean up ${scope}:`, error)
    logDiagnostic("skills", "failed to clean up directory", { error, path: targetPath, scope }, "warn")
  }
}
