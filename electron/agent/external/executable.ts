import path from "node:path"

export function externalExecutableNeedsShell(
  executablePath: string,
  platform: NodeJS.Platform = process.platform,
): boolean {
  if (platform !== "win32") {
    return false
  }
  const extension = path.win32.extname(executablePath).toLowerCase()
  return extension === ".cmd" || extension === ".bat"
}
