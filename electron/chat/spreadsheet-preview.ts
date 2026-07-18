import type {
  LocalArtifactPreviewResult,
  LocalArtifactSpreadsheetPreview,
  LocalArtifactSpreadsheetSheetPreview,
} from "./common.ts"

import { open, readFile } from "node:fs/promises"
import readXlsxFile from "read-excel-file/universal"
import { isEmptyInlineStringParseFailure, normalizeExcelCraftWorkbook } from "./spreadsheet-excel-craft-compat.ts"
import { zipArchiveStats, zipArchiveWithinLimits } from "./zip-central-directory.ts"

export const spreadsheetPreviewMaxBytes = 8 * 1024 * 1024
export const spreadsheetPreviewMaxRows = 200
export const spreadsheetPreviewMaxColumns = 50
export const spreadsheetPreviewMaxSheets = 12
export const spreadsheetArchiveMaxEntries = 2_048
export const spreadsheetArchiveMaxUncompressedBytes = 128 * 1024 * 1024
export const spreadsheetArchiveMaxEntryBytes = 64 * 1024 * 1024
export const spreadsheetArchiveMaxCompressionRatio = 200
export const delimitedSpreadsheetPreviewMaxBytes = 512 * 1024

export type SpreadsheetPreviewFormat = "csv" | "tsv" | "xlsx"

function extensionFromPath(filePath: string): string {
  const fileName = filePath.split(/[\\/]/).pop() ?? filePath
  const index = fileName.lastIndexOf(".")
  return index >= 0 ? fileName.slice(index).toLowerCase() : ""
}

export function spreadsheetPreviewFormat(filePath: string, mime: string): SpreadsheetPreviewFormat | null {
  const extension = extensionFromPath(filePath)
  if (extension === ".csv") return "csv"
  if (extension === ".tsv") return "tsv"
  if (extension === ".xlsx") return "xlsx"

  switch (mime.toLowerCase()) {
    case "text/csv":
      return "csv"
    case "text/tab-separated-values":
      return "tsv"
    case "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet":
      return "xlsx"
    default:
      return null
  }
}

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

export interface DelimitedSpreadsheetPreviewOptions {
  maxColumns?: number
  maxRows?: number
  sheetName?: string
  sourceTruncated?: boolean
}

/**
 * 按 CSV 兼容的引号规则解析 CSV/TSV，并在解析阶段直接限制二维数据大小。
 * 超出列上限的字段不再积累字符串，避免单行超宽文件制造无界内存开销。
 */
export function delimitedSpreadsheetPreview(
  source: string,
  delimiter: "," | "\t",
  options: DelimitedSpreadsheetPreviewOptions = {},
): { preview: LocalArtifactSpreadsheetPreview; truncated: boolean } {
  const maxColumns = Math.max(1, options.maxColumns ?? spreadsheetPreviewMaxColumns)
  const maxRows = Math.max(1, options.maxRows ?? spreadsheetPreviewMaxRows)
  const rows: string[][] = []
  let row: string[] = []
  let field = ""
  let fieldCount = 0
  let fieldStarted = false
  let inQuotes = false
  let endedWithRowSeparator = false
  let stoppedAtRowLimit = false
  let truncated = options.sourceTruncated ?? false

  const shouldCollectField = (): boolean => fieldCount < maxColumns
  const pushField = (): void => {
    if (shouldCollectField()) {
      row.push(field)
    } else {
      truncated = true
    }
    field = ""
    fieldCount += 1
    fieldStarted = false
  }
  const pushRow = (): boolean => {
    pushField()
    if (rows.length >= maxRows) {
      truncated = true
      stoppedAtRowLimit = true
      return false
    }
    rows.push(row)
    row = []
    fieldCount = 0
    endedWithRowSeparator = true
    return true
  }

  const text = source.startsWith("\uFEFF") ? source.slice(1) : source
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index]
    endedWithRowSeparator = false
    if (inQuotes) {
      if (char === '"') {
        if (text[index + 1] === '"') {
          if (shouldCollectField()) field += '"'
          index += 1
        } else {
          inQuotes = false
        }
      } else if (shouldCollectField()) {
        field += char
      }
      continue
    }

    if (char === '"' && !fieldStarted) {
      inQuotes = true
      fieldStarted = true
      continue
    }
    if (char === delimiter) {
      pushField()
      continue
    }
    if (char === "\r" || char === "\n") {
      if (char === "\r" && text[index + 1] === "\n") index += 1
      if (!pushRow()) break
      continue
    }
    if (shouldCollectField()) field += char
    fieldStarted = true
  }

  if (!stoppedAtRowLimit && !endedWithRowSeparator && (fieldStarted || fieldCount > 0 || inQuotes)) {
    pushRow()
  }

  const name = options.sheetName?.trim() || "Sheet 1"
  const columnCount = Math.max(0, ...rows.map((currentRow) => currentRow.length))
  const sheet: LocalArtifactSpreadsheetSheetPreview = {
    columnCount,
    name,
    rowCount: rows.length,
    rows,
  }
  return {
    preview: {
      activeSheet: name,
      columnCount,
      rowCount: rows.length,
      rows,
      sheets: [name],
      workbook: [sheet],
    },
    truncated,
  }
}

