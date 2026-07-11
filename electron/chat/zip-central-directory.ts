export interface ZipArchiveStats {
  entryCount: number
  maxEntryUncompressedSize: number
  totalCompressedSize: number
  totalUncompressedSize: number
}

const endOfCentralDirectorySignature = 0x06054b50
const centralDirectoryEntrySignature = 0x02014b50
const maxEndRecordSearchBytes = 65_557

function findEndOfCentralDirectory(view: DataView): number {
  const minimumOffset = Math.max(0, view.byteLength - maxEndRecordSearchBytes)
  for (let offset = view.byteLength - 22; offset >= minimumOffset; offset -= 1) {
    if (view.getUint32(offset, true) === endOfCentralDirectorySignature) {
      return offset
    }
  }
  return -1
}

export function zipArchiveStats(bytes: Uint8Array): ZipArchiveStats | null {
  if (bytes.byteLength < 22) {
    return null
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const endOffset = findEndOfCentralDirectory(view)
  if (endOffset < 0) {
    return null
  }
  const entryCount = view.getUint16(endOffset + 10, true)
  const centralDirectorySize = view.getUint32(endOffset + 12, true)
  const centralDirectoryOffset = view.getUint32(endOffset + 16, true)
  if (entryCount === 0xffff || centralDirectorySize === 0xffffffff || centralDirectoryOffset === 0xffffffff) {
    return null
  }
  const centralDirectoryEnd = centralDirectoryOffset + centralDirectorySize
  if (centralDirectoryEnd > endOffset || centralDirectoryEnd > bytes.byteLength) {
    return null
  }

  let offset = centralDirectoryOffset
  let totalCompressedSize = 0
  let totalUncompressedSize = 0
  let maxEntryUncompressedSize = 0
  for (let index = 0; index < entryCount; index += 1) {
    if (offset + 46 > centralDirectoryEnd || view.getUint32(offset, true) !== centralDirectoryEntrySignature) {
      return null
    }
    const compressedSize = view.getUint32(offset + 20, true)
    const uncompressedSize = view.getUint32(offset + 24, true)
    const fileNameLength = view.getUint16(offset + 28, true)
    const extraFieldLength = view.getUint16(offset + 30, true)
    const commentLength = view.getUint16(offset + 32, true)
    if (compressedSize === 0xffffffff || uncompressedSize === 0xffffffff) {
      return null
    }
    totalCompressedSize += compressedSize
    totalUncompressedSize += uncompressedSize
    maxEntryUncompressedSize = Math.max(maxEntryUncompressedSize, uncompressedSize)
    offset += 46 + fileNameLength + extraFieldLength + commentLength
  }
  if (offset !== centralDirectoryEnd) {
    return null
  }
  return { entryCount, maxEntryUncompressedSize, totalCompressedSize, totalUncompressedSize }
}
