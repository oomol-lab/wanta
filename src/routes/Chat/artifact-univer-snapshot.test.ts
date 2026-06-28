import { CellValueType, LocaleType } from "@univerjs/core"
import assert from "node:assert/strict"
import { test } from "vitest"
import { workbookSnapshotFromPreview, univerSafeId } from "./artifact-univer-snapshot.ts"

test("univerSafeId produces stable fallback-safe ids", () => {
  assert.equal(univerSafeId("季度 销售", "sheet-1"), "sheet-1")
  assert.equal(univerSafeId("Summary_2026", "sheet-1"), "Summary_2026")
  assert.equal(univerSafeId("  ", "sheet-1"), "sheet-1")
})

test("workbookSnapshotFromPreview converts workbook sheets into Univer snapshot", () => {
  const snapshot = workbookSnapshotFromPreview({
    kind: "spreadsheet",
    mime: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    spreadsheet: {
      activeSheet: "Summary",
      columnCount: 2,
      rowCount: 2,
      rows: [],
      sheets: ["Summary", "Summary"],
      workbook: [
        {
          columnCount: 12,
          name: "Summary",
          rowCount: 1000,
          rows: [
            ["Month", "Revenue"],
            ["January", "3600000"],
          ],
        },
        {
          columnCount: 1,
          name: "Summary",
          rowCount: 1,
          rows: [["Product"]],
        },
      ],
    },
    truncated: true,
  })

  assert.ok(snapshot)
  assert.equal(snapshot.locale, LocaleType.ZH_CN)
  assert.deepEqual(snapshot.sheetOrder, ["Summary", "Summary-2"])
  assert.equal(snapshot.sheets.Summary?.rowCount, 2)
  assert.equal(snapshot.sheets.Summary?.columnCount, 2)
  assert.equal(snapshot.sheets.Summary?.cellData?.[0]?.[0]?.v, "Month")
  assert.equal(snapshot.sheets.Summary?.cellData?.[0]?.[0]?.t, CellValueType.STRING)
  assert.equal(snapshot.sheets.Summary?.cellData?.[1]?.[1]?.v, 3600000)
  assert.equal(snapshot.sheets.Summary?.cellData?.[1]?.[1]?.t, CellValueType.NUMBER)
  assert.equal(snapshot.sheets["Summary-2"]?.name, "Summary")
})

test("workbookSnapshotFromPreview keeps non-numeric labels as strings", () => {
  const snapshot = workbookSnapshotFromPreview({
    kind: "spreadsheet",
    mime: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    spreadsheet: {
      activeSheet: "Labels",
      columnCount: 3,
      rowCount: 2,
      rows: [],
      sheets: ["Labels"],
      workbook: [
        {
          columnCount: 3,
          name: "Labels",
          rowCount: 2,
          rows: [
            ["1月", "00123", "1,280"],
            ["12.5", "1e3", " 42"],
          ],
        },
      ],
    },
  })

  assert.ok(snapshot)
  assert.equal(snapshot.sheets.Labels?.cellData?.[0]?.[0]?.t, CellValueType.STRING)
  assert.equal(snapshot.sheets.Labels?.cellData?.[0]?.[1]?.t, CellValueType.STRING)
  assert.equal(snapshot.sheets.Labels?.cellData?.[0]?.[2]?.v, 1280)
  assert.equal(snapshot.sheets.Labels?.cellData?.[0]?.[2]?.t, CellValueType.NUMBER)
  assert.equal(snapshot.sheets.Labels?.cellData?.[1]?.[0]?.v, 12.5)
  assert.equal(snapshot.sheets.Labels?.cellData?.[1]?.[1]?.v, 1000)
  assert.equal(snapshot.sheets.Labels?.cellData?.[1]?.[2]?.t, CellValueType.STRING)
})

test("workbookSnapshotFromPreview keeps empty sheets renderable", () => {
  const snapshot = workbookSnapshotFromPreview({
    kind: "spreadsheet",
    mime: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    spreadsheet: {
      activeSheet: "",
      columnCount: 0,
      rowCount: 0,
      rows: [],
      sheets: [],
      workbook: [{ columnCount: 0, name: "", rowCount: 0, rows: [] }],
    },
  })

  assert.ok(snapshot)
  assert.deepEqual(snapshot.sheetOrder, ["sheet-1"])
  assert.equal(snapshot.sheets["sheet-1"]?.name, "Sheet 1")
  assert.equal(snapshot.sheets["sheet-1"]?.rowCount, 1)
  assert.equal(snapshot.sheets["sheet-1"]?.columnCount, 1)
})
