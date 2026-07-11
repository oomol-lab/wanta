import assert from "node:assert/strict"
import { test } from "vitest"
import {
  spreadsheetColumnLabel,
  spreadsheetDisplayedColumnCount,
  spreadsheetPreviewSheets,
} from "./artifact-spreadsheet-preview.ts"

test("spreadsheetColumnLabel produces Excel-style column labels", () => {
  assert.equal(spreadsheetColumnLabel(0), "A")
  assert.equal(spreadsheetColumnLabel(25), "Z")
  assert.equal(spreadsheetColumnLabel(26), "AA")
  assert.equal(spreadsheetColumnLabel(701), "ZZ")
})

test("spreadsheetDisplayedColumnCount keeps empty sheets renderable", () => {
  assert.equal(spreadsheetDisplayedColumnCount([]), 1)
  assert.equal(spreadsheetDisplayedColumnCount([["A"], ["A", "B", "C"]]), 3)
})

test("spreadsheetPreviewSheets prefers the multi-sheet workbook", () => {
  const sheets = spreadsheetPreviewSheets({
    kind: "spreadsheet",
    mime: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    spreadsheet: {
      activeSheet: "Summary",
      columnCount: 1,
      rowCount: 1,
      rows: [["fallback"]],
      sheets: ["Summary", "Details"],
      workbook: [
        { columnCount: 1, name: "Summary", rowCount: 1, rows: [["Total"]] },
        { columnCount: 1, name: "Details", rowCount: 1, rows: [["Item"]] },
      ],
    },
  })

  assert.deepEqual(
    sheets.map((sheet) => sheet.name),
    ["Summary", "Details"],
  )
})
