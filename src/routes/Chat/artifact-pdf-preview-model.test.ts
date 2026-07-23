import { describe, expect, it } from "vitest"
import {
  adjacentPdfPage,
  pdfMaxScale,
  pdfMinScale,
  pdfScaleStep,
  steppedPdfScale,
} from "./artifact-pdf-preview-model.ts"

describe("adjacentPdfPage", () => {
  it("moves between pages and clamps at both document boundaries", () => {
    expect(adjacentPdfPage(2, 4, 1)).toBe(3)
    expect(adjacentPdfPage(1, 4, -1)).toBe(1)
    expect(adjacentPdfPage(4, 4, 1)).toBe(4)
  })

  it("keeps an unloaded document at the first page", () => {
    expect(adjacentPdfPage(1, 0, 1)).toBe(1)
  })
})

describe("steppedPdfScale", () => {
  it("uses stable decimal steps", () => {
    expect(steppedPdfScale(0.9, pdfScaleStep)).toBe(1)
    expect(steppedPdfScale(1, -pdfScaleStep)).toBe(0.9)
  })

  it("clamps zoom at the supported range", () => {
    expect(steppedPdfScale(pdfMinScale, -pdfScaleStep)).toBe(pdfMinScale)
    expect(steppedPdfScale(pdfMaxScale, pdfScaleStep)).toBe(pdfMaxScale)
  })
})
