function decodeLocalPath(value: string): string {
  try {
    return decodeURIComponent(value.replace(/%2f/giu, "%252F").replace(/%5c/giu, "%255C"))
  } catch {
    return value
  }
}

export function localFilePathFromMessageLink(rawValue: string): string | null {
  const value = rawValue.trim()
  if (!value) {
    return null
  }
  if (/^file:/iu.test(value)) {
    try {
      const url = new URL(value)
      if (url.protocol !== "file:" || (url.hostname && url.hostname !== "localhost")) {
        return null
      }
      const path = decodeLocalPath(url.pathname)
      return /^\/[A-Za-z]:\//u.test(path) ? path.slice(1) : path
    } catch {
      return null
    }
  }
  if (value.startsWith("/") || /^[A-Za-z]:[\\/]/u.test(value) || value.startsWith("\\\\")) {
    return decodeLocalPath(value)
  }
  return null
}
