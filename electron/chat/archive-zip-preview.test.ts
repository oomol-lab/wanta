import JSZip from "jszip"
import assert from "node:assert/strict"
import { test } from "vitest"
import { zipPreviewFromBytes } from "./archive-preview.ts"
import { readZipPreview } from "./archive-zip-preview.ts"

type EntryField = "size" | "compressed" | "offset" | "disk"

// Convert a normal JSZip fixture to ZIP64, leaving its local headers and bodies intact.
function zip64Fixture(bytes: Buffer, fields: EntryField[] = []) {
  const oldEnd = bytes.length - 22
  const oldStart = bytes.readUInt32LE(oldEnd + 16)
  let directory = Buffer.from(bytes.subarray(oldStart, oldEnd))
  if (fields.length) {
    const header = Buffer.from(directory.subarray(0, 46))
    const extra = Buffer.alloc(4 + fields.reduce((n, field) => n + (field === "disk" ? 4 : 8), 0))
    extra.writeUInt16LE(1)
    extra.writeUInt16LE(extra.length - 4, 2)
    let position = 4
    for (const field of fields) {
      const headerOffset = { size: 24, compressed: 20, offset: 42, disk: 34 }[field]
      if (field === "disk") {
        extra.writeUInt32LE(header.readUInt16LE(headerOffset), position)
        header.writeUInt16LE(0xffff, headerOffset)
        position += 4
      } else {
        extra.writeBigUInt64LE(BigInt(header.readUInt32LE(headerOffset)), position)
        header.writeUInt32LE(0xffffffff, headerOffset)
        position += 8
      }
    }
    const nameEnd = 46 + header.readUInt16LE(28)
    header.writeUInt16LE(header.readUInt16LE(30) + extra.length, 30)
    directory = Buffer.concat([header, directory.subarray(46, nameEnd), extra, directory.subarray(nameEnd)])
  }
  const recordOffset = oldStart + directory.length
  const record = Buffer.alloc(56)
  record.writeUInt32LE(0x06064b50)
  record.writeBigUInt64LE(44n, 4)
  record.writeUInt16LE(45, 12)
  record.writeUInt16LE(45, 14)
  record.writeBigUInt64LE(BigInt(bytes.readUInt16LE(oldEnd + 10)), 24)
  record.writeBigUInt64LE(BigInt(bytes.readUInt16LE(oldEnd + 10)), 32)
  record.writeBigUInt64LE(BigInt(directory.length), 40)
  record.writeBigUInt64LE(BigInt(oldStart), 48)
  const locator = Buffer.alloc(20)
  locator.writeUInt32LE(0x07064b50)
  locator.writeBigUInt64LE(BigInt(recordOffset), 8)
  locator.writeUInt32LE(1, 16)
  const end = Buffer.from(bytes.subarray(oldEnd))
  end.writeUInt16LE(0xffff, 8)
  end.writeUInt16LE(0xffff, 10)
  end.writeUInt32LE(0xffffffff, 12)
  end.writeUInt32LE(0xffffffff, 16)
  return {
    bytes: Buffer.concat([bytes.subarray(0, oldStart), directory, record, locator, end]),
    directoryOffset: oldStart,
    recordOffset,
    locatorOffset: recordOffset + 56,
  }
}

async function smallZip() {
  return new JSZip().file("hello.txt", "hello").generateAsync({ type: "nodebuffer" })
}

test("small ZIP64 archives match JSZip with end records and conditional entry metadata", async () => {
  for (const fields of [[], ["size"], ["offset"], ["size", "compressed", "offset"]] as EntryField[][]) {
    const { bytes } = zip64Fixture(await smallZip(), fields)
    const previous = await JSZip.loadAsync(bytes)
    const preview = await zipPreviewFromBytes(bytes, "application/zip", bytes.length)
    assert.deepEqual(
      preview.archive?.entries.map((e) => e.path),
      Object.keys(previous.files),
    )
    assert.equal(preview.archive?.entries[0].size, 5)
    assert.equal(preview.archive?.entries[0].compressedSize, 5)
    assert.equal(preview.archive?.totalEntries, 1)
    assert.equal(preview.truncated, false)
  }
})

test("ZIP64 entry metadata supports safe 64-bit sizes and disk sentinels", async () => {
  const fixture = zip64Fixture(await smallZip(), ["size", "compressed", "offset", "disk"])
  const extra = fixture.directoryOffset + 46 + Buffer.byteLength("hello.txt") + 4
  fixture.bytes.writeBigUInt64LE(2n ** 40n, extra)
  const preview = await zipPreviewFromBytes(fixture.bytes, "application/zip", fixture.bytes.length)
  assert.equal(preview.archive?.entries[0].size, 2 ** 40)
})

