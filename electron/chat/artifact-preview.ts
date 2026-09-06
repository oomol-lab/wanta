import type { LocalArtifactPreviewResult } from "./common.ts"

export {
  archiveFormatFromPath,
  archivePreview,
  archivePreviewMaxBytes,
  archivePreviewMaxEntries,
  zipPreviewFromBytes,
} from "./archive-preview.ts"
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
