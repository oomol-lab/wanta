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
