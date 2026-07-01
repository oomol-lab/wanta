import type { ReasoningLevel } from "../../../electron/chat/common.ts"
import type { ModelCatalog } from "../../../electron/models/common.ts"

import { WANTA_REASONING_LEVELS, WANTA_REASONING_VARIANT_LEVELS } from "../../../electron/agent/reasoning.ts"

const reasoningLevelOptions: readonly ReasoningLevel[] = WANTA_REASONING_LEVELS

export function selectedModelReasoningLevels(catalog: ModelCatalog | null): ReasoningLevel[] {
  if (!catalog) {
    return [...reasoningLevelOptions]
  }
  const variants =
    catalog.selected.kind === "custom"
      ? catalog.customModels.find((model) => model.id === catalog.selected.id)?.reasoningVariants
      : catalog.builtins.find((model) => model.id === catalog.selected.id)?.reasoningVariants
  const supported = new Set(variants ?? [])
  return ["default", ...WANTA_REASONING_VARIANT_LEVELS.filter((level) => supported.has(level))]
}
