import assert from "node:assert/strict"
import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { test } from "vitest"
import { localArtifactPreview } from "./previews.ts"

test("localArtifactPreview only grants leases for resource-backed previews", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "wanta-preview-leases-"))
  try {
    const textPath = path.join(directory, "notes.txt")
    const imagePath = path.join(directory, "image.png")
    await Promise.all([writeFile(textPath, "hello"), writeFile(imagePath, "image")])
    let grants = 0
    const createResourceUrl = () => {
      grants += 1
      return { expiresAt: 123, url: "wanta-resource://artifact/token" }
    }

    const textPreview = await localArtifactPreview({ path: textPath }, createResourceUrl)
    assert.equal(textPreview.kind, "text")
    assert.equal(grants, 0)

    const imagePreview = await localArtifactPreview({ path: imagePath }, createResourceUrl)
    assert.equal(imagePreview.kind, "image")
    assert.equal(grants, 1)
  } finally {
    await rm(directory, { force: true, recursive: true })
  }
})

test("localArtifactPreview rejects an unsafe DOCX before granting a resource lease", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "wanta-preview-docx-safety-"))
  try {
    const docxPath = path.join(directory, "unsafe.docx")
    await writeFile(docxPath, "not-a-zip")
    let grants = 0

    const preview = await localArtifactPreview({ path: docxPath }, () => {
      grants += 1
      return { expiresAt: 123, url: "wanta-resource://artifact/token" }
    })

    assert.equal(preview.kind, "unsupported")
    assert.equal(preview.reason, "read_failed")
    assert.equal(grants, 0)
  } finally {
    await rm(directory, { force: true, recursive: true })
  }
})

test("localArtifactPreview routes CSV and TSV through the spreadsheet preview worker", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "wanta-delimited-preview-"))
  try {
    const csvPath = path.join(directory, "report.csv")
    const tsvPath = path.join(directory, "report.tsv")
    await Promise.all([writeFile(csvPath, "a,b\n1,2"), writeFile(tsvPath, "a\tb\n1\t2")])
    const calls: string[] = []
    const createSpreadsheetPreview = async (filePath: string, mime: string, size: number) => {
      calls.push(`${path.extname(filePath)}:${mime}:${size}`)
      return { kind: "spreadsheet" as const, mime, size }
    }

    assert.equal(
      (await localArtifactPreview({ path: csvPath }, undefined, createSpreadsheetPreview)).kind,
      "spreadsheet",
    )
    assert.equal(
      (await localArtifactPreview({ path: tsvPath }, undefined, createSpreadsheetPreview)).kind,
      "spreadsheet",
    )
    assert.deepEqual(calls, [".csv:text/csv:7", ".tsv:text/tab-separated-values:7"])
  } finally {
    await rm(directory, { force: true, recursive: true })
  }
})
