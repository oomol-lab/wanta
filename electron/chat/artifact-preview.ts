import type { LocalArtifactArchiveEntry, LocalArtifactPreviewResult } from "./common.ts"

import JSZip from "jszip"
import { readFile } from "node:fs/promises"
import { list as listTar } from "tar"
import { spreadsheetPreviewFormat } from "./spreadsheet-preview.ts"
export {
  delimitedSpreadsheetPreview,
  spreadsheetPreview,
  spreadsheetPreviewMaxBytes,
  spreadsheetPreviewMaxColumns,
  spreadsheetPreviewMaxRows,
  spreadsheetPreviewMaxSheets,
  spreadsheetPreviewFormat,
  spreadsheetWorkbookPreview,
} from "./spreadsheet-preview.ts"

export const richPreviewMaxBytes = 16 * 1024 * 1024
export const archivePreviewMaxEntries = 300

function fileNameFromPath(filePath: string): string {
  return filePath.split(/[\\/]/).pop() ?? filePath
}

function extensionFromPath(filePath: string): string {
  const name = fileNameFromPath(filePath)
  const index = name.lastIndexOf(".")
  return index >= 0 ? name.slice(index).toLowerCase() : ""
}

function dataUrl(mime: string, bytes: Buffer): string {
  return `data:${mime};base64,${bytes.toString("base64")}`
}

export function isPdfArtifact(filePath: string, mime: string): boolean {
  return mime.toLowerCase() === "application/pdf" || extensionFromPath(filePath) === ".pdf"
}

export function isDocxArtifact(filePath: string, mime: string): boolean {
  return (
    mime.toLowerCase() === "application/vnd.openxmlformats-officedocument.wordprocessingml.document" ||
    extensionFromPath(filePath) === ".docx"
  )
}

export function isXlsxArtifact(filePath: string, mime: string): boolean {
  return spreadsheetPreviewFormat(filePath, mime) === "xlsx"
}

export function isSpreadsheetPreviewArtifact(filePath: string, mime: string): boolean {
  return spreadsheetPreviewFormat(filePath, mime) !== null
}

export function isRtfArtifact(filePath: string, mime: string): boolean {
  const normalized = mime.toLowerCase()
  return normalized === "application/rtf" || normalized === "text/rtf" || extensionFromPath(filePath) === ".rtf"
}

export function archiveFormatFromPath(filePath: string, mime: string): "tar" | "zip" | null {
  const name = fileNameFromPath(filePath).toLowerCase()
  const extension = extensionFromPath(filePath)
  const normalized = mime.toLowerCase()
  if (extension === ".zip" || normalized === "application/zip") {
    return "zip"
  }
  if (
    extension === ".tar" ||
    extension === ".tgz" ||
    name.endsWith(".tar.gz") ||
    ["application/x-gtar", "application/x-tar"].includes(normalized)
  ) {
    return "tar"
  }
  return null
}

export function isBinaryDataPreviewArtifact(filePath: string, mime: string): boolean {
  return isPdfArtifact(filePath, mime) || isDocxArtifact(filePath, mime)
}

export function binaryDataPreview(
  filePath: string,
  mime: string,
  size: number,
  bytes: Buffer,
): LocalArtifactPreviewResult | null {
  if (isPdfArtifact(filePath, mime)) {
    return { kind: "pdf", mime, size, dataUrl: dataUrl(mime, bytes) }
  }
  if (isDocxArtifact(filePath, mime)) {
    return { kind: "document", mime, size, documentFormat: "docx", dataUrl: dataUrl(mime, bytes) }
  }
  return null
}

export async function zipPreviewFromBytes(
  bytes: Buffer,
  mime: string,
  size: number,
): Promise<LocalArtifactPreviewResult> {
  const zip = await JSZip.loadAsync(bytes)
  const files = Object.values(zip.files)
  const entries: LocalArtifactArchiveEntry[] = []
  for (const entry of files) {
    if (entries.length >= archivePreviewMaxEntries) {
      break
    }
    entries.push({
      kind: entry.dir ? "directory" : "file",
      modifiedAt: entry.date?.getTime(),
      path: entry.name,
    })
  }
  return {
    kind: "archive",
    mime,
    size,
    archive: { entries, format: "zip", totalEntries: files.length },
    truncated: files.length > entries.length,
  }
}

async function zipPreview(filePath: string, mime: string, size: number): Promise<LocalArtifactPreviewResult> {
  return zipPreviewFromBytes(await readFile(filePath), mime, size)
}

function tarEntryKind(type: string): "directory" | "file" {
  return type === "Directory" ? "directory" : "file"
}

async function tarPreview(filePath: string, mime: string, size: number): Promise<LocalArtifactPreviewResult> {
  const entries: LocalArtifactArchiveEntry[] = []
  let totalEntries = 0
  await listTar({
    file: filePath,
    onentry(entry) {
      totalEntries += 1
      if (entries.length >= archivePreviewMaxEntries) {
        return
      }
      entries.push({
        kind: tarEntryKind(entry.type),
        modifiedAt: entry.mtime?.getTime(),
        path: entry.path,
        size: entry.size,
      })
    },
  })
  return {
    kind: "archive",
    mime,
    size,
    archive: { entries, format: "tar", totalEntries },
    truncated: totalEntries > entries.length,
  }
}

export async function archivePreview(
  filePath: string,
  mime: string,
  size: number,
): Promise<LocalArtifactPreviewResult | null> {
  const format = archiveFormatFromPath(filePath, mime)
  if (!format) {
    return null
  }
  return format === "zip" ? zipPreview(filePath, mime, size) : tarPreview(filePath, mime, size)
}

function decodeRtfHex(value: string): string {
  return String.fromCharCode(Number.parseInt(value.slice(2), 16))
}

export function rtfToPlainText(source: string): string {
  return source
    .replace(/\\'[0-9a-fA-F]{2}/g, decodeRtfHex)
    .replace(/\\u(-?\d+)\??/g, (_match, value: string) => {
      const code = Number.parseInt(value, 10)
      return Number.isFinite(code) ? String.fromCharCode(code < 0 ? code + 65536 : code) : ""
    })
    .replace(/\\(?:par|line)\b ?/g, "\n")
    .replace(/\\tab\b ?/g, "\t")
    .replace(/\\emdash\b ?/g, "-")
    .replace(/\\endash\b ?/g, "-")
    .replace(/\\bullet\b ?/g, "*")
    .replace(/\{\\(?:fonttbl|colortbl|stylesheet|info|pict|object)[\s\S]*?\}/g, "")
    .replace(/\\[a-zA-Z]+-?\d* ?/g, "")
    .replace(/\\[{}\\]/g, "")
    .replace(/[{}]/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
}
