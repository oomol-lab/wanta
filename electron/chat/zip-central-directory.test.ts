import assert from "node:assert/strict"
import { test } from "vitest"
import { zipArchiveStats } from "./zip-central-directory.ts"

function syntheticZip(entries: Array<{ compressed: number; name: string; uncompressed: number }>): Uint8Array {
  const centralSize = entries.reduce((total, entry) => total + 46 + new TextEncoder().encode(entry.name).length, 0)
  const bytes = new Uint8Array(centralSize + 22)
  const view = new DataView(bytes.buffer)
  let offset = 0
  for (const entry of entries) {
    const name = new TextEncoder().encode(entry.name)
    view.setUint32(offset, 0x02014b50, true)
    view.setUint32(offset + 20, entry.compressed, true)
    view.setUint32(offset + 24, entry.uncompressed, true)
    view.setUint16(offset + 28, name.length, true)
    bytes.set(name, offset + 46)
    offset += 46 + name.length
  }
  view.setUint32(offset, 0x06054b50, true)
  view.setUint16(offset + 8, entries.length, true)
  view.setUint16(offset + 10, entries.length, true)
  view.setUint32(offset + 12, centralSize, true)
  view.setUint32(offset + 16, 0, true)
  return bytes
}

test("zipArchiveStats reads entry sizes without inflating file content", () => {
  assert.deepEqual(
    zipArchiveStats(
      syntheticZip([
        { compressed: 10, name: "a.xml", uncompressed: 100 },
        { compressed: 20, name: "b.xml", uncompressed: 300 },
      ]),
    ),
    { entryCount: 2, maxEntryUncompressedSize: 300, totalCompressedSize: 30, totalUncompressedSize: 400 },
  )
})

test("zipArchiveStats rejects malformed archives", () => {
  assert.equal(zipArchiveStats(new Uint8Array(22)), null)
})

test("zipArchiveStats ignores a false end record inside the archive comment", () => {
  const base = syntheticZip([{ compressed: 10, name: "a.xml", uncompressed: 100 }])
  const commentLength = 30
  const bytes = new Uint8Array(base.length + commentLength)
  bytes.set(base)
  const view = new DataView(bytes.buffer)
  const realEndOffset = base.length - 22
  view.setUint16(realEndOffset + 20, commentLength, true)
  view.setUint32(realEndOffset + 22, 0x06054b50, true)

  assert.deepEqual(zipArchiveStats(bytes), {
    entryCount: 1,
    maxEntryUncompressedSize: 100,
    totalCompressedSize: 10,
    totalUncompressedSize: 100,
  })
})
