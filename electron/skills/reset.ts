import type { SkillRepairPlanTarget } from "./common.ts"

import { cp, mkdir, rm, stat } from "node:fs/promises"
import path from "node:path"

export async function resetSkillTargets(targets: SkillRepairPlanTarget[]): Promise<void> {
  for (const target of targets) {
    await resetSkillTarget(target)
  }
}

async function resetSkillTarget(target: SkillRepairPlanTarget): Promise<void> {
  assertSafeResetPaths(target.sourcePath, target.currentPath)
  const sourceStat = await stat(target.sourcePath)

  if (!sourceStat.isDirectory()) {
    throw new Error(`Skill source is not a directory: ${target.sourcePath}`)
  }

  await mkdir(path.dirname(target.currentPath), { recursive: true })
  await rm(target.currentPath, { force: true, recursive: true })
  await cp(target.sourcePath, target.currentPath, { recursive: true })
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
