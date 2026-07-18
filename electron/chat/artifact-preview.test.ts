import assert from "node:assert/strict"
import { test } from "vitest"
import {
  delimitedSpreadsheetPreview,
  spreadsheetPreviewMaxColumns,
  spreadsheetPreviewMaxRows,
  spreadsheetPreviewFormat,
  spreadsheetWorkbookPreview,
} from "./artifact-preview.ts"

test("spreadsheetPreviewFormat recognizes supported local spreadsheet formats", () => {
  assert.equal(spreadsheetPreviewFormat("/tmp/table.csv", "application/octet-stream"), "csv")
  assert.equal(spreadsheetPreviewFormat("/tmp/table.tsv", "application/octet-stream"), "tsv")
  assert.equal(spreadsheetPreviewFormat("/tmp/table.xlsx", "application/octet-stream"), "xlsx")
  assert.equal(spreadsheetPreviewFormat("/tmp/table.xls", "application/vnd.ms-excel"), null)
})

test("delimitedSpreadsheetPreview parses quoted CSV into a workbook preview", () => {
  const { preview, truncated } = delimitedSpreadsheetPreview(
    '\uFEFFname,note\r\n"Wanta, app","said ""hi"""\r\nplain,value\r\n',
    ",",
    { sheetName: "report" },
  )

  assert.equal(truncated, false)
  assert.equal(preview.activeSheet, "report")
  assert.deepEqual(preview.rows, [
    ["name", "note"],
    ["Wanta, app", 'said "hi"'],
    ["plain", "value"],
  ])
})

test("delimitedSpreadsheetPreview parses quoted TSV fields and embedded newlines", () => {
  const { preview } = delimitedSpreadsheetPreview('name\tnote\n"Wanta\tapp"\t"line 1\nline 2"', "\t")

  assert.deepEqual(preview.rows, [
    ["name", "note"],
    ["Wanta\tapp", "line 1\nline 2"],
  ])
})

test("delimitedSpreadsheetPreview caps rows and columns during parsing", () => {
  const { preview, truncated } = delimitedSpreadsheetPreview('a,b,c\n1,2,3\n4,5,"ignored, safely"', ",", {
    maxColumns: 2,
    maxRows: 2,
    sourceTruncated: true,
  })

  assert.equal(truncated, true)
  assert.deepEqual(preview.rows, [
    ["a", "b"],
    ["1", "2"],
  ])
})

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
