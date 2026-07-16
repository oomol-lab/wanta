import type { LocalArtifactPreviewResult, LocalArtifactSpreadsheetPreview } from "./common.ts"

import crypto from "node:crypto"
import { mkdir, writeFile } from "node:fs/promises"
import path from "node:path"
import { isXlsxArtifact } from "./artifact-preview.ts"

interface SpreadsheetAttachmentSource {
  mime: string
  name: string
  path: string
  size: number
}

export interface SpreadsheetAgentInput {
  agentMime: string
  agentName: string
  agentPath: string
  agentSize: number
}

export type CreateSpreadsheetPreview = (path: string, mime: string, size: number) => Promise<LocalArtifactPreviewResult>

function csvCell(value: string): string {
  return /[",\r\n]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value
}

function spreadsheetAgentName(name: string): string {
  const base = name.replace(/\.xlsx$/i, "") || "spreadsheet"
  return `${base}-extracted.txt`
}

export function spreadsheetAgentText(
  source: SpreadsheetAttachmentSource,
  workbook: LocalArtifactSpreadsheetPreview,
): string {
  const sheets = workbook.workbook ?? [
    { name: workbook.activeSheet, columnCount: workbook.columnCount, rows: workbook.rows, rowCount: workbook.rowCount },
  ]
  const lines = [
    "Wanta spreadsheet extraction",
    `Original workbook: ${source.name}`,
    `Original workbook path: ${source.path}`,
    "The workbook was converted to text for model compatibility. Use the original path with local spreadsheet tools when exact formatting, formulas, images, or workbook editing is required.",
  ]

  for (const sheet of sheets) {
    lines.push("", `=== Sheet: ${sheet.name} ===`, `Rows: ${sheet.rowCount}; Columns: ${sheet.columnCount}`)
    for (const row of sheet.rows) {
      lines.push(row.map(csvCell).join(","))
    }
    if (sheet.rows.length < sheet.rowCount) {
      lines.push(`[Rows truncated: showing ${sheet.rows.length} of ${sheet.rowCount}]`)
    }
    const shownColumns = Math.max(0, ...sheet.rows.map((row) => row.length))
    if (shownColumns < sheet.columnCount) {
      lines.push(`[Columns truncated: showing at most ${shownColumns} of ${sheet.columnCount}]`)
    }
  }

  if (sheets.length < workbook.sheets.length) {
    lines.push("", `[Sheets truncated: showing ${sheets.length} of ${workbook.sheets.length}]`)
  }
  return `${lines.join("\n")}\n`
}

export async function createSpreadsheetAgentInput(
  userDataDir: string,
  source: SpreadsheetAttachmentSource,
  createPreview: CreateSpreadsheetPreview,
): Promise<SpreadsheetAgentInput | null> {
  if (!isXlsxArtifact(source.path, source.mime)) {
    return null
  }
  const preview = await createPreview(source.path, source.mime, source.size)
  if (preview.kind !== "spreadsheet" || !preview.spreadsheet) {
    return null
  }

  const text = spreadsheetAgentText(source, preview.spreadsheet)
  const bytes = Buffer.from(text, "utf8")
  const directory = path.join(userDataDir, "attachments", "agent")
  const name = spreadsheetAgentName(source.name)
  const filePath = path.join(directory, `${crypto.randomUUID()}-${name}`)
  await mkdir(directory, { recursive: true })
  await writeFile(filePath, bytes, { mode: 0o600 })
  return {
    agentMime: "text/plain",
    agentName: name,
    agentPath: filePath,
    agentSize: bytes.byteLength,
  }
}
