import path from "node:path"

/** WikiGraph CLI 使用自有 wikg URI；路径由 execFile 独立传参，不做 URL 百分号编码。 */
export function knowledgeArchiveUri(filePath: string, platform: NodeJS.Platform = process.platform): string {
  if (platform === "win32") {
    const absolute = path.win32.resolve(filePath).replaceAll("\\", "/")
    return `wikg://${absolute}`
  }
  const absolute = path.posix.resolve(filePath)
  return `wikg://${absolute}`
}

export function knowledgeObjectUri(archiveUri: string, objectPath: string): string {
  const normalized = objectPath
    .trim()
    .replace(/^wikg:\/\//u, "")
    .replace(/^\/+|\/+$/gu, "")
  if (!normalized || normalized.includes("..") || !/^(chapter|entity|triple)(\/|$)/u.test(normalized)) {
    throw new Error("Unsupported WikiGraph object URI")
  }
  return `${archiveUri}/${normalized}`
}
