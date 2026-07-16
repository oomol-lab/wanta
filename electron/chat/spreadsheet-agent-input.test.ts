import { mkdtemp, readFile, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { describe, expect, it } from "vitest"
import { createSpreadsheetAgentInput, spreadsheetAgentText } from "./spreadsheet-agent-input.ts"

const source = {
  mime: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  name: "库存表.xlsx",
  path: "/Users/example/库存表.xlsx",
  size: 1024,
}

const spreadsheet = {
  activeSheet: "SKU",
  columnCount: 2,
  rowCount: 2,
  rows: [
    ["SKU", "Price"],
    ["A-1", "59"],
  ],
  sheets: ["SKU", "Notes"],
  workbook: [
    {
      name: "SKU",
      columnCount: 2,
      rowCount: 2,
      rows: [
        ["SKU", "Price"],
        ["A-1", "59"],
      ],
    },
    {
      name: "Notes",
      columnCount: 1,
      rowCount: 1,
      rows: [['contains "quotes"']],
    },
  ],
}

describe("spreadsheetAgentText", () => {
  it("serializes every previewed sheet and retains the original workbook path", () => {
    const text = spreadsheetAgentText(source, spreadsheet)

    expect(text).toContain("Original workbook path: /Users/example/库存表.xlsx")
    expect(text).toContain("=== Sheet: SKU ===")
    expect(text).toContain("SKU,Price\nA-1,59")
    expect(text).toContain("=== Sheet: Notes ===")
    expect(text).toContain('"contains ""quotes"""')
  })
})

describe("createSpreadsheetAgentInput", () => {
  it("writes a private text attachment for an XLSX workbook", async () => {
    const userDataDir = await mkdtemp(path.join(os.tmpdir(), "wanta-spreadsheet-agent-"))
    try {
      const result = await createSpreadsheetAgentInput(userDataDir, source, async () => ({
        kind: "spreadsheet",
        mime: source.mime,
        size: source.size,
        spreadsheet,
        truncated: false,
      }))

      expect(result).toMatchObject({
        agentMime: "text/plain",
        agentName: "库存表-extracted.txt",
      })
      expect(result).not.toBeNull()
      if (!result) throw new Error("Expected an agent input")
      expect(result.agentPath).toContain(path.join("attachments", "agent"))
      expect(await readFile(result.agentPath, "utf8")).toContain("=== Sheet: SKU ===")
    } finally {
      await rm(userDataDir, { recursive: true, force: true })
    }
  })

  it("ignores non-XLSX attachments", async () => {
    const result = await createSpreadsheetAgentInput(
      "/tmp/unused",
      { ...source, mime: "text/csv", name: "库存表.csv", path: "/tmp/库存表.csv" },
      async () => {
        throw new Error("preview should not run")
      },
    )

    expect(result).toBeNull()
  })

  it.each(["too_large", "read_failed"] as const)(
    "falls back to the original attachment when XLSX preparation reports %s",
    async (reason) => {
      const result = await createSpreadsheetAgentInput("/tmp/unused", source, async () => ({
        kind: "unsupported",
        mime: source.mime,
        reason,
        size: source.size,
      }))

      expect(result).toBeNull()
    },
  )
})
