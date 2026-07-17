import JSZip from "jszip"

const worksheetPathPattern = /^xl\/worksheets\/[^/]+\.xml$/u
const emptyInlineStringCellPattern = /<c\b([^>]*\bt=(['"])inlineStr\2[^>]*)\/>/gu
const emptyInlineStringCellPairPattern = /<c\b([^>]*\bt=(['"])inlineStr\2[^>]*)>\s*<\/c>/gu

export function isEmptyInlineStringParseFailure(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false
  }
  return (
    error.message.startsWith('Unsupported "inline string" cell value structure:') ||
    error.message === 'Couldn\'t read "inline string" cell value'
  )
}

export function normalizeExcelCraftWorksheetXml(xml: string): string {
  const expandCell = (_match: string, attributes: string): string => `<c${attributes.trimEnd()}><is><t></t></is></c>`
  return xml.replace(emptyInlineStringCellPattern, expandCell).replace(emptyInlineStringCellPairPattern, expandCell)
}

export async function normalizeExcelCraftWorkbook(bytes: Buffer): Promise<Buffer | null> {
  const workbook = await JSZip.loadAsync(bytes)
  let normalized = false

  for (const entry of Object.values(workbook.files)) {
    if (entry.dir || !worksheetPathPattern.test(entry.name)) {
      continue
    }
    const xml = await entry.async("string")
    const next = normalizeExcelCraftWorksheetXml(xml)
    if (next === xml) {
      continue
    }
    workbook.file(entry.name, next)
    normalized = true
  }

  if (!normalized) {
    return null
  }
  return workbook.generateAsync({
    type: "nodebuffer",
    compression: "DEFLATE",
    compressionOptions: { level: 6 },
  })
}
