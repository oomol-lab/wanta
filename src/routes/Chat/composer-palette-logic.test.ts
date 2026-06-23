import { describe, expect, it } from "vitest"
import {
  nextPaletteIndex,
  resolveComposerPaletteKeyAction,
  shouldOpenRootPaletteItem,
} from "./composer-palette-logic.ts"

describe("composer palette logic", () => {
  it("wraps keyboard navigation over palette items", () => {
    expect(nextPaletteIndex(0, 3, 1)).toBe(1)
    expect(nextPaletteIndex(2, 3, 1)).toBe(0)
    expect(nextPaletteIndex(0, 3, -1)).toBe(2)
    expect(nextPaletteIndex(4, 0, 1)).toBe(0)
  })

  it("opens root subpalettes only for slash skills and connections items", () => {
    expect(shouldOpenRootPaletteItem("slash", "root", "skills")).toBe(true)
    expect(shouldOpenRootPaletteItem("slash", "root", "connections")).toBe(true)
    expect(shouldOpenRootPaletteItem("slash", "root", "creator-skill")).toBe(false)
    expect(shouldOpenRootPaletteItem("skill", "skills", "skills")).toBe(false)
  })

  it("resolves keyboard actions without UI state mutation", () => {
    expect(
      resolveComposerPaletteKeyAction({
        activeIndex: 0,
        itemCount: 2,
        key: "ArrowDown",
        paletteMode: "root",
        triggerKind: "slash",
      }),
    ).toEqual({ type: "move", index: 1 })

    expect(
      resolveComposerPaletteKeyAction({
        activeIndex: 0,
        itemCount: 2,
        key: "ArrowRight",
        paletteMode: "root",
        triggerKind: "slash",
        activeRootAction: "connections",
      }),
    ).toEqual({ type: "open-root-item" })

    expect(
      resolveComposerPaletteKeyAction({
        activeIndex: 0,
        itemCount: 2,
        key: "ArrowLeft",
        paletteMode: "connections",
        triggerKind: "slash",
      }),
    ).toEqual({ type: "back" })

    expect(
      resolveComposerPaletteKeyAction({
        activeIndex: 0,
        itemCount: 0,
        key: "ArrowDown",
        paletteMode: "root",
        triggerKind: "slash",
      }),
    ).toEqual({ type: "none" })

    expect(
      resolveComposerPaletteKeyAction({
        activeIndex: 0,
        itemCount: 0,
        key: "ArrowUp",
        paletteMode: "root",
        triggerKind: "slash",
      }),
    ).toEqual({ type: "none" })

    expect(
      resolveComposerPaletteKeyAction({
        activeIndex: 0,
        itemCount: 0,
        key: "Enter",
        paletteMode: "root",
        triggerKind: "slash",
      }),
    ).toEqual({ type: "none" })

    expect(
      resolveComposerPaletteKeyAction({
        activeIndex: 0,
        itemCount: 0,
        key: "Escape",
        paletteMode: "root",
        triggerKind: "slash",
      }),
    ).toEqual({ type: "dismiss" })
  })
})
