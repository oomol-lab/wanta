import type { ReasoningLevel } from "../../../electron/chat/common.ts"

import { WANTA_REASONING_LEVELS } from "../../../electron/agent/reasoning.ts"
import { useT } from "@/i18n/i18n"

export const reasoningLevelOptions: readonly ReasoningLevel[] = WANTA_REASONING_LEVELS

export function providerInitial(name: string): string {
  return (name.trim()[0] ?? "M").toUpperCase()
}

export function clampNumber(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max)
}

export function nextModelMenuIndex(currentIndex: number, itemCount: number, direction: -1 | 1): number {
  return itemCount === 0 ? 0 : (currentIndex + direction + itemCount) % itemCount
}

export function reasoningLevelLabel(level: ReasoningLevel, t: ReturnType<typeof useT>): string {
  switch (level) {
    case "default":
      return t("chat.reasoningLevelDefault")
    case "low":
      return t("chat.reasoningLevelLow")
    case "medium":
      return t("chat.reasoningLevelMedium")
    case "high":
      return t("chat.reasoningLevelHigh")
    case "max":
      return t("chat.reasoningLevelMax")
  }
}
