import assert from "node:assert/strict"
import { test } from "vitest"
import {
  spreadsheetPreviewMaxColumns,
  spreadsheetPreviewMaxRows,
  spreadsheetWorkbookPreview,
} from "./artifact-preview.ts"

test("spreadsheetWorkbookPreview preserves multiple sheets for Excel-like preview", () => {
  const { preview, truncated } = spreadsheetWorkbookPreview([
    {
      sheet: "Summary",
      data: [
        ["Month", "Revenue"],
        ["January", 3600000],
      ],
    },
    {
      sheet: "Products",
      data: [
        ["Product", "Units"],
        ["Cloud", 12],
      ],
    },
  ])

  assert.equal(truncated, false)
  assert.equal(preview.activeSheet, "Summary")
  assert.deepEqual(preview.sheets, ["Summary", "Products"])
  assert.deepEqual(
    preview.workbook?.map((sheet) => [sheet.name, sheet.rowCount, sheet.columnCount]),
    [
      ["Summary", 2, 2],
      ["Products", 2, 2],
    ],
  )
  assert.deepEqual(preview.workbook?.[1]?.rows, [
    ["Product", "Units"],
    ["Cloud", "12"],
  ])
})

test("spreadsheetWorkbookPreview reports truncated oversized sheets", () => {
  const wideRow = Array.from({ length: spreadsheetPreviewMaxColumns + 1 }, (_, index) => index)
  const rows = Array.from({ length: spreadsheetPreviewMaxRows + 1 }, () => wideRow)
  const { preview, truncated } = spreadsheetWorkbookPreview([{ sheet: "Large", data: rows }])

  assert.equal(truncated, true)
  assert.equal(preview.workbook?.[0]?.rows.length, spreadsheetPreviewMaxRows)
  assert.equal(preview.workbook?.[0]?.rows[0]?.length, spreadsheetPreviewMaxColumns)
})
