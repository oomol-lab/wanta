import { describe, expect, it } from "vitest"
import {
  getProviderGridColumnCount,
  getProviderGridRowCount,
  getProviderGridTotalHeight,
  getProviderGridVisibleRange,
  providerGridCardHeightPx,
  providerGridGapPx,
} from "./provider-grid-virtualization.ts"

describe("provider grid virtualization", () => {
  it("matches the responsive grid column formula", () => {
    expect(getProviderGridColumnCount(0)).toBe(1)
    expect(getProviderGridColumnCount(216)).toBe(1)
    expect(getProviderGridColumnCount(440)).toBe(2)
    expect(getProviderGridColumnCount(664)).toBe(3)
  })

  it("computes fixed row count and total height", () => {
    expect(getProviderGridRowCount(0, 3)).toBe(0)
    expect(getProviderGridRowCount(7, 3)).toBe(3)
    expect(getProviderGridTotalHeight(3)).toBe(providerGridCardHeightPx * 3 + providerGridGapPx * 2)
  })

  it("returns visible provider indexes with overscan", () => {
    const range = getProviderGridVisibleRange({
      catalogTop: 120,
      columnCount: 3,
      overscanRows: 1,
      providerCount: 600,
      scrollTop: 120 + (providerGridCardHeightPx + providerGridGapPx) * 10,
      viewportHeight: (providerGridCardHeightPx + providerGridGapPx) * 4,
    })

    expect(range.startIndex).toBe(27)
    expect(range.endIndex).toBe(45)
    expect(range.topOffset).toBe((providerGridCardHeightPx + providerGridGapPx) * 9)
  })

  it("clamps stale scroll positions after filtering to a shorter list", () => {
    const range = getProviderGridVisibleRange({
      catalogTop: 0,
      columnCount: 3,
      overscanRows: 1,
      providerCount: 12,
      scrollTop: 20_000,
      viewportHeight: providerGridCardHeightPx,
    })

    expect(range.startIndex).toBe(6)
    expect(range.endIndex).toBe(12)
  })
})
