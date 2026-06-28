import type { ChatAttachment, LocalArtifactItem, LocalArtifactPack } from "../../../electron/chat/common.ts"

export type FileVisualKind =
  | "archive"
  | "audio"
  | "code"
  | "directory"
  | "document"
  | "file"
  | "image"
  | "json"
  | "markdown"
  | "pdf"
  | "spreadsheet"
  | "text"
  | "video"
  | "web_page"

export interface FileVisualSource {
  kind?: ChatAttachment["kind"] | LocalArtifactItem["kind"]
  mime: string
  name: string
}

const archiveExtensions = new Set(["7z", "gz", "rar", "tar", "tgz", "zip"])
const codeExtensions = new Set([
  "bash",
  "c",
  "cjs",
  "cpp",
  "css",
  "fish",
  "go",
  "h",
  "htm",
  "html",
  "ini",
  "java",
  "js",
  "jsx",
  "kt",
  "mjs",
  "php",
  "py",
  "rb",
  "rs",
  "sh",
  "sql",
  "swift",
  "toml",
  "ts",
  "tsx",
  "xml",
  "yaml",
  "yml",
  "zsh",
])
const documentExtensions = new Set(["doc", "docx", "ppt", "pptx", "rtf"])
const imageExtensions = new Set(["avif", "bmp", "gif", "jpeg", "jpg", "png", "svg", "webp"])
const markdownExtensions = new Set(["markdown", "md", "mdx"])
const spreadsheetExtensions = new Set(["csv", "tsv", "xls", "xlsx"])
const videoExtensions = new Set(["avi", "m4v", "mkv", "mov", "mp4", "webm"])
const audioExtensions = new Set(["aac", "flac", "m4a", "mp3", "ogg", "wav"])

export function fileNameExtension(name: string): string {
  const lastSegment = name.split(/[\\/]/).pop() ?? name
  const index = lastSegment.lastIndexOf(".")
  return index > -1 ? lastSegment.slice(index + 1).toLowerCase() : ""
}

export function fileVisualKind(source: FileVisualSource | undefined, pack?: LocalArtifactPack | null): FileVisualKind {
  if (!source) {
    return "file"
  }
  const mime = source.mime.toLowerCase()
  const extension = fileNameExtension(source.name)
  if (source.kind === "directory" || mime === "inode/directory") {
    return "directory"
  }
  if ((mime === "text/html" || mime === "application/xhtml+xml") && pack?.kind === "web_page") {
    return "web_page"
  }
  if (mime === "application/pdf" || extension === "pdf") {
    return "pdf"
  }
  if (mime.startsWith("image/") || imageExtensions.has(extension)) {
    return "image"
  }
  if (mime.startsWith("video/") || videoExtensions.has(extension)) {
    return "video"
  }
  if (mime.startsWith("audio/") || audioExtensions.has(extension)) {
    return "audio"
  }
  if (archiveExtensions.has(extension) || ["application/gzip", "application/x-tar", "application/zip"].includes(mime)) {
    return "archive"
  }
  if (
    spreadsheetExtensions.has(extension) ||
    ["application/vnd.ms-excel", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"].includes(mime)
  ) {
    return "spreadsheet"
  }
  if (
    documentExtensions.has(extension) ||
    [
      "application/msword",
      "application/rtf",
      "application/vnd.ms-powerpoint",
      "application/vnd.openxmlformats-officedocument.presentationml.presentation",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "text/rtf",
    ].includes(mime)
  ) {
    return "document"
  }
  if (markdownExtensions.has(extension) || mime === "text/markdown") {
    return "markdown"
  }
  if (extension === "json" || mime === "application/json") {
    return "json"
  }
  if (codeExtensions.has(extension) || ["application/javascript", "application/x-javascript"].includes(mime)) {
    return "code"
  }
  if (mime.startsWith("text/")) {
    return "text"
  }
  return "file"
}
