import type { SkillRepairPlanTarget } from "./common.ts"

import { cp, mkdir, realpath, rm, stat } from "node:fs/promises"
import path from "node:path"

export async function resetSkillTargets(targets: SkillRepairPlanTarget[]): Promise<void> {
  for (const target of targets) {
    await resetSkillTarget(target)
  }
}

async function resetSkillTarget(target: SkillRepairPlanTarget): Promise<void> {
  assertSafeResetPaths(target.sourcePath, target.currentPath)
  const [canonicalSourcePath, canonicalCurrentPath] = await Promise.all([
    resolveExistingPath(target.sourcePath),
    resolveExistingPath(target.currentPath),
  ])
  assertSafeResetPaths(canonicalSourcePath, canonicalCurrentPath)
  const sourceStat = await stat(canonicalSourcePath)

  if (!sourceStat.isDirectory()) {
    throw new Error(`Skill source is not a directory: ${canonicalSourcePath}`)
  }

  await mkdir(path.dirname(canonicalCurrentPath), { recursive: true })
  await rm(canonicalCurrentPath, { force: true, recursive: true })
  await cp(canonicalSourcePath, canonicalCurrentPath, { recursive: true })
}

async function resolveExistingPath(pathname: string): Promise<string> {
  return realpath(pathname).catch(() => path.resolve(pathname))
}

export function assertSafeResetPaths(sourcePath: string, currentPath: string): void {
  const resolvedSourcePath = path.resolve(sourcePath)
  const resolvedCurrentPath = path.resolve(currentPath)

  if (resolvedSourcePath === resolvedCurrentPath) {
    throw new Error("Skill source and target paths are the same.")
  }

  if (isPathInside(resolvedSourcePath, resolvedCurrentPath) || isPathInside(resolvedCurrentPath, resolvedSourcePath)) {
    throw new Error("Skill source and target paths must not contain each other.")
  }

  if (resolvedCurrentPath === path.parse(resolvedCurrentPath).root) {
    throw new Error("Refusing to reset a filesystem root path.")
  }
}

function isPathInside(candidatePath: string, parentPath: string): boolean {
  const relativePath = path.relative(parentPath, candidatePath)
  return relativePath !== "" && !relativePath.startsWith("..") && !path.isAbsolute(relativePath)
}
