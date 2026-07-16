import { open } from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"

const mimeSniffMaxBytes = 8 * 1024

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
    case "tsv":
      return "text/tab-separated-values"
    case "htm":
    case "html":
      return "text/html"
    case "bash":
    case "c":
    case "cc":
    case "cjs":
    case "cpp":
    case "cs":
    case "css":
    case "cxx":
    case "dart":
    case "fish":
    case "go":
    case "h":
    case "hpp":
    case "java":
    case "js":
    case "jsx":
    case "kt":
    case "kts":
    case "less":
    case "lua":
    case "mjs":
    case "php":
    case "pl":
    case "py":
    case "r":
    case "rb":
    case "rs":
    case "sass":
    case "scala":
    case "scss":
    case "sh":
    case "svelte":
    case "swift":
    case "ts":
    case "tsx":
    case "vue":
    case "zsh":
      return "text/plain"
    case "json":
      return "application/json"
    case "jsonl":
      return "application/x-ndjson"
    case "md":
      return "text/markdown"
    case "xml":
      return "application/xml"
    case "yaml":
    case "yml":
      return "application/yaml"
    case "toml":
      return "application/toml"
    case "cfg":
    case "conf":
    case "env":
    case "ini":
    case "log":
    case "properties":
    case "sql":
      return "text/plain"
    case "pdf":
      return "application/pdf"
    case "doc":
      return "application/msword"
    case "docx":
      return "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
    case "ppt":
      return "application/vnd.ms-powerpoint"
    case "pptx":
      return "application/vnd.openxmlformats-officedocument.presentationml.presentation"
    case "rtf":
      return "application/rtf"
    case "aac":
      return "audio/aac"
    case "flac":
      return "audio/flac"
    case "m4a":
      return "audio/mp4"
    case "mp3":
      return "audio/mpeg"
    case "oga":
    case "ogg":
      return "audio/ogg"
    case "wav":
      return "audio/wav"
    case "webm":
      return "video/webm"
    case "m4v":
      return "video/mp4"
    case "mov":
      return "video/quicktime"
    case "mp4":
      return "video/mp4"
    case "txt":
      return "text/plain"
    case "gz":
      return "application/gzip"
    case "tar":
      return "application/x-tar"
    case "tgz":
      return "application/gzip"
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

function isLikelyUtf8Text(bytes: Buffer): boolean {
  if (bytes.length === 0) return true
  if (bytes.includes(0)) return false
  let text: string
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes)
  } catch {
    return false
  }
  let controls = 0
  for (const char of text) {
    const code = char.codePointAt(0) ?? 0
    if (code < 32 && code !== 9 && code !== 10 && code !== 13) controls += 1
  }
  return controls <= Math.max(1, Math.floor(text.length * 0.01))
}

export async function mimeFromFile(filePath: string, size?: number): Promise<string> {
  const mapped = mimeFromPath(filePath)
  if (mapped !== "application/octet-stream") return mapped
  const file = await open(filePath, "r")
  try {
    const sampleSize = Math.min(mimeSniffMaxBytes, Math.max(0, size ?? mimeSniffMaxBytes))
    const bytes = Buffer.alloc(sampleSize)
    const { bytesRead } = await file.read(bytes, 0, sampleSize, 0)
    return isLikelyUtf8Text(bytes.subarray(0, bytesRead)) ? "text/plain" : mapped
  } finally {
    await file.close()
  }
}

function stripCandidate(value: string): string {
  let next = value.trim()
  while (/[，。；：、,;:!?)]$/.test(next)) {
    next = next.slice(0, -1)
  }
  return next
}

function isRootOnlyCandidate(value: string): boolean {
  const candidate = stripCandidate(value)
  return (
    /^\/+$/.test(candidate) ||
    /^~[\\/]*$/.test(candidate) ||
    /^[A-Za-z]:[\\/]*$/.test(candidate) ||
    /^file:\/\/\/?$/i.test(candidate)
  )
}

function isRootLocalPath(filePath: string): boolean {
  if (/^[A-Za-z]:[\\/]*$/.test(filePath)) {
    return true
  }
  const resolved = path.resolve(filePath)
  return resolved === path.parse(resolved).root
}

export function normalizeLocalPathCandidate(candidate: string, homeDir: string): string | null {
  if (isRootOnlyCandidate(candidate)) {
    return null
  }
  if (candidate.startsWith("file://")) {
    try {
      const filePath = fileURLToPath(candidate)
      return isRootLocalPath(filePath) ? null : filePath
    } catch {
      return null
    }
  }
  if (candidate === "~") {
    return null
  }
  if (candidate.startsWith("~/") || candidate.startsWith("~\\")) {
    const filePath = path.join(homeDir, candidate.slice(2))
    return isRootLocalPath(filePath) ? null : filePath
  }
  if (path.isAbsolute(candidate) || /^[A-Za-z]:[\\/]/.test(candidate)) {
    return isRootLocalPath(candidate) ? null : candidate
  }
  return null
}
