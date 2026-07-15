import path from "node:path"
import { fileURLToPath } from "node:url"

export function isTrustedRendererUrl(
  requestingUrl: string | undefined,
  viteDevServerUrl: string | undefined,
  rendererBaseUrl: string,
): boolean {
  if (!requestingUrl) return false
  if (!viteDevServerUrl) return isFileUrlInsideDirectory(requestingUrl, rendererBaseUrl)
  try {
    return new URL(requestingUrl).origin === new URL(viteDevServerUrl).origin
  } catch {
    return false
  }
}

function isFileUrlInsideDirectory(requestingUrl: string, rendererBaseUrl: string): boolean {
  try {
    const requested = new URL(requestingUrl)
    const rendererBase = new URL(rendererBaseUrl)
    if (requested.protocol !== "file:" || rendererBase.protocol !== "file:") return false
    const relativePath = path.relative(fileURLToPath(rendererBase), fileURLToPath(requested))
    return (
      relativePath === "" ||
      (!relativePath.startsWith(`..${path.sep}`) && relativePath !== ".." && !path.isAbsolute(relativePath))
    )
  } catch {
    return false
  }
}

export function isAudioOnlyMediaRequest(mediaTypes: ReadonlyArray<string> | undefined): boolean {
  return Boolean(mediaTypes?.length && mediaTypes.every((mediaType) => mediaType === "audio"))
}
