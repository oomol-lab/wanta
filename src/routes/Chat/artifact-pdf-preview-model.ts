export const pdfMinScale = 0.25
export const pdfMaxScale = 4
export const pdfScaleStep = 0.1

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max)
}

export function adjacentPdfPage(currentPage: number, pageCount: number, delta: number): number {
  return clamp(currentPage + delta, 1, Math.max(1, pageCount))
}

export function steppedPdfScale(currentScale: number, delta: number): number {
  const roundedScale = Math.round((currentScale + delta) * 100) / 100
  return clamp(roundedScale, pdfMinScale, pdfMaxScale)
}
