import path from "node:path"
import { fileURLToPath } from "node:url"

export function imageMimeFromPath(filePath: string): string | null {
  const extension = filePath.split(/[\\/]/).pop()?.split(".").pop()?.toLowerCase()
  switch (extension) {
    case "avif":
      return "image/avif"
    case "bmp":
      return "image/bmp"
    case "gif":
      return "image/gif"
    case "jpg":
    case "jpeg":
      return "image/jpeg"
    case "png":
      return "image/png"
    case "svg":
      return "image/svg+xml"
    case "webp":
      return "image/webp"
    default:
      return null
  }
}

export function mimeFromPath(filePath: string): string {
  const imageMime = imageMimeFromPath(filePath)
  if (imageMime) {
    return imageMime
  }
  const extension = filePath.split(/[\\/]/).pop()?.split(".").pop()?.toLowerCase()
  switch (extension) {
    case "csv":
      return "text/csv"
    case "htm":
    case "html":
      return "text/html"
    case "json":
      return "application/json"
    case "md":
      return "text/markdown"
    case "pdf":
      return "application/pdf"
    case "txt":
      return "text/plain"
    case "xls":
      return "application/vnd.ms-excel"
    case "xlsx":
      return "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    case "zip":
      return "application/zip"
    default:
      return "application/octet-stream"
  }
}

function stripCandidate(value: string): string {
  let next = value.trim()
  while (/[，。；：、,;:!?)]$/.test(next)) {
    next = next.slice(0, -1)
  }
  return next
}

function pushCandidate(candidates: string[], value: string): void {
  const candidate = stripCandidate(value)
  if (!candidate || candidates.includes(candidate)) {
    return
  }
  candidates.push(candidate)
}

export function extractLocalPathCandidates(text: string): string[] {
  const candidates: string[] = []
  const codePattern = /`([^`]+)`/g
  for (const match of text.matchAll(codePattern)) {
    const value = match[1]?.trim()
    if (value && (/^(?:file:\/\/|~?\/)/.test(value) || /^[A-Za-z]:[\\/]/.test(value))) {
      pushCandidate(candidates, value)
    }
  }

  const plainPattern =
    /(?:file:\/\/[^\s<>"'`，。；：、]+|[A-Za-z]:[\\/][^<>"'`，。；：、\r\n]*\.[A-Za-z0-9]{1,16}(?=$|[\s<>"'`，。；：、,;:!?.)])|[A-Za-z]:[\\/][^\s<>"'`，。；：、]+|~?\/[^\s<>"'`，。；：、]+)/g
  for (const match of text.matchAll(plainPattern)) {
    pushCandidate(candidates, match[0])
  }
  return candidates
}

export function normalizeLocalPathCandidate(candidate: string, homeDir: string): string | null {
  if (candidate.startsWith("file://")) {
    try {
      return fileURLToPath(candidate)
    } catch {
      return null
    }
  }
  if (candidate === "~") {
    return homeDir
  }
  if (candidate.startsWith("~/") || candidate.startsWith("~\\")) {
    return path.join(homeDir, candidate.slice(2))
  }
  if (path.isAbsolute(candidate) || /^[A-Za-z]:[\\/]/.test(candidate)) {
    return candidate
  }
  return null
}
