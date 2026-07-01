import type { ModelCatalog } from "../../../electron/models/common.ts"

import { describe, expect, it } from "vitest"
import { selectedModelReasoningLevels } from "./model-reasoning-levels.ts"
import { llmBaseUrl } from "@/lib/domain"

const catalog: ModelCatalog = {
  selected: { kind: "builtin", id: "oopilot" },
  providers: [],
  builtins: [
    {
      id: "oopilot",
      displayName: "Auto",
      providerName: "OOMOL",
      supportsImages: true,
      toolCall: true,
      runtimeKind: "openai-compatible",
      reasoningVariants: ["high", "low", "high"],
    },
  ],
  customModels: [
    {
      id: "custom-1",
      providerId: "custom",
      providerName: "Custom",
      baseUrl: llmBaseUrl,
      modelName: "custom-model",
      displayName: "Custom Model",
      apiKeyConfigured: true,
      supportsImages: false,
      supportsToolCalls: true,
      reasoningVariants: ["max", "low", "max"],
    },
  ],
}

describe("selectedModelReasoningLevels", () => {
  it("orders built-in reasoning levels by the fixed Wanta order", () => {
    expect(selectedModelReasoningLevels(catalog)).toEqual(["default", "low", "high"])
  })

  it("orders custom reasoning levels by the fixed Wanta order", () => {
    expect(selectedModelReasoningLevels({ ...catalog, selected: { kind: "custom", id: "custom-1" } })).toEqual([
      "default",
      "low",
      "max",
    ])
  })
})
