import assert from "node:assert/strict"
import { mkdir, mkdtemp, open, rename, rm, stat, symlink, writeFile } from "node:fs/promises"
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

test("localArtifactPreview streams large videos through an artifact resource lease", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "wanta-preview-video-"))
  try {
    const videoPath = path.join(directory, "large.mp4")
    await writeFile(videoPath, Buffer.alloc(16 * 1024 * 1024 + 1))
    let grantedSize = 0

    const preview = await localArtifactPreview({ path: videoPath }, ({ size }) => {
      grantedSize = size
      return { expiresAt: 123, url: "wanta-resource://artifact/video-token" }
    })

    assert.equal(preview.kind, "media")
    assert.equal(preview.mime, "video/mp4")
    assert.equal(preview.resourceUrl, "wanta-resource://artifact/video-token")
    assert.equal(grantedSize, 16 * 1024 * 1024 + 1)
  } finally {
    await rm(directory, { force: true, recursive: true })
  }
})

test.skipIf(process.platform === "win32")(
  "localArtifactPreview reads a verified snapshot after a parent-directory replacement without a resource grant",
  async () => {
    const root = await mkdtemp(path.join(tmpdir(), "wanta-preview-snapshot-"))
    try {
      const artifactDirectory = path.join(root, "artifacts")
      const movedArtifactDirectory = path.join(root, "artifacts-original")
      const outsideDirectory = path.join(root, "outside")
      await Promise.all([mkdir(artifactDirectory), mkdir(outsideDirectory)])
      const filePath = path.join(artifactDirectory, "report.txt")
      await writeFile(filePath, "trusted content")
      await writeFile(path.join(outsideDirectory, "report.txt"), "outside content")
      const handle = await open(filePath, "r")
      const info = await stat(filePath)

      await rename(artifactDirectory, movedArtifactDirectory)
      await symlink(outsideDirectory, artifactDirectory, "dir")

      const preview = await localArtifactPreview({ path: filePath }, undefined, undefined, {
        dev: info.dev,
        handle,
        ino: info.ino,
        modifiedAt: info.mtimeMs,
        size: info.size,
      })

      assert.equal(preview.kind, "text")
      assert.equal(preview.text, "trusted content")
    } finally {
      await rm(root, { force: true, recursive: true })
    }
  },
)

test("archive size budget rejects before any trusted-handle reads and closes the handle", async () => {
  const { archivePreviewMaxBytes } = await import("./archive-preview.ts")
  for (const extension of ["zip", "tar", "tgz"]) {
    const directory = await mkdtemp(path.join(tmpdir(), "wanta-archive-snapshot-budget-"))
    try {
      const file = path.join(directory, `large.${extension}`)
      const handle = await open(file, "wx+")
      await handle.truncate(archivePreviewMaxBytes + 1)
      const info = await handle.stat()
      let reads = 0
      handle.read = (async () => {
        reads++
        throw new Error("Must reject before copying")
      }) as typeof handle.read
      const result = await localArtifactPreview({ path: file }, undefined, undefined, {
        dev: info.dev,
        ino: info.ino,
        handle,
        modifiedAt: info.mtimeMs,
        size: info.size,
      })
      assert.equal(result.reason, "too_large")
      assert.equal(reads, 0)
      await assert.rejects(handle.stat(), { code: "EBADF" })
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  }
})

test.skipIf(process.platform === "win32")(
  "archive preview keeps using the trusted handle after path replacement",
  async () => {
    const { default: JSZip } = await import("jszip")
    const root = await mkdtemp(path.join(tmpdir(), "wanta-archive-trusted-"))
    try {
      const file = path.join(root, "archive.zip")
      await writeFile(file, await new JSZip().file("trusted", "hello").generateAsync({ type: "nodebuffer" }))
      const handle = await open(file, "r")
      const info = await handle.stat()
      await rename(file, path.join(root, "original.zip"))
      await writeFile(file, await new JSZip().file("replacement", "outside").generateAsync({ type: "nodebuffer" }))
      const result = await localArtifactPreview({ path: file }, undefined, undefined, {
        dev: info.dev,
        ino: info.ino,
        handle,
        modifiedAt: info.mtimeMs,
        size: info.size,
      })
      assert.deepEqual(
        result.archive?.entries.map((e) => e.path),
        ["trusted"],
      )
      await assert.rejects(handle.stat(), { code: "EBADF" })
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  },
)
