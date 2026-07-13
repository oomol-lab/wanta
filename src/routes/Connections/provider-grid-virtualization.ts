export const providerGridCardHeightPx = 68
export const providerGridGapPx = 8
export const providerGridMinColumnWidthPx = 216
export const providerGridOverscanRows = 4

export interface ProviderGridVisibleRangeInput {
  catalogTop: number
  columnCount: number
  overscanRows?: number
  providerCount: number
  rowGap?: number
  rowHeight?: number
  scrollTop: number
  viewportHeight: number
}

export interface ProviderGridVisibleRange {
  endIndex: number
  startIndex: number
  topOffset: number
  totalHeight: number
}

export interface ProviderGridCenteredScrollTopInput {
  catalogTop: number
  columnCount: number
  itemIndex: number
  rowGap?: number
  rowHeight?: number
  scrollHeight: number
  viewportHeight: number
}

export function getProviderGridColumnCount(
  width: number,
  minColumnWidth = providerGridMinColumnWidthPx,
  gap = providerGridGapPx,
): number {
  if (width <= 0) {
    return 1
  }

  return Math.max(1, Math.floor((width + gap) / (minColumnWidth + gap)))
}

export function getProviderGridRowCount(providerCount: number, columnCount: number): number {
  if (providerCount <= 0) {
    return 0
  }

  return Math.ceil(providerCount / Math.max(1, columnCount))
}

export function getProviderGridTotalHeight(
  rowCount: number,
  rowHeight = providerGridCardHeightPx,
  rowGap = providerGridGapPx,
): number {
  if (rowCount <= 0) {
    return 0
  }

  return rowCount * rowHeight + (rowCount - 1) * rowGap
}

/** 根据重排后的实际列数，将目标卡片尽可能定位到滚动视口中央。 */
export function getProviderGridCenteredScrollTop({
  catalogTop,
  columnCount,
  itemIndex,
  rowGap = providerGridGapPx,
  rowHeight = providerGridCardHeightPx,
  scrollHeight,
  viewportHeight,
}: ProviderGridCenteredScrollTopInput): number {
  const safeColumnCount = Math.max(1, columnCount)
  const safeItemIndex = Math.max(0, itemIndex)
  const safeViewportHeight = Math.max(0, viewportHeight)
  const rowIndex = Math.floor(safeItemIndex / safeColumnCount)
  const itemCenter = catalogTop + rowIndex * (rowHeight + rowGap) + rowHeight / 2
  const centeredScrollTop = itemCenter - safeViewportHeight / 2
  const maxScrollTop = Math.max(0, scrollHeight - safeViewportHeight)
  return Math.min(Math.max(0, centeredScrollTop), maxScrollTop)
}

export function getProviderGridVisibleRange({
  catalogTop,
  columnCount,
  overscanRows = providerGridOverscanRows,
  providerCount,
  rowGap = providerGridGapPx,
  rowHeight = providerGridCardHeightPx,
  scrollTop,
  viewportHeight,
}: ProviderGridVisibleRangeInput): ProviderGridVisibleRange {
  const safeColumnCount = Math.max(1, columnCount)
  const rowCount = getProviderGridRowCount(providerCount, safeColumnCount)
  const totalHeight = getProviderGridTotalHeight(rowCount, rowHeight, rowGap)

  if (rowCount === 0) {
    return {
      endIndex: 0,
      startIndex: 0,
      topOffset: 0,
      totalHeight,
    }
  }

  const rowPitch = rowHeight + rowGap
  const safeOverscanRows = Math.max(0, overscanRows)
  const safeViewportHeight = Math.max(0, viewportHeight)
  const maxVisibleTop = Math.max(0, totalHeight - safeViewportHeight)
  const visibleTop = Math.min(Math.max(0, scrollTop - catalogTop), maxVisibleTop)
  const visibleBottom = visibleTop + safeViewportHeight
  const startRow = Math.max(0, Math.floor(visibleTop / rowPitch) - safeOverscanRows)
  const endRow = Math.min(rowCount, Math.ceil(visibleBottom / rowPitch) + safeOverscanRows)

  return {
    endIndex: Math.min(providerCount, endRow * safeColumnCount),
    startIndex: startRow * safeColumnCount,
    topOffset: startRow * rowPitch,
    totalHeight,
  }
}
