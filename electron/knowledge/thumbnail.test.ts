import { describe, expect, it, vi } from "vitest"
import { isBoundedKnowledgeCoverDataUrl, knowledgeCoverDataUrl } from "./thumbnail.ts"

const pngCover = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from("cover")])

function image(options: { height?: number; jpeg?: Buffer; png?: Buffer; width?: number } = {}) {
  const resized = {
    getSize: () => ({ height: 320, width: 160 }),
    isEmpty: () => false,
    resize: vi.fn(),
    toJPEG: () => options.jpeg ?? Buffer.from("jpeg"),
    toPNG: () => options.png ?? Buffer.from("png"),
  }
  const source = {
    getSize: () => ({ height: options.height ?? 640, width: options.width ?? 320 }),
    isEmpty: () => false,
    resize: vi.fn(() => resized),
    toJPEG: () => options.jpeg ?? Buffer.from("jpeg"),
    toPNG: () => options.png ?? Buffer.from("png"),
  }
  return { resized, source }
}

describe("knowledgeCoverDataUrl", () => {
  it("resizes large covers before encoding a bounded thumbnail", () => {
    const decoded = image()

    const result = knowledgeCoverDataUrl(pngCover, () => decoded.source)

    expect(decoded.source.resize).toHaveBeenCalledWith({ height: 320, quality: "good", width: 160 })
    expect(result).toBe(`data:image/png;base64,${Buffer.from("png").toString("base64")}`)
  })

  it("falls back to jpeg when the png thumbnail exceeds the byte limit", () => {
    const decoded = image({ png: Buffer.alloc(512 * 1024 + 1) })

    const result = knowledgeCoverDataUrl(pngCover, () => decoded.source)

    expect(result).toBe(`data:image/jpeg;base64,${Buffer.from("jpeg").toString("base64")}`)
  })

  it("rejects oversized source covers before decoding", () => {
    const decode = vi.fn(() => image().source)
    const oversized = Buffer.concat([pngCover.subarray(0, 8), Buffer.alloc(4 * 1024 * 1024)])

    expect(knowledgeCoverDataUrl(oversized, decode)).toBeUndefined()
    expect(decode).not.toHaveBeenCalled()
  })

  it("rejects legacy unbounded Data URLs before they cross IPC", () => {
    expect(isBoundedKnowledgeCoverDataUrl("data:image/png;base64,cG5n")).toBe(true)
    expect(isBoundedKnowledgeCoverDataUrl(`data:image/png;base64,${"a".repeat(700_000)}`)).toBe(false)
  })
})
