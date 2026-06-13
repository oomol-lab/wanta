export type MarkdownTableRows = string[][]

export function tableElementToRows(table: HTMLTableElement): MarkdownTableRows {
  return Array.from(table.rows).map((row) =>
    Array.from(row.cells).map((cell) => normalizeTableCellText(cell.innerText || cell.textContent || "")),
  )
}

export function tableRowsToMarkdown(rows: MarkdownTableRows): string {
  if (rows.length === 0) {
    return ""
  }

  const columnCount = Math.max(...rows.map((row) => row.length))
  if (columnCount === 0) {
    return ""
  }

  const normalizedRows = rows.map((row) => Array.from({ length: columnCount }, (_, index) => row[index] ?? ""))
  const [header, ...body] = normalizedRows
  return [
    markdownRow(header),
    markdownRow(Array.from({ length: columnCount }, () => "---")),
    ...body.map((row) => markdownRow(row)),
  ].join("\n")
}

function markdownRow(row: string[]): string {
  return `| ${row.map(escapeMarkdownTableCell).join(" | ")} |`
}

export function escapeMarkdownTableCell(cell: string): string {
  return cell.replace(/\\/g, "\\\\").replace(/\|/g, "\\|").replace(/\r?\n/g, "<br>")
}

function normalizeTableCellText(text: string): string {
  return text.replace(/\s+/g, " ").trim()
}
