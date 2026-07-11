import type {
  LocalArtifactPreviewResult,
  LocalArtifactSpreadsheetPreview,
  LocalArtifactSpreadsheetSheetPreview,
} from "./common.ts"

import { readFile } from "node:fs/promises"
import readXlsxFile from "read-excel-file/universal"
import { zipArchiveStats } from "./zip-central-directory.ts"

export const spreadsheetPreviewMaxBytes = 8 * 1024 * 1024
export const spreadsheetPreviewMaxRows = 200
export const spreadsheetPreviewMaxColumns = 50
export const spreadsheetPreviewMaxSheets = 12
export const spreadsheetArchiveMaxEntries = 2_048
export const spreadsheetArchiveMaxUncompressedBytes = 128 * 1024 * 1024
export const spreadsheetArchiveMaxEntryBytes = 64 * 1024 * 1024
export const spreadsheetArchiveMaxCompressionRatio = 200

function bufferArrayBuffer(bytes: Buffer): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer
}

function cellLabel(value: unknown): string {
  if (value === null || value === undefined) {
    return ""
  }
  if (value instanceof Date) {
    return value.toISOString()
  }
  return String(value)
}

interface ParsedSpreadsheetSheet {
  data: unknown[][]
  sheet: string
}

function spreadsheetSheetPreview(sheet: ParsedSpreadsheetSheet): LocalArtifactSpreadsheetSheetPreview {
  const rowCount = sheet.data.length
  const columnCount = Math.max(0, ...sheet.data.map((row) => row.length))
  return {
    name: sheet.sheet,
    columnCount,
    rows: sheet.data
      .slice(0, spreadsheetPreviewMaxRows)
      .map((row) => row.slice(0, spreadsheetPreviewMaxColumns).map(cellLabel)),
    rowCount,
  }
}

export function spreadsheetWorkbookPreview(parsedSheets: ParsedSpreadsheetSheet[]): {
  preview: LocalArtifactSpreadsheetPreview
  truncated: boolean
} {
  const workbook = parsedSheets.slice(0, spreadsheetPreviewMaxSheets).map(spreadsheetSheetPreview)
  const first = workbook[0]
  if (!first) {
    return {
      preview: { activeSheet: "", columnCount: 0, rowCount: 0, rows: [], sheets: [], workbook: [] },
      truncated: false,
    }
  }
  return {
    preview: {
      activeSheet: first.name,
      columnCount: first.columnCount,
      rows: first.rows,
      rowCount: first.rowCount,
      sheets: workbook.map((sheet) => sheet.name),
      workbook,
    },
    truncated:
      parsedSheets.length > workbook.length ||
      workbook.some(
        (sheet) => sheet.rowCount > spreadsheetPreviewMaxRows || sheet.columnCount > spreadsheetPreviewMaxColumns,
      ),
  }
}

export async function spreadsheetPreview(
  filePath: string,
  mime: string,
  size: number,
): Promise<LocalArtifactPreviewResult> {
  if (size > spreadsheetPreviewMaxBytes) {
    return { kind: "unsupported", mime, size, reason: "too_large" }
  }
  const bytes = await readFile(filePath)
  const archive = zipArchiveStats(bytes)
  if (!archive) {
    throw new Error("Invalid XLSX ZIP central directory")
  }
  const compressionRatio = archive.totalUncompressedSize / Math.max(archive.totalCompressedSize, 1)
  if (
    archive.entryCount > spreadsheetArchiveMaxEntries ||
    archive.totalUncompressedSize > spreadsheetArchiveMaxUncompressedBytes ||
    archive.maxEntryUncompressedSize > spreadsheetArchiveMaxEntryBytes ||
    compressionRatio > spreadsheetArchiveMaxCompressionRatio
  ) {
    return { kind: "unsupported", mime, size, reason: "too_large" }
  }
  const parsedSheets = await readXlsxFile(bufferArrayBuffer(bytes), { trim: false })
  const { preview, truncated } = spreadsheetWorkbookPreview(parsedSheets)
  return { kind: "spreadsheet", mime, size, spreadsheet: preview, truncated }
}
