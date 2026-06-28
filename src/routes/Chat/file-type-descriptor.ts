import type { LocalArtifactPack } from "../../../electron/chat/common.ts"
import type { FileVisualKind, FileVisualSource } from "./file-type-kind.ts"

import { fileNameExtension, fileVisualKind } from "./file-type-kind.ts"

export type FileIconTone = FileVisualKind | "presentation"

export type FileIconKey =
  | "archive"
  | "audio"
  | "bmp"
  | "code"
  | "css"
  | "csv"
  | "directory"
  | "doc"
  | "docx"
  | "file"
  | "html"
  | "image"
  | "js"
  | "jpg"
  | "json"
  | "jsx"
  | "markdown"
  | "pdf"
  | "php"
  | "png"
  | "ppt"
  | "rs"
  | "spreadsheet"
  | "sql"
  | "svg"
  | "text"
  | "ts"
  | "tsx"
  | "txt"
  | "video"
  | "vue"
  | "web_page"
  | "xls"
  | "xml"
  | "zip"

export interface FileTypeDescriptor {
  iconKey: FileIconKey
  tone: FileIconTone
  visualKind: FileVisualKind
}

const extensionIconEntries = [
  ["bmp", "bmp", "image"],
  ["css", "css", "code"],
  ["csv", "csv", "spreadsheet"],
  ["doc", "doc", "document"],
  ["docx", "docx", "document"],
  ["htm", "html", "code"],
  ["html", "html", "code"],
  ["jpeg", "jpg", "image"],
  ["jpg", "jpg", "image"],
  ["js", "js", "code"],
  ["jsx", "jsx", "code"],
  ["md", "markdown", "markdown"],
  ["markdown", "markdown", "markdown"],
  ["mdx", "markdown", "markdown"],
  ["pdf", "pdf", "pdf"],
  ["php", "php", "code"],
  ["png", "png", "image"],
  ["ppt", "ppt", "presentation"],
  ["pptx", "ppt", "presentation"],
  ["rs", "rs", "code"],
  ["sql", "sql", "code"],
  ["svg", "svg", "image"],
  ["ts", "ts", "code"],
  ["tsx", "tsx", "code"],
  ["txt", "txt", "text"],
  ["vue", "vue", "code"],
  ["xls", "xls", "spreadsheet"],
  ["xlsx", "xls", "spreadsheet"],
  ["xml", "xml", "code"],
  ["zip", "zip", "archive"],
] as const satisfies readonly (readonly [string, FileIconKey, FileIconTone])[]

const extensionIcons = new Map<string, { iconKey: FileIconKey; tone: FileIconTone }>(
  extensionIconEntries.map(([extension, iconKey, tone]) => [extension, { iconKey, tone }]),
)

const mimeIcons = new Map<string, { iconKey: FileIconKey; tone: FileIconTone }>([
  ["application/json", { iconKey: "json", tone: "json" }],
  ["application/msword", { iconKey: "doc", tone: "document" }],
  ["application/pdf", { iconKey: "pdf", tone: "pdf" }],
  ["application/rtf", { iconKey: "doc", tone: "document" }],
  ["application/vnd.ms-excel", { iconKey: "xls", tone: "spreadsheet" }],
  ["application/vnd.ms-powerpoint", { iconKey: "ppt", tone: "presentation" }],
  [
    "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    { iconKey: "ppt", tone: "presentation" },
  ],
  ["application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", { iconKey: "xls", tone: "spreadsheet" }],
  ["application/vnd.openxmlformats-officedocument.wordprocessingml.document", { iconKey: "docx", tone: "document" }],
  ["application/xml", { iconKey: "xml", tone: "code" }],
  ["application/zip", { iconKey: "zip", tone: "archive" }],
  ["text/csv", { iconKey: "csv", tone: "spreadsheet" }],
  ["text/html", { iconKey: "html", tone: "code" }],
  ["text/markdown", { iconKey: "markdown", tone: "markdown" }],
  ["text/plain", { iconKey: "txt", tone: "text" }],
  ["text/rtf", { iconKey: "doc", tone: "document" }],
  ["text/tab-separated-values", { iconKey: "csv", tone: "spreadsheet" }],
  ["text/xml", { iconKey: "xml", tone: "code" }],
])

export function fileTypeDescriptor(
  source: FileVisualSource | undefined,
  pack?: LocalArtifactPack | null,
): FileTypeDescriptor {
  const visualKind = fileVisualKind(source, pack)
  if (!source) {
    return { iconKey: "file", tone: "file", visualKind }
  }
  if (visualKind === "directory") {
    return { iconKey: "directory", tone: "directory", visualKind }
  }
  if (visualKind === "web_page") {
    return { iconKey: "web_page", tone: "web_page", visualKind }
  }

  const extensionMatch = extensionIcons.get(fileNameExtension(source.name))
  if (extensionMatch) {
    return { ...extensionMatch, visualKind }
  }

  const mime = source.mime.toLowerCase()
  const mimeMatch = mimeIcons.get(mime)
  if (mimeMatch) {
    return { ...mimeMatch, visualKind }
  }
  if (mime.startsWith("image/")) {
    return { iconKey: "image", tone: "image", visualKind }
  }
  if (mime.startsWith("video/")) {
    return { iconKey: "video", tone: "video", visualKind }
  }
  if (mime.startsWith("audio/")) {
    return { iconKey: "audio", tone: "audio", visualKind }
  }

  switch (visualKind) {
    case "archive":
      return { iconKey: "archive", tone: "archive", visualKind }
    case "audio":
      return { iconKey: "audio", tone: "audio", visualKind }
    case "code":
      return { iconKey: "code", tone: "code", visualKind }
    case "document":
      return { iconKey: "doc", tone: "document", visualKind }
    case "image":
      return { iconKey: "image", tone: "image", visualKind }
    case "json":
      return { iconKey: "json", tone: "json", visualKind }
    case "markdown":
      return { iconKey: "markdown", tone: "markdown", visualKind }
    case "pdf":
      return { iconKey: "pdf", tone: "pdf", visualKind }
    case "spreadsheet":
      return { iconKey: "spreadsheet", tone: "spreadsheet", visualKind }
    case "text":
      return { iconKey: "text", tone: "text", visualKind }
    case "video":
      return { iconKey: "video", tone: "video", visualKind }
    default:
      return { iconKey: "file", tone: "file", visualKind }
  }
}
