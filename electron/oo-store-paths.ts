import os from "node:os"
import path from "node:path"

export function resolveOoStoreDirectory(
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
  homeDirectory = os.homedir(),
): string {
  const platformPath = platform === "win32" ? path.win32 : path.posix
  if (!platformPath.isAbsolute(homeDirectory)) {
    throw new Error("homeDirectory must be an absolute path")
  }

  const xdgConfigHome = env["XDG_CONFIG_HOME"]?.trim()
  if (xdgConfigHome) {
    if (!platformPath.isAbsolute(xdgConfigHome)) {
      throw new Error("XDG_CONFIG_HOME must be an absolute path")
    }
    return platformPath.join(xdgConfigHome, "oo")
  }

  if (platform === "darwin") {
    return platformPath.join(homeDirectory, "Library", "Application Support", "oo")
  }

  if (platform === "win32") {
    const appData = env["APPDATA"]?.trim()
    if (appData && !platformPath.isAbsolute(appData)) {
      throw new Error("APPDATA must be an absolute path")
    }
    return platformPath.join(appData || platformPath.join(homeDirectory, "AppData", "Roaming"), "oo")
  }

  return platformPath.join(homeDirectory, ".config", "oo")
}
