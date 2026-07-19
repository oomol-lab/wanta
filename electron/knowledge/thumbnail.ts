const jpegSignature = Buffer.from([0xff, 0xd8, 0xff])
const pngSignature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
const maxSourceBytes = 4 * 1024 * 1024
const maxThumbnailBytes = 512 * 1024
const maxThumbnailDimension = 320
const maxThumbnailDataUrlCharacters = Math.ceil((maxThumbnailBytes * 4) / 3) + 32

export interface KnowledgeCoverImage {
  getSize(): { height: number; width: number }
  isEmpty(): boolean
  resize(options: { height: number; quality: "good"; width: number }): KnowledgeCoverImage
  toJPEG(quality: number): Buffer
  toPNG(): Buffer
}

export type KnowledgeCoverDecoder = (buffer: Buffer) => KnowledgeCoverImage

export function isBoundedKnowledgeCoverDataUrl(value: string): boolean {
  return value.length <= maxThumbnailDataUrlCharacters && /^data:image\/(?:jpeg|png);base64,/.test(value)
}

function supportedCover(cover: Buffer): boolean {
  return (
    cover.subarray(0, jpegSignature.length).equals(jpegSignature) ||
    cover.subarray(0, pngSignature.length).equals(pngSignature)
  )
}

/** 把 archive 原封面收敛为有像素和字节上限的列表缩略图，避免 Data URL 放大 registry 与 IPC。 */
export function knowledgeCoverDataUrl(cover: Buffer | null, decode: KnowledgeCoverDecoder): string | undefined {
  if (!cover || cover.length > maxSourceBytes || !supportedCover(cover)) return undefined
  try {
    const image = decode(cover)
    if (image.isEmpty()) return undefined
    const size = image.getSize()
    if (!Number.isFinite(size.width) || !Number.isFinite(size.height) || size.width <= 0 || size.height <= 0) {
      return undefined
    }
    const scale = Math.min(1, maxThumbnailDimension / Math.max(size.width, size.height))
    const thumbnail =
      scale < 1
        ? image.resize({
            height: Math.max(1, Math.round(size.height * scale)),
            quality: "good",
            width: Math.max(1, Math.round(size.width * scale)),
          })
        : image
    const png = thumbnail.toPNG()
    if (png.length <= maxThumbnailBytes) return `data:image/png;base64,${png.toString("base64")}`
    const jpeg = thumbnail.toJPEG(82)
    return jpeg.length <= maxThumbnailBytes ? `data:image/jpeg;base64,${jpeg.toString("base64")}` : undefined
  } catch {
    return undefined
  }
}