test("ZIP64 offsets and sizes are checked before any out-of-bounds or claimed-size reads", async () => {
  const source = await smallZip()
  for (const target of [
    "locator",
    "directory",
    "directorySize",
    "recordSize",
    "count",
    "entryOffset",
    "entryCompressed",
    "entrySize",
  ] as const) {
    for (const bad of [BigInt(Number.MAX_SAFE_INTEGER) + 1n, BigInt(Number.MAX_SAFE_INTEGER)]) {
      const fixture = zip64Fixture(source, ["size", "compressed", "offset"])
      const entryExtra = fixture.directoryOffset + 46 + Buffer.byteLength("hello.txt") + 4
      const position = {
        locator: fixture.locatorOffset + 8,
        directory: fixture.recordOffset + 48,
        directorySize: fixture.recordOffset + 40,
        recordSize: fixture.recordOffset + 4,
        count: fixture.recordOffset + 32,
        entryOffset: entryExtra + 16,
        entryCompressed: entryExtra + 8,
        entrySize: entryExtra,
      }[target]
      fixture.bytes.writeBigUInt64LE(bad, position)
      if (target === "count") fixture.bytes.writeBigUInt64LE(bad, fixture.recordOffset + 24)
      const read = async (offset: number, length: number) => {
        assert.ok(Number.isSafeInteger(offset) && offset >= 0 && offset + length <= fixture.bytes.length)
        assert.ok(length <= 65_557)
        return fixture.bytes.subarray(offset, offset + length)
      }
      // A safe uncompressed size is metadata only and does not allocate or inflate a body.
      if (target === "entrySize" && bad === BigInt(Number.MAX_SAFE_INTEGER)) {
        assert.equal((await readZipPreview(fixture.bytes.length, read)).entries[0].size, Number.MAX_SAFE_INTEGER)
      } else {
        await assert.rejects(readZipPreview(fixture.bytes.length, read), /ZIP/)
      }
    }
  }
})

test("ZIP64 still reads at most 300 directory entries", async () => {
  const zip = new JSZip()
  for (let i = 0; i < 401; i++) zip.file(`entry-${i}`, "")
  const { bytes } = zip64Fixture(await zip.generateAsync({ type: "nodebuffer" }))
  let reads = 0
  let readBytes = 0
  const result = await readZipPreview(bytes.length, async (offset, length) => {
    reads++
    readBytes += length
    return bytes.subarray(offset, offset + length)
  })
  assert.equal(result.entries.length, 300)
  assert.equal(result.totalEntries, 401)
  assert.equal(reads, 602) // EOCD tail, fixed ZIP64 record, and 300 header/name pairs.
  assert.ok(readBytes < 100_000)
})

test("ZIP64 locator outside a maximum-length comment tail is read in a fixed 20-byte request", async () => {
  const fixture = zip64Fixture(await smallZip())
  fixture.bytes.writeUInt16LE(65535, fixture.bytes.length - 2)
  const bytes = Buffer.concat([fixture.bytes, Buffer.alloc(65535, 65)])
  const reads: number[] = []
  const result = await readZipPreview(bytes.length, async (offset, length) => {
    reads.push(length)
    return bytes.subarray(offset, offset + length)
  })
  assert.equal(result.entries[0].path, "hello.txt")
  assert.deepEqual(reads.slice(0, 3), [65_557, 20, 56])
})

test("malformed ZIP64 extras, record extents, and split disks are rejected", async () => {
  for (const change of ["extra", "disk", "locatorDisk", "recordExtent"] as const) {
    const fixture = zip64Fixture(await smallZip(), ["offset"])
    if (change === "extra")
      fixture.bytes.writeUInt16LE(2, fixture.directoryOffset + 46 + Buffer.byteLength("hello.txt"))
    if (change === "disk") fixture.bytes.writeUInt32LE(1, fixture.recordOffset + 16)
    if (change === "locatorDisk") fixture.bytes.writeUInt32LE(2, fixture.locatorOffset + 16)
    if (change === "recordExtent") fixture.bytes.writeBigUInt64LE(45n, fixture.recordOffset + 4)
    await assert.rejects(zipPreviewFromBytes(fixture.bytes, "application/zip", fixture.bytes.length), /ZIP64/)
  }
})

test("Unicode Path extra decoding matches JSZip precedence, CRC and version rules", async () => {
  const original = await new JSZip().file("雪.txt", "hello").generateAsync({
    type: "nodebuffer",
    encodeFileName: (name) => (name ? "legacy.txt" : ""),
  })
  const directory = original.readUInt32LE(original.length - 6)
  const extra = directory + 46 + original.readUInt16LE(directory + 28)
  assert.equal(original.readUInt16LE(extra), 0x7075)
  for (const variant of ["valid", "crc", "version", "utf8"] as const) {
    const bytes = Buffer.from(original)
    if (variant === "crc") bytes.writeUInt32LE(0, extra + 5)
    if (variant === "version") bytes[extra + 4] = 2
    if (variant === "utf8") bytes.writeUInt16LE(0x800, directory + 8)
    const previous = await JSZip.loadAsync(bytes)
    const result = await zipPreviewFromBytes(bytes, "application/zip", bytes.length)
    assert.deepEqual(
      result.archive?.entries.map((e) => e.path),
      Object.keys(previous.files),
    )
    assert.equal(result.archive?.entries[0].path, variant === "valid" ? "雪.txt" : "legacy.txt")
  }
})

