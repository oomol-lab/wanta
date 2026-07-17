import assert from "node:assert/strict"
import { test } from "vitest"
import { isEmptyInlineStringParseFailure, normalizeExcelCraftWorksheetXml } from "./spreadsheet-excel-craft-compat.ts"

test("normalizeExcelCraftWorksheetXml expands Openpyxl empty inline strings", () => {
  const xml = [
    '<row r="1">',
    '<c r="A1" s="3" t="inlineStr" />',
    '<c r="B1" t="inlineStr" s="4"></c>',
    '<c r="C1" t="inlineStr"><is><t>kept</t></is></c>',
    '<c r="D1" t="n"><v>42</v></c>',
    "</row>",
  ].join("")

  assert.equal(
    normalizeExcelCraftWorksheetXml(xml),
    [
      '<row r="1">',
      '<c r="A1" s="3" t="inlineStr"><is><t></t></is></c>',
      '<c r="B1" t="inlineStr" s="4"><is><t></t></is></c>',
      '<c r="C1" t="inlineStr"><is><t>kept</t></is></c>',
      '<c r="D1" t="n"><v>42</v></c>',
      "</row>",
    ].join(""),
  )
})

test("isEmptyInlineStringParseFailure only accepts the parser compatibility error", () => {
  assert.equal(
    isEmptyInlineStringParseFailure(
      new Error('Unsupported "inline string" cell value structure: <c r="A1" t="inlineStr"></c>'),
    ),
    true,
  )
  assert.equal(isEmptyInlineStringParseFailure(new Error('Couldn\'t read "inline string" cell value')), true)
  assert.equal(isEmptyInlineStringParseFailure(new Error("Invalid XLSX ZIP central directory")), false)
  assert.equal(isEmptyInlineStringParseFailure("inline string"), false)
})
