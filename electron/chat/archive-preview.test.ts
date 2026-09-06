import JSZip from "jszip"
import assert from "node:assert/strict"
import { mkdtemp, open, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { gzipSync } from "node:zlib"
import { Header } from "tar"
import { test } from "vitest"
import { archivePreview, archivePreviewMaxBytes, zipPreviewFromBytes } from "./archive-preview.ts"
import { readTarPreview } from "./archive-tar-preview.ts"
import { readZipPreview } from "./archive-zip-preview.ts"

function tarHeader(name: string, size = 0, type: "File" | "ExtendedHeader" = "File"): Buffer {
  const block = Buffer.alloc(512)
  new Header({ path: name, size, type, mode: 0o644 }).encode(block)
  return block
}

async function withArchive(bytes: Buffer, run: (file: string) => Promise<void>, name = "test.tar") {
  const directory = await mkdtemp(path.join(tmpdir(), "wanta-archive-budget-"))
  try {
    const file = path.join(directory, name)
    await writeFile(file, bytes)
    await run(file)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
}

test("ZIP reads only a bounded central-directory prefix without reading the payload", async () => {
  const zip = new JSZip()
  zip.file("payload", Buffer.alloc(2 * 1024 * 1024, 1))
  for (let i = 0; i < 400; i++) zip.file(`entry-${i}`, "")
  const bytes = await zip.generateAsync({ type: "nodebuffer", compression: "STORE" })
  let readBytes = 0
  let reads = 0
  const preview = await readZipPreview(bytes.length, async (offset, length) => {
    assert.ok(offset > 2 * 1024 * 1024 - 65_557)
    readBytes += length
    reads++
    return bytes.subarray(offset, offset + length)
  })
  assert.equal(preview.entries.length, 300)
  assert.equal(preview.totalEntries, 401)
  assert.equal(preview.entries[0].size, 2 * 1024 * 1024)
  assert.equal(reads, 601)
  assert.ok(readBytes < 100_000)
})

test("ZIP preserves small archive names and reports exact totals", async () => {
  const zip = new JSZip().file("目录/hello.txt", "hello")
  const bytes = await zip.generateAsync({ type: "nodebuffer" })
  const preview = await zipPreviewFromBytes(bytes, "application/zip", bytes.length)
  assert.equal(preview.truncated, false)
  assert.equal(preview.archive?.totalEntries, 2)
  assert.deepEqual(
    preview.archive?.entries.map((e) => [e.path, e.kind]),
    [
      ["目录/", "directory"],
      ["目录/hello.txt", "file"],
    ],
  )
})

test("ZIP time budget returns an honest truncated directory without reading records", async () => {
  const bytes = await new JSZip().file("hello", "world").generateAsync({ type: "nodebuffer" })
  let reads = 0
  const result = await readZipPreview(
    bytes.length,
    async (offset, length) => {
      reads++
      return bytes.subarray(offset, offset + length)
    },
    { maxTimeMs: 0 },
  )
  assert.equal(reads, 1)
  assert.equal(result.totalEntries, 1)
  assert.equal(result.entries.length, 0)
})

test("ZIP rejects invalid record extents and missing ZIP64 end records", async () => {
  const bytes = await new JSZip().file("hello", "world").generateAsync({ type: "nodebuffer" })
  const end = bytes.length - 22
  const badExtent = Buffer.from(bytes)
  badExtent.writeUInt16LE(65535, badExtent.readUInt32LE(end + 16) + 28)
  await assert.rejects(zipPreviewFromBytes(badExtent, "application/zip", bytes.length), /length/)
  bytes.writeUInt16LE(65535, end + 10)
  await assert.rejects(zipPreviewFromBytes(bytes, "application/zip", bytes.length), /ZIP64/)
})

test("TAR and TGZ stop at 300 headers before parsing a corrupt trailing header", async () => {
  const bytes = Buffer.concat([
    ...Array.from({ length: 300 }, (_, i) => tarHeader(`entry-${i}`)),
    Buffer.alloc(512, 255),
  ])
  for (const [name, data] of [
    ["test.tar", bytes],
    ["test.tgz", gzipSync(bytes)],
  ] as const) {
    await withArchive(
      data,
      async (file) => {
        const result = await archivePreview(file, "application/x-tar", data.length)
        assert.equal(result?.archive?.entries.length, 300)
        assert.equal(result?.archive?.totalEntries, null)
        assert.equal(result?.truncated, true)
      },
      name,
    )
  }
})

test("TAR and TGZ return exact totals only on complete scans", async () => {
  const bytes = Buffer.concat([tarHeader("hello", 5), Buffer.from("hello"), Buffer.alloc(507 + 1024)])
  for (const [name, data] of [
    ["test.tar", bytes],
    ["test.tgz", gzipSync(bytes)],
  ] as const) {
    await withArchive(
      data,
      async (file) => {
        const result = await archivePreview(file, "application/x-tar", data.length)
        assert.equal(result?.archive?.totalEntries, 1)
        assert.equal(result?.archive?.entries[0].size, 5)
        assert.equal(result?.truncated, false)
      },
      name,
    )
  }
})

test("TGZ decompressed-byte budget stops inside a large entry body", async () => {
  const bytes = gzipSync(
    Buffer.concat([
      tarHeader("large", 2 * 1024 * 1024),
      Buffer.alloc(2 * 1024 * 1024),
      tarHeader("not-scanned"),
      Buffer.alloc(1024),
    ]),
  )
  await withArchive(
    bytes,
    async (file) => {
      const handle = await open(file, "r")
      try {
        const result = await readTarPreview(handle, { maxScanBytes: 1024 })
        assert.equal(result.totalEntries, null)
        assert.deepEqual(
          result.entries.map((e) => e.path),
          ["large"],
        )
      } finally {
        await handle.close()
      }
    },
    "test.tgz",
  )
})

test("TAR rejects malformed input and stops on oversized path metadata", async () => {
  await withArchive(Buffer.alloc(512, 255), async (file) => {
    await assert.rejects(archivePreview(file, "application/x-tar", 512))
  })
  await withArchive(
    Buffer.concat([tarHeader("pax", 8192, "ExtendedHeader"), Buffer.alloc(8192), tarHeader("hidden-name")]),
    async (file) => {
      const result = await archivePreview(file, "application/x-tar", 9216)
      assert.equal(result?.archive?.totalEntries, null)
      assert.equal(result?.truncated, true)
      assert.equal(result?.archive?.entries.length, 0)
    },
  )
})

test("TAR timeout terminates work and cancellation rejects without partial success", async () => {
  const bytes = gzipSync(Buffer.concat([tarHeader("large", 8 * 1024 * 1024), Buffer.alloc(8 * 1024 * 1024)]))
  await withArchive(
    bytes,
    async (file) => {
      const handle = await open(file, "r")
      try {
        const result = await readTarPreview(handle, { maxTimeMs: 0 })
        assert.equal(result.totalEntries, null)
        const controller = new AbortController()
        const pending = readTarPreview(handle, { signal: controller.signal })
        controller.abort()
        await assert.rejects(pending, { name: "AbortError" })
      } finally {
        await handle.close()
      }
    },
    "test.tgz",
  )
})

test("archive direct callers cannot bypass the on-disk size budget with a stale size", async () => {
  await withArchive(
    Buffer.alloc(0),
    async (file) => {
      const handle = await open(file, "r+")
      await handle.truncate(archivePreviewMaxBytes + 1)
      await handle.close()
      const result = await archivePreview(file, "application/zip", 1)
      assert.equal(result?.reason, "too_large")
    },
    "large.zip",
  )
})

test("nested gzip cannot bypass the external decompressed-byte budget", async () => {
  const inner = gzipSync(Buffer.concat([tarHeader("large", 1024 * 1024), Buffer.alloc(1024 * 1024)]))
  const bytes = gzipSync(inner)
  await withArchive(
    bytes,
    async (file) => {
      await assert.rejects(archivePreview(file, "application/x-tar", bytes.length), /Nested gzip/)
    },
    "test.tgz",
  )
})

test("ZIP cancellation stops directory reads", async () => {
  const bytes = await new JSZip().file("hello", "world").generateAsync({ type: "nodebuffer" })
  const controller = new AbortController()
  let reads = 0
  await assert.rejects(
    readZipPreview(
      bytes.length,
      async (offset, length) => {
        reads++
        controller.abort()
        return bytes.subarray(offset, offset + length)
      },
      { signal: controller.signal },
    ),
    { name: "AbortError" },
  )
  assert.equal(reads, 1)
})
