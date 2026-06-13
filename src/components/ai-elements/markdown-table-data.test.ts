import { describe, expect, it } from "vitest"
import { escapeMarkdownTableCell, tableRowsToMarkdown } from "./markdown-table-data.ts"

describe("tableRowsToMarkdown", () => {
  it("serializes the first row as the markdown table header", () => {
    expect(
      tableRowsToMarkdown([
        ["文件", "说明"],
        ["page_001.png ~ page_021.png", "每页一张，300 DPI，高清画质"],
      ]),
    ).toBe(
      ["| 文件 | 说明 |", "| --- | --- |", "| page_001.png ~ page_021.png | 每页一张，300 DPI，高清画质 |"].join("\n"),
    )
  })

  it("pads ragged rows so copied tables stay rectangular", () => {
    expect(tableRowsToMarkdown([["A", "B", "C"], ["1"]])).toBe(
      ["| A | B | C |", "| --- | --- | --- |", "| 1 |  |  |"].join("\n"),
    )
  })
})

describe("escapeMarkdownTableCell", () => {
  it("escapes markdown table delimiters and preserves line breaks", () => {
    expect(escapeMarkdownTableCell("a | b\\c\nnext")).toBe("a \\| b\\\\c<br>next")
  })
})
