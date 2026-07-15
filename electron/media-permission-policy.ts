export function isTrustedRendererUrl(
  requestingUrl: string | undefined,
  viteDevServerUrl: string | undefined,
  rendererBaseUrl: string,
): boolean {
  if (!requestingUrl) return false
  if (!viteDevServerUrl) return requestingUrl.startsWith(rendererBaseUrl)
  try {
    return new URL(requestingUrl).origin === new URL(viteDevServerUrl).origin
  } catch {
    return false
  }
}

export function isAudioOnlyMediaRequest(mediaTypes: ReadonlyArray<string> | undefined): boolean {
  return Boolean(mediaTypes?.length && mediaTypes.every((mediaType) => mediaType === "audio"))
}
