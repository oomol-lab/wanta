import path from "node:path"

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