test("Unicode filename fallback remains JSZip's default UTF-8 decoding", async () => {
  const bytes = await new JSZip().file("雪.txt", "hello").generateAsync({ type: "nodebuffer" })
  const directory = bytes.readUInt32LE(bytes.length - 6)
  bytes.writeUInt16LE(0, directory + 8)
  const extra = directory + 46 + bytes.readUInt16LE(directory + 28)
  bytes.writeUInt16LE(0x7777, extra) // Ignore the Unicode Path field.
  const previous = await JSZip.loadAsync(bytes)
  const result = await zipPreviewFromBytes(bytes, "application/zip", bytes.length)
  assert.deepEqual(
    result.archive?.entries.map((e) => e.path),
    Object.keys(previous.files),
  )
})

test("Unicode path and unknown extra fields cannot bypass metadata budgets", async () => {
  const zip = new JSZip()
  for (let i = 0; i < 150; i++) zip.file(`${i}-${"雪".repeat(1200)}`, "")
  const bytes = await zip.generateAsync({ type: "nodebuffer" })
  let readBytes = 0
  const result = await readZipPreview(bytes.length, async (offset, length) => {
    readBytes += length
    return bytes.subarray(offset, offset + length)
  })
  assert.ok(result.entries.length > 0 && result.entries.length < 150)
  assert.equal(result.totalEntries, 150)
  assert.ok(readBytes <= 65_557 + 300 * 46 + 1024 * 1024)

  const longUnicode = await new JSZip().file("雪".repeat(1400), "").generateAsync({
    type: "nodebuffer",
    encodeFileName: (name) => (name ? "legacy" : ""),
  })
  const preview = await zipPreviewFromBytes(longUnicode, "application/zip", longUnicode.length)
  assert.equal(preview.archive?.entries.length, 0)
  assert.equal(preview.truncated, true)
})

test("ZIP64 entry extras also work with an ordinary EOCD", async () => {
  const fixture = zip64Fixture(await smallZip(), ["size", "compressed", "offset"])
  const end = Buffer.from(fixture.bytes.subarray(-22))
  end.writeUInt16LE(1, 8)
  end.writeUInt16LE(1, 10)
  end.writeUInt32LE(fixture.recordOffset - fixture.directoryOffset, 12)
  end.writeUInt32LE(fixture.directoryOffset, 16)
  const bytes = Buffer.concat([fixture.bytes.subarray(0, fixture.recordOffset), end])
  const previous = await JSZip.loadAsync(bytes)
  const result = await zipPreviewFromBytes(bytes, "application/zip", bytes.length)
  assert.deepEqual(
    result.archive?.entries.map((e) => e.path),
    Object.keys(previous.files),
  )
  assert.equal(result.archive?.entries[0].size, 5)
})

test("ZIP64 extensible data is skipped without a claimed-size allocation", async () => {
  const fixture = zip64Fixture(await smallZip())
  const extensionSize = 2 * 1024 * 1024
  fixture.bytes.writeBigUInt64LE(BigInt(44 + extensionSize), fixture.recordOffset + 4)
  const bytes = Buffer.concat([
    fixture.bytes.subarray(0, fixture.locatorOffset),
    Buffer.alloc(extensionSize),
    fixture.bytes.subarray(fixture.locatorOffset),
  ])
  let readBytes = 0
  const result = await readZipPreview(bytes.length, async (offset, length) => {
    readBytes += length
    return bytes.subarray(offset, offset + length)
  })
  assert.equal(result.entries[0].path, "hello.txt")
  assert.ok(readBytes < 66_000)
})

test("locator-like central-directory comment bytes do not override a complete classic EOCD", async () => {
  const bytes = await new JSZip()
    .file("hello.txt", "hello", { comment: "x".repeat(20) })
    .generateAsync({ type: "nodebuffer" })
  const comment = bytes.length - 22 - 20
  bytes.writeUInt32LE(0x07064b50, comment)
  bytes.writeBigUInt64LE(2n ** 63n, comment + 8)
  const previous = await JSZip.loadAsync(bytes)
  const result = await zipPreviewFromBytes(bytes, "application/zip", bytes.length)
  assert.deepEqual(
    result.archive?.entries.map((e) => e.path),
    Object.keys(previous.files),
  )
  assert.equal(result.truncated, false)
})

test("voluntary ZIP64 end records do not require parsing when the classic EOCD is complete", async () => {
  const fixture = zip64Fixture(await smallZip(), ["size"])
  const end = fixture.bytes.length - 22
  fixture.bytes.writeUInt16LE(1, end + 8)
  fixture.bytes.writeUInt16LE(1, end + 10)
  fixture.bytes.writeUInt32LE(fixture.recordOffset - fixture.directoryOffset, end + 12)
  fixture.bytes.writeUInt32LE(fixture.directoryOffset, end + 16)
  let reads = 0
  const result = await readZipPreview(fixture.bytes.length, async (offset, length) => {
    reads++
    return fixture.bytes.subarray(offset, offset + length)
  })
  assert.equal(result.entries[0].path, "hello.txt")
  assert.equal(result.entries[0].size, 5)
  assert.equal(reads, 3)
})
