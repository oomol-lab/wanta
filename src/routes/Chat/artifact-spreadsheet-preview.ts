import type { LocalArtifactPreviewResult, LocalArtifactSpreadsheetSheetPreview } from "../../../electron/chat/common.ts"

export function spreadsheetPreviewSheets(preview: LocalArtifactPreviewResult): LocalArtifactSpreadsheetSheetPreview[] {
  const sheet = preview.spreadsheet
  if (!sheet) {
    return []
  }
  if (sheet.workbook) {
    return sheet.workbook
  }
  return [
    {
      name: sheet.activeSheet || "",
      columnCount: sheet.columnCount,
      rows: sheet.rows,
      rowCount: sheet.rowCount,
    },
  ]
}

export function spreadsheetColumnLabel(index: number): string {
  let value = index + 1
  let label = ""
  while (value > 0) {
    value -= 1
    label = String.fromCharCode(65 + (value % 26)) + label
    value = Math.floor(value / 26)
  }
  return label
}

export function spreadsheetDisplayedColumnCount(rows: string[][]): number {
  return Math.max(1, ...rows.map((row) => row.length))
}
