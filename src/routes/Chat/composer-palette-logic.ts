import type { PaletteMode } from "./composer-palette-state.ts"
import type { ComposerTriggerKind } from "./composer-triggers.ts"

export type RootPaletteAction = "billing" | "connections" | "insert" | "skills"

export type ComposerPaletteKeyAction =
  | { type: "back" }
  | { type: "dismiss" }
  | { type: "move"; index: number }
  | { type: "open-root-item" }
  | { type: "select" }
  | { type: "none" }

export function nextPaletteIndex(currentIndex: number, itemCount: number, direction: -1 | 1): number {
  return itemCount === 0 ? 0 : (currentIndex + direction + itemCount) % itemCount
}

export function shouldOpenRootPaletteItem(
  triggerKind: ComposerTriggerKind | undefined,
  paletteMode: PaletteMode,
  action: RootPaletteAction | undefined,
): boolean {
  return triggerKind === "slash" && paletteMode === "root" && (action === "skills" || action === "connections")
}

export function resolveComposerPaletteKeyAction({
  activeIndex,
  activeRootAction,
  itemCount,
  key,
  paletteMode,
  triggerKind,
}: {
  activeIndex: number
  activeRootAction?: RootPaletteAction
  itemCount: number
  key: string
  paletteMode: PaletteMode
  triggerKind?: ComposerTriggerKind
}): ComposerPaletteKeyAction {
  switch (key) {
    case "ArrowDown":
      return itemCount > 0 ? { type: "move", index: nextPaletteIndex(activeIndex, itemCount, 1) } : { type: "none" }
    case "ArrowUp":
      return itemCount > 0 ? { type: "move", index: nextPaletteIndex(activeIndex, itemCount, -1) } : { type: "none" }
    case "ArrowLeft":
      return triggerKind === "slash" && paletteMode !== "root" ? { type: "back" } : { type: "none" }
    case "ArrowRight":
      return shouldOpenRootPaletteItem(triggerKind, paletteMode, activeRootAction)
        ? { type: "open-root-item" }
        : { type: "none" }
    case "Enter":
    case "Tab":
      return itemCount > 0 ? { type: "select" } : { type: "none" }
    case "Escape":
      return { type: "dismiss" }
    default:
      return { type: "none" }
  }
}
