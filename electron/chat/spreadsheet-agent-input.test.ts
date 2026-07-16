import path from "node:path"
import { describe, expect, it, vi } from "vitest"
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
    const ensureDirectory = vi.fn(async () => undefined)
    const written: Array<{ bytes: Buffer; filePath: string }> = []
    const writePrivateFile = vi.fn(async (filePath: string, bytes: Buffer) => {
      written.push({ bytes, filePath })
    })
    const result = await createSpreadsheetAgentInput(
      "/tmp/wanta-user-data",
      source,
      async () => ({
        kind: "spreadsheet",
        mime: source.mime,
        size: source.size,
        spreadsheet,
        truncated: false,
      }),
      {
        createId: () => "attachment-id",
        ensureDirectory,
        writePrivateFile,
      },
    )

    expect(result).toMatchObject({
      agentMime: "text/plain",
      agentName: "库存表-extracted.txt",
      agentPath: path.join("/tmp/wanta-user-data", "attachments", "agent", "attachment-id-库存表-extracted.txt"),
    })
    expect(ensureDirectory).toHaveBeenCalledWith(path.join("/tmp/wanta-user-data", "attachments", "agent"))
    expect(writePrivateFile).toHaveBeenCalledWith(result?.agentPath, expect.any(Buffer))
    expect(written[0]?.bytes.toString("utf8")).toContain("=== Sheet: SKU ===")
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
