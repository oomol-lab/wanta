import type { LocalArtifactPreviewResult } from "../../../electron/chat/common.ts"
import type { ICellData, IWorkbookData, IWorksheetData } from "@univerjs/core"

import { BooleanNumber, CellValueType, LocaleType } from "@univerjs/core"
import { spreadsheetPreviewSheets } from "./artifact-spreadsheet-preview.ts"

const univerWorkbookAppVersion = "0.25.1"
const plainNumberPattern = /^[+-]?(?:\d+|\d*\.\d+)(?:e[+-]?\d+)?$/i
const thousandsNumberPattern = /^[+-]?\d{1,3}(?:,\d{3})+(?:\.\d+)?(?:e[+-]?\d+)?$/i

export function univerSafeId(value: string, fallback: string): string {
  const sanitized = value
    .trim()
    .replace(/[^a-zA-Z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
  return sanitized || fallback
}

function numericCellValue(value: string): number | null {
  const trimmed = value.trim()
  if (trimmed !== value || trimmed === "") {
    return null
  }
  if (/^[+-]?0\d/.test(trimmed)) {
    return null
  }

  const normalized = thousandsNumberPattern.test(trimmed) ? trimmed.replace(/,/g, "") : trimmed
  if (!plainNumberPattern.test(normalized)) {
    return null
  }

  const parsed = Number(normalized)
  return Number.isFinite(parsed) ? parsed : null
}

function cellDataFromValue(value: string): ICellData | null {
  if (!value) {
    return null
  }

  const numberValue = numericCellValue(value)
  if (numberValue !== null) {
    return {
      t: CellValueType.NUMBER,
      v: numberValue,
    }
  }

  return {
    t: CellValueType.STRING,
    v: value,
  }
}

function cellDataFromRows(rows: string[][]): NonNullable<IWorksheetData["cellData"]> {
  const data: NonNullable<IWorksheetData["cellData"]> = {}
  rows.forEach((row, rowIndex) => {
    const rowData: Record<number, ICellData> = {}
    row.forEach((value, columnIndex) => {
      const cellData = cellDataFromValue(value)
      if (!cellData) {
        return
      }
      rowData[columnIndex] = cellData
    })
    if (Object.keys(rowData).length > 0) {
      data[rowIndex] = rowData
    }
  })
  return data
}

export function workbookSnapshotFromPreview(preview: LocalArtifactPreviewResult): IWorkbookData | null {
  const sheets = spreadsheetPreviewSheets(preview)
  if (sheets.length === 0) {
    return null
  }

  const usedSheetIds = new Set<string>()
  const sheetOrder: string[] = []
  const workbookSheets: IWorkbookData["sheets"] = {}

  sheets.forEach((sheet, index) => {
    const baseSheetId = univerSafeId(sheet.name, `sheet-${index + 1}`)
    let sheetId = baseSheetId
    let suffix = 2
    while (usedSheetIds.has(sheetId)) {
      sheetId = `${baseSheetId}-${suffix}`
      suffix += 1
    }
    usedSheetIds.add(sheetId)
    sheetOrder.push(sheetId)

    const rowCount = Math.max(sheet.rows.length, 1)
    const columnCount = Math.max(...sheet.rows.map((row) => row.length), 1)
    workbookSheets[sheetId] = {
      cellData: cellDataFromRows(sheet.rows),
      columnCount,
      columnData: {},
      columnHeader: { height: 28 },
      defaultColumnWidth: 104,
      defaultRowHeight: 28,
      freeze: { xSplit: 0, ySplit: 0, startRow: -1, startColumn: -1 },
      hidden: BooleanNumber.FALSE,
      id: sheetId,
      mergeData: [],
      name: sheet.name || `Sheet ${index + 1}`,
      rightToLeft: BooleanNumber.FALSE,
      rowCount,
      rowData: {},
      rowHeader: { width: 46 },
      scrollLeft: 0,
      scrollTop: 0,
      showGridlines: BooleanNumber.TRUE,
      tabColor: "",
      zoomRatio: 1,
    }
  })

  return {
    appVersion: univerWorkbookAppVersion,
    id: "artifact-spreadsheet-preview",
    locale: LocaleType.ZH_CN,
    name: "Artifact Spreadsheet Preview",
    sheetOrder,
    sheets: workbookSheets,
    styles: {},
  }
}
