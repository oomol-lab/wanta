const iconTokenPattern = /^:[a-z0-9-]+:[^/?#]+:?$/i

export function normalizeSkillIconSource(icon: string | undefined): string | undefined {
  const value = icon?.trim()

  if (!value) {
    return undefined
  }

  return extractPackageAssetIconToken(value) ?? value
}

function extractPackageAssetIconToken(value: string): string | undefined {
  let url: URL

  try {
    url = new URL(value)
  } catch {
    return undefined
  }

  if (url.protocol !== "https:" && url.protocol !== "http:") {
    return undefined
  }

  const lastSegment = url.pathname.split("/").filter(Boolean).at(-1)

  if (!lastSegment) {
    return undefined
  }

  const decodedSegment = decodeUrlPathSegment(lastSegment)

  if (!iconTokenPattern.test(decodedSegment)) {
    return undefined
  }

  return decodedSegment
}

function decodeUrlPathSegment(value: string): string {
  try {
    return decodeURIComponent(value)
  } catch {
    return value
  }
}
