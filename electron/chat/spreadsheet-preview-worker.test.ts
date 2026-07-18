import type { SpreadsheetPreviewWorkerResponse } from "./spreadsheet-preview-worker-protocol.ts"

import JSZip from "jszip"
import assert from "node:assert/strict"
import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { Worker } from "node:worker_threads"
import { test } from "vitest"

async function xlsxFixture(): Promise<Buffer> {
  const zip = new JSZip()
  zip.file(
    "[Content_Types].xml",
    '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>',
  )
  zip.file(
    "_rels/.rels",
    '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>',
  )
  zip.file(
    "xl/workbook.xml",
    '<?xml version="1.0"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Summary" sheetId="1" r:id="rId1"/></sheets></workbook>',
  )
  zip.file(
    "xl/_rels/workbook.xml.rels",
    '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>',
  )
  zip.file(
    "xl/worksheets/sheet1.xml",
    '<?xml version="1.0"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><dimension ref="A1:C1"/><sheetData><row r="1"><c r="A1"><v>42</v></c><c r="B1" s="3" t="inlineStr" /><c r="C1" t="inlineStr"><is><t>kept</t></is></c></row></sheetData></worksheet>',
  )
  return zip.generateAsync({ type: "nodebuffer" })
}

test("spreadsheet preview worker parses an XLSX end to end", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "wanta-xlsx-worker-"))
  const worker = new Worker(new URL("./spreadsheet-preview-worker.ts", import.meta.url), {
    execArgv: ["--experimental-strip-types"],
  })
  try {
    const filePath = path.join(directory, "fixture.xlsx")
    const bytes = await xlsxFixture()
    await writeFile(filePath, bytes)
    const response = await new Promise<SpreadsheetPreviewWorkerResponse>((resolve, reject) => {
      worker.once("message", resolve)
      worker.once("error", reject)
      worker.postMessage({
        id: "fixture",
        mime: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        path: filePath,
        size: bytes.length,
      })
    })
    assert.ok("result" in response)
    assert.equal(response.result.kind, "spreadsheet")
    assert.equal(response.result.spreadsheet?.activeSheet, "Summary")
    assert.deepEqual(response.result.spreadsheet?.rows, [["42", "", "kept"]])
  } finally {
    await worker.terminate()
    await rm(directory, { force: true, recursive: true })
  }
})

test("spreadsheet preview worker parses CSV and TSV end to end", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "wanta-delimited-worker-"))
  const worker = new Worker(new URL("./spreadsheet-preview-worker.ts", import.meta.url), {
    execArgv: ["--experimental-strip-types"],
  })
  try {
    const fixtures = [
      { content: 'name,note\nWanta,"hello, world"', extension: "csv", mime: "text/csv" },
      { content: "name\tnote\nWanta\thello", extension: "tsv", mime: "text/tab-separated-values" },
    ] as const
    for (const fixture of fixtures) {
      const filePath = path.join(directory, `fixture.${fixture.extension}`)
      await writeFile(filePath, fixture.content)
      const response = await new Promise<SpreadsheetPreviewWorkerResponse>((resolve, reject) => {
        worker.once("message", resolve)
        worker.once("error", reject)
        worker.postMessage({
          id: fixture.extension,
          mime: fixture.mime,
          path: filePath,
          size: Buffer.byteLength(fixture.content),
        })
      })
      assert.ok("result" in response)
      assert.equal(response.result.kind, "spreadsheet")
      assert.equal(response.result.spreadsheet?.activeSheet, "fixture")
      assert.deepEqual(response.result.spreadsheet?.rows[0], ["name", "note"])
    }
  } finally {
    await worker.terminate()
    await rm(directory, { force: true, recursive: true })
  }
})
