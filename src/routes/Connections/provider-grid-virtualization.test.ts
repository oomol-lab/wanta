import { describe, expect, it } from "vitest"
import {
  getProviderGridCenteredScrollTop,
  getProviderGridColumnCount,
  getProviderGridKeyboardTargetIndex,
  getProviderGridRowCount,
  getProviderGridTotalHeight,
  getProviderGridVisibleRange,
  providerGridCardHeightPx,
  providerGridGapPx,
} from "./provider-grid-virtualization.ts"

it("centers the selected card using the reflowed column count", () => {
  expect(
    getProviderGridCenteredScrollTop({
      catalogTop: 120,
      columnCount: 1,
      itemIndex: 14,
      scrollHeight: 4_000,
      viewportHeight: 600,
    }),
  ).toBe(918)
  expect(
    getProviderGridCenteredScrollTop({
      catalogTop: 120,
      columnCount: 3,
      itemIndex: 14,
      scrollHeight: 4_000,
      viewportHeight: 600,
    }),
  ).toBe(158)
})

it("centered selection scroll position clamps to the list boundaries", () => {
  expect(
    getProviderGridCenteredScrollTop({
      catalogTop: 20,
      columnCount: 1,
      itemIndex: 0,
      scrollHeight: 1_200,
      viewportHeight: 600,
    }),
  ).toBe(0)
  expect(
    getProviderGridCenteredScrollTop({
      catalogTop: 20,
      columnCount: 1,
      itemIndex: 100,
      scrollHeight: 1_200,
      viewportHeight: 600,
    }),
  ).toBe(600)
})

it("centers based on the supplied item index", () => {
  const withoutLeadingCard = getProviderGridCenteredScrollTop({
    catalogTop: 200,
    columnCount: 3,
    itemIndex: 2,
    scrollHeight: 2_000,
    viewportHeight: 100,
  })
  const withLeadingCard = getProviderGridCenteredScrollTop({
    catalogTop: 200,
    columnCount: 3,
    itemIndex: 3,
    scrollHeight: 2_000,
    viewportHeight: 100,
  })

  expect(withLeadingCard - withoutLeadingCard).toBe(providerGridCardHeightPx + providerGridGapPx)
})

describe("provider grid virtualization", () => {
  it("supports roving keyboard focus across virtualized rows", () => {
    expect(
      getProviderGridKeyboardTargetIndex({ columnCount: 3, currentIndex: 4, key: "ArrowDown", providerCount: 10 }),
    ).toBe(7)
    expect(
      getProviderGridKeyboardTargetIndex({ columnCount: 3, currentIndex: 1, key: "ArrowUp", providerCount: 10 }),
    ).toBe(1)
    expect(getProviderGridKeyboardTargetIndex({ columnCount: 3, currentIndex: 4, key: "End", providerCount: 10 })).toBe(
      9,
    )
    expect(
      getProviderGridKeyboardTargetIndex({ columnCount: 3, currentIndex: 4, key: "Tab", providerCount: 10 }),
    ).toBeNull()
  })

  it("keeps arrow navigation inside visual grid boundaries", () => {
    expect(
      getProviderGridKeyboardTargetIndex({ columnCount: 3, currentIndex: 3, key: "ArrowLeft", providerCount: 10 }),
    ).toBe(3)
    expect(
      getProviderGridKeyboardTargetIndex({ columnCount: 3, currentIndex: 2, key: "ArrowRight", providerCount: 10 }),
    ).toBe(2)
    expect(
      getProviderGridKeyboardTargetIndex({ columnCount: 3, currentIndex: 8, key: "ArrowDown", providerCount: 10 }),
    ).toBe(8)
    expect(
      getProviderGridKeyboardTargetIndex({ columnCount: 3, currentIndex: 6, key: "ArrowDown", providerCount: 10 }),
    ).toBe(9)
  })

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

  it("clamps negative overscan rows", () => {
    const range = getProviderGridVisibleRange({
      catalogTop: 0,
      columnCount: 3,
      overscanRows: -10,
      providerCount: 30,
      scrollTop: providerGridCardHeightPx + providerGridGapPx,
      viewportHeight: providerGridCardHeightPx,
    })

    expect(range.startIndex).toBe(3)
    expect(range.endIndex).toBe(6)
  })
})
