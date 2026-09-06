import type { LocalArtifactArchivePreview } from "./common.ts"

import { crc32 } from "node:zlib"
import { archivePreviewMaxEntries, archivePreviewMaxTimeMs } from "./archive-preview-limits.ts"

function safeUint64(bytes: Buffer, offset: number): number {
  if (offset + 8 > bytes.length) throw new Error("Incomplete ZIP64 metadata")
  const value = bytes.readBigUInt64LE(offset)
  if (value > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error("Unsafe ZIP64 integer")
  return Number(value)
}

// Only retain the two fields needed for a listing; unknown fields are skipped.
function extraFields(bytes: Buffer): { zip64?: Buffer; unicodePath?: Buffer } {
  const fields: { zip64?: Buffer; unicodePath?: Buffer } = {}
  for (let offset = 0; offset < bytes.length;) {
    if (offset + 4 > bytes.length) throw new Error("Incomplete ZIP extra field")
    const id = bytes.readUInt16LE(offset)
    const length = bytes.readUInt16LE(offset + 2)
    const end = offset + 4 + length
    if (end > bytes.length) throw new Error("Invalid ZIP extra field length")
    if (id === 0x0001) fields.zip64 = bytes.subarray(offset + 4, end)
    if (id === 0x7075) fields.unicodePath = bytes.subarray(offset + 4, end)
    offset = end
  }
  return fields
}

// Read only the EOCD tail and the displayed central-directory records. Never inflate bodies.
export async function readZipPreview(
  size: number,
  readBytes: (offset: number, length: number) => Promise<Buffer>,
  options: { signal?: AbortSignal; maxTimeMs?: number } = {},
): Promise<LocalArtifactArchivePreview> {
  const deadline = performance.now() + (options.maxTimeMs ?? archivePreviewMaxTimeMs)
  const read = async (offset: number, length: number) => {
    options.signal?.throwIfAborted()
    if (
      !Number.isSafeInteger(offset) ||
      !Number.isSafeInteger(length) ||
      offset < 0 ||
      length < 0 ||
      offset > size - length
    ) {
      throw new Error("ZIP read outside archive bounds")
    }
    const bytes = await readBytes(offset, length)
    options.signal?.throwIfAborted()
    if (bytes.length !== length) throw new Error("Incomplete ZIP directory read")
    return bytes
  }
  const tailSize = Math.min(size, 65_557)
  const tail = await read(size - tailSize, tailSize)
  let end = tail.length - 22
  for (; end >= 0; end--) {
    if (tail.readUInt32LE(end) === 0x06054b50 && end + 22 + tail.readUInt16LE(end + 20) === tail.length) break
  }
  if (end < 0) throw new Error("Missing ZIP directory")
  let totalEntries = tail.readUInt16LE(end + 10)
  let directorySize = tail.readUInt32LE(end + 12)
  let offset = tail.readUInt32LE(end + 16)
  let directoryBoundary = size - tailSize + end
  const disk = tail.readUInt16LE(end + 4)
  const directoryDisk = tail.readUInt16LE(end + 6)
  const diskEntries = tail.readUInt16LE(end + 8)
  const needsZip64 =
    [disk, directoryDisk, diskEntries, totalEntries].includes(0xffff) ||
    directorySize === 0xffffffff ||
    offset === 0xffffffff
  const locatorOffset = directoryBoundary - 20
  // Complete classic EOCD values are sufficient even if a voluntary ZIP64 record
  // exists. Only sentinel values authorize interpreting the preceding bytes as a locator.
  const locator =
    !needsZip64 || locatorOffset < 0
      ? undefined
      : end >= 20
        ? tail.subarray(end - 20, end)
        : await read(locatorOffset, 20)
  if (locator?.readUInt32LE(0) === 0x07064b50) {
    if (locator.readUInt32LE(4) !== 0 || locator.readUInt32LE(16) !== 1)
      throw new Error("Split ZIP64 archives are not supported")
    const zip64Offset = safeUint64(locator, 8)
    // Fetch the fixed 56-byte record only; never allocate its claimed extensible data.
    if (zip64Offset > locatorOffset - 56) throw new Error("Invalid ZIP64 end record offset")
    const record = await read(zip64Offset, 56)
    if (record.readUInt32LE(0) !== 0x06064b50) throw new Error("Missing ZIP64 end record")
    const recordSize = safeUint64(record, 4)
    if (recordSize < 44 || recordSize !== locatorOffset - zip64Offset - 12)
      throw new Error("Invalid ZIP64 end record size")
    if (record.readUInt32LE(16) !== 0 || record.readUInt32LE(20) !== 0)
      throw new Error("Split ZIP64 archives are not supported")
    const count = safeUint64(record, 32)
    const length = safeUint64(record, 40)
    const start = safeUint64(record, 48)
    if (
      safeUint64(record, 24) !== count ||
      (disk !== 0 && disk !== 0xffff) ||
      (directoryDisk !== 0 && directoryDisk !== 0xffff) ||
      (diskEntries !== 0xffff && diskEntries !== count) ||
      (totalEntries !== 0xffff && totalEntries !== count) ||
      (directorySize !== 0xffffffff && directorySize !== length) ||
      (offset !== 0xffffffff && offset !== start)
    ) {
      throw new Error("Inconsistent ZIP64 directory")
    }
    totalEntries = count
    directorySize = length
    offset = start
    directoryBoundary = zip64Offset
  } else if (needsZip64) {
    throw new Error("Missing ZIP64 locator")
  } else if (disk !== 0 || directoryDisk !== 0 || diskEntries !== totalEntries) {
    throw new Error("Split or invalid ZIP directory")
  }
  if (
    offset > directoryBoundary ||
    directorySize > directoryBoundary - offset ||
    totalEntries > Math.floor(directorySize / 46)
  ) {
    throw new Error("Invalid ZIP directory bounds")
  }
  const directoryStart = offset
  const directoryEnd = offset + directorySize
  const entries: LocalArtifactArchivePreview["entries"] = []
  let metadataBytes = 0
  for (let i = 0; i < Math.min(totalEntries, archivePreviewMaxEntries); i++) {
    options.signal?.throwIfAborted()
    if (performance.now() >= deadline) return { entries, format: "zip", totalEntries }
    if (offset + 46 > directoryEnd) throw new Error("Incomplete ZIP directory entry")
    const header = await read(offset, 46)
    if (header.readUInt32LE(0) !== 0x02014b50) throw new Error("Invalid ZIP directory entry")
    const length = header.readUInt16LE(28)
    const extraLength = header.readUInt16LE(30)
    const next = offset + 46 + length + extraLength + header.readUInt16LE(32)
    if (next > directoryEnd) throw new Error("Invalid ZIP directory entry length")
    // The original 1 MiB name budget now also covers extra-field I/O and parsing.
    if (length > 4096 || metadataBytes + length + extraLength > 1024 * 1024)
      return { entries, format: "zip", totalEntries }
    const metadata = await read(offset + 46, length + extraLength)
    const rawName = metadata.subarray(0, length)
    const fields = extraFields(metadata.subarray(length))
    let nameBytes = rawName
    const unicodePath = fields.unicodePath
    // Match JSZip's default decoding: UTF-8 flag wins; otherwise use a version-1
    // Info-ZIP Unicode Path only when its CRC matches the original filename.
    if (
      !(header.readUInt16LE(8) & 0x800) &&
      unicodePath &&
      unicodePath.length >= 5 &&
      unicodePath[0] === 1 &&
      unicodePath.readUInt32LE(1) === crc32(rawName)
    ) {
      nameBytes = unicodePath.subarray(5)
    }
    if (nameBytes.length > 4096) return { entries, format: "zip", totalEntries }
    const name = nameBytes.toString("utf8")
    let uncompressedSize = header.readUInt32LE(24)
    let compressedSize = header.readUInt32LE(20)
    let localOffset = header.readUInt32LE(42)
    let diskStart = header.readUInt16LE(34)
    let zip64Position = 0
    const entryUint64 = () => {
      if (!fields.zip64) throw new Error("Missing ZIP64 entry metadata")
      const value = safeUint64(fields.zip64, zip64Position)
      zip64Position += 8
      return value
    }
    // ZIP64 values occur only for corresponding sentinel fields, in this order.
    if (uncompressedSize === 0xffffffff) uncompressedSize = entryUint64()
    if (compressedSize === 0xffffffff) compressedSize = entryUint64()
    if (localOffset === 0xffffffff) localOffset = entryUint64()
    if (diskStart === 0xffff) {
      if (!fields.zip64 || zip64Position + 4 > fields.zip64.length) throw new Error("Incomplete ZIP64 disk metadata")
      diskStart = fields.zip64.readUInt32LE(zip64Position)
    }
    if (diskStart !== 0) throw new Error("Split ZIP entries are not supported")
    if (localOffset > directoryStart - 30 || compressedSize > directoryStart - localOffset - 30)
      throw new Error("Invalid ZIP entry bounds")
    const date = header.readUInt16LE(14)
    const time = header.readUInt16LE(12)
    entries.push({
      kind: name.endsWith("/") || (header.readUInt32LE(38) & 0x10) !== 0 ? "directory" : "file",
      path: name,
      size: uncompressedSize,
      compressedSize,
      modifiedAt: date
        ? new Date(
            (date >> 9) + 1980,
            ((date >> 5) & 15) - 1,
            date & 31,
            time >> 11,
            (time >> 5) & 63,
            (time & 31) * 2,
          ).getTime()
        : undefined,
    })
    metadataBytes += length + extraLength
    offset = next
  }
  if (entries.length === totalEntries && offset !== directoryEnd) throw new Error("ZIP directory count mismatch")
  return { entries, format: "zip", totalEntries }
}
