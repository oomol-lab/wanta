export interface CsvPreviewOptions {
  maxColumns?: number
  maxRows?: number
}

export interface CsvPreviewResult {
  rows: string[][]
  truncated: boolean
}

const defaultMaxRows = 50
const defaultMaxColumns = 20

export function parseCsvPreview(source: string, options: CsvPreviewOptions = {}): CsvPreviewResult {
  const maxRows = Math.max(1, options.maxRows ?? defaultMaxRows)
  const maxColumns = Math.max(1, options.maxColumns ?? defaultMaxColumns)
  const rows: string[][] = []
  let row: string[] = []
  let field = ""
  let inQuotes = false
  let truncated = false
  let endedWithRowSeparator = false

  const pushField = (): void => {
    row.push(field)
    field = ""
  }

  const pushRow = (): void => {
    pushField()
    if (row.length > maxColumns) {
      truncated = true
    }
    if (rows.length < maxRows) {
      rows.push(row.slice(0, maxColumns))
    } else {
      truncated = true
    }
    row = []
    endedWithRowSeparator = true
  }

  for (let index = 0; index < source.length; index += 1) {
    const char = source[index]
    endedWithRowSeparator = false
    if (inQuotes) {
      if (char === '"') {
        if (source[index + 1] === '"') {
          field += '"'
          index += 1
        } else {
          inQuotes = false
        }
      } else {
        field += char
      }
      continue
    }

    if (char === '"' && field.length === 0) {
      inQuotes = true
      continue
    }
    if (char === ",") {
      pushField()
      continue
    }
    if (char === "\r" || char === "\n") {
      if (char === "\r" && source[index + 1] === "\n") {
        index += 1
      }
      pushRow()
      continue
    }
    field += char
  }

  if (!endedWithRowSeparator && (field.length > 0 || row.length > 0 || inQuotes)) {
    pushRow()
  }

  return { rows, truncated }
}