function delimitedSheetName(filePath: string): string {
  const fileName = filePath.split(/[\\/]/).pop() ?? ""
  const extension = extensionFromPath(fileName)
  const stem = extension ? fileName.slice(0, -extension.length) : fileName
  // 工作表名称遵循 Excel 的 31 字符及非法字符约束，避免后续导出或复制时产生坏名称。
  return (
    stem
      .replace(/[\\/?*:[\]]/g, " ")
      .trim()
      .slice(0, 31) || "Sheet 1"
  )
}

async function delimitedFilePreview(
  filePath: string,
  mime: string,
  size: number,
  delimiter: "," | "\t",
): Promise<LocalArtifactPreviewResult> {
  const length = Math.min(size, delimitedSpreadsheetPreviewMaxBytes)
  let bytes = Buffer.alloc(0)
  if (length > 0) {
    const file = await open(filePath, "r")
    try {
      bytes = Buffer.alloc(length)
      const { bytesRead } = await file.read(bytes, 0, length, 0)
      bytes = bytes.subarray(0, bytesRead)
    } finally {
      await file.close()
    }
  }
  if (bytes.includes(0)) {
    throw new Error("Delimited spreadsheet contains binary data")
  }
  const { preview, truncated } = delimitedSpreadsheetPreview(bytes.toString("utf8"), delimiter, {
    sheetName: delimitedSheetName(filePath),
    sourceTruncated: size > bytes.byteLength,
  })
  return { kind: "spreadsheet", mime, size, spreadsheet: preview, truncated }
}

async function parseSpreadsheet(bytes: Buffer): Promise<ParsedSpreadsheetSheet[]> {
  try {
    return await readXlsxFile(bufferArrayBuffer(bytes), { trim: false })
  } catch (error) {
    if (!isEmptyInlineStringParseFailure(error)) {
      throw error
    }
    // Excel Craft 使用的 Openpyxl 会把带样式的空 inlineStr 单元格解释为空值。
    // 仅在上游解析器命中同一兼容性缺口时规范化工作表 XML，保留正常文件的快速路径。
    const normalized = await normalizeExcelCraftWorkbook(bytes)
    if (!normalized) {
      throw error
    }
    return readXlsxFile(bufferArrayBuffer(normalized), { trim: false })
  }
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
  const format = spreadsheetPreviewFormat(filePath, mime)
  if (format === "csv" || format === "tsv") {
    return delimitedFilePreview(filePath, mime, size, format === "csv" ? "," : "\t")
  }
  if (format !== "xlsx") {
    return { kind: "unsupported", mime, size, reason: "unsupported_type" }
  }
  if (size > spreadsheetPreviewMaxBytes) {
    return { kind: "unsupported", mime, size, reason: "too_large" }
  }
  const bytes = await readFile(filePath)
  const archive = zipArchiveStats(bytes)
  if (!archive) {
    throw new Error("Invalid XLSX ZIP central directory")
  }
  if (
    !zipArchiveWithinLimits(archive, {
      maxCompressionRatio: spreadsheetArchiveMaxCompressionRatio,
      maxEntries: spreadsheetArchiveMaxEntries,
      maxEntryUncompressedSize: spreadsheetArchiveMaxEntryBytes,
      maxTotalUncompressedSize: spreadsheetArchiveMaxUncompressedBytes,
    })
  ) {
    return { kind: "unsupported", mime, size, reason: "too_large" }
  }
  const parsedSheets = await parseSpreadsheet(bytes)
  const { preview, truncated } = spreadsheetWorkbookPreview(parsedSheets)
  return { kind: "spreadsheet", mime, size, spreadsheet: preview, truncated }
}
