import type { ManagedSkillGroup } from "./common.ts"

import { access, cp, lstat, mkdir, readFile, realpath, rename, rm } from "node:fs/promises"
import path from "node:path"
import { logDiagnostic } from "../diagnostics-log.ts"
import { metadataFileName } from "./constants.ts"
import { normalizeMetadata } from "./metadata.ts"

export type SafeSkillDirectoryRemoveStatus = "removed" | "skipped"

export interface SafeSkillDirectoryRemoveResult {
  path: string
  reason?: string
  status: SafeSkillDirectoryRemoveStatus
}

export interface SafeSkillDirectoryRemoveRequest {
  allowedRoots: string[]
  packageName?: string
  path: string
  skillId: string
}

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

export async function removeSkillDirectoryIfSafe(
  request: SafeSkillDirectoryRemoveRequest,
): Promise<SafeSkillDirectoryRemoveResult> {
  const normalizedSkillId = normalizeSkillId(request.skillId)
  const targetPath = path.resolve(request.path)
  const allowedRoots = request.allowedRoots.map((skillRoot) => path.resolve(skillRoot))

  if (path.basename(targetPath) !== normalizedSkillId) {
    return skipped(targetPath, "basename-mismatch")
  }

  if (!allowedRoots.some((allowedRoot) => isPathInside(allowedRoot, targetPath))) {
    return skipped(targetPath, "outside-allowed-roots")
  }

  const targetStat = await lstat(targetPath).catch((error: unknown) => {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return undefined
    }
    throw error
  })
  if (!targetStat) {
    return skipped(targetPath, "missing")
  }
  if (!targetStat.isDirectory() && !targetStat.isSymbolicLink()) {
    return skipped(targetPath, "not-directory")
  }

  if (targetStat.isSymbolicLink() && !(await isRealPathInsideAllowedRoots(targetPath, allowedRoots))) {
    return skipped(targetPath, "symlink-target-outside-allowed-roots")
  }

  const quarantinePath = path.join(
    path.dirname(targetPath),
    `.${path.basename(targetPath)}.remove-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  )
  let quarantined = false

  try {
    await rename(targetPath, quarantinePath)
    quarantined = true

    const quarantinedStat = await lstat(quarantinePath)
    if (!isSameFile(targetStat, quarantinedStat)) {
      await restoreQuarantinedTarget(quarantinePath, targetPath)
      quarantined = false
      return skipped(targetPath, "target-changed")
    }

    const validationSkipReason = await validateQuarantinedSkillRemovalTarget({
      allowedRoots,
      packageName: request.packageName,
      path: quarantinePath,
    })
    if (validationSkipReason) {
      await restoreQuarantinedTarget(quarantinePath, targetPath)
      quarantined = false
      return skipped(targetPath, validationSkipReason)
    }

    await rm(quarantinePath, { force: true, recursive: true })
    quarantined = false
    return {
      path: targetPath,
      status: "removed",
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return skipped(targetPath, "missing")
    }
    if (quarantined) {
      await restoreQuarantinedTarget(quarantinePath, targetPath)
    }
    throw error
  }
}

async function validateQuarantinedSkillRemovalTarget({
  allowedRoots,
  packageName,
  path: targetPath,
}: {
  allowedRoots: string[]
  packageName?: string
  path: string
}): Promise<string | undefined> {
  const targetStat = await lstat(targetPath)
  if (!targetStat.isDirectory() && !targetStat.isSymbolicLink()) {
    return "not-directory"
  }
  if (targetStat.isSymbolicLink() && !(await isRealPathInsideAllowedRoots(targetPath, allowedRoots))) {
    return "symlink-target-outside-allowed-roots"
  }
  const metadata = await readSkillDirectoryMetadata(targetPath)
  const hasSkillDocument = await localPathExists(path.join(targetPath, "SKILL.md"))
  if (!metadata && !hasSkillDocument) {
    return "skill-definition-missing"
  }
  const expectedPackageName = packageName?.trim()
  if (expectedPackageName && metadata?.packageName !== expectedPackageName) {
    return "package-name-mismatch"
  }
  return undefined
}

async function restoreQuarantinedTarget(quarantinePath: string, targetPath: string): Promise<void> {
  await rename(quarantinePath, targetPath)
}

function isSameFile(left: { dev: number; ino: number }, right: { dev: number; ino: number }): boolean {
  return left.dev === right.dev && left.ino === right.ino
}

export async function localPathExists(pathname: string): Promise<boolean> {
  try {
    await access(pathname)
    return true
  } catch {
    return false
  }
}

async function isRealPathInsideAllowedRoots(targetPath: string, allowedRoots: string[]): Promise<boolean> {
  const [targetRealPath, ...rootRealPaths] = await Promise.all([
    realpath(targetPath),
    ...allowedRoots.map((allowedRoot) => realpath(allowedRoot).catch(() => allowedRoot)),
  ])
  return rootRealPaths.some((allowedRoot) => isPathInside(allowedRoot, targetRealPath))
}

async function readSkillDirectoryMetadata(
  targetPath: string,
): Promise<ReturnType<typeof normalizeMetadata> | undefined> {
  try {
    return normalizeMetadata(await readFile(path.join(targetPath, metadataFileName), "utf8"))
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return undefined
    }
    throw error
  }
}

function skipped(pathname: string, reason: string): SafeSkillDirectoryRemoveResult {
  return {
    path: pathname,
    reason,
    status: "skipped",
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
