import type { ModelCatalog } from "../../../electron/models/common.ts"

import { describe, expect, it } from "vitest"
import { buildModelMenuItems, combinedModelReasoningLabel, selectedModelSummary } from "./model-control-options.ts"
import { llmBaseUrl } from "@/lib/domain"

const catalog: ModelCatalog = {
  selected: { kind: "builtin", id: "gpt-5.5" },
  providers: [],
  builtins: [
    {
      id: "oopilot",
      displayName: "Auto",
      providerName: "OOMOL",
      supportsImages: true,
      toolCall: true,
      runtimeKind: "openai-compatible",
    },
    {
      id: "gpt-5.5",
      displayName: "GPT 5.5",
      providerName: "OpenAI",
      supportsImages: true,
      toolCall: true,
      runtimeKind: "openai-responses",
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
    },
  ],
}

describe("model control options", () => {
  it("summarizes the selected built-in model", () => {
    expect(selectedModelSummary(catalog)).toEqual({ label: "GPT 5.5", supportsImages: true })
  })

  it("falls back to Auto before the catalog loads", () => {
    expect(selectedModelSummary(null)).toEqual({ label: "Auto", supportsImages: true })
  })

  it("builds built-in, custom, and add rows in order", () => {
    expect(buildModelMenuItems(catalog, "Configure").map((item) => item.id)).toEqual([
      "builtin:oopilot",
      "builtin:gpt-5.5",
      "custom:custom-1",
      "action:add",
    ])
  })

  it("combines model and reasoning labels for the compact trigger", () => {
    expect(combinedModelReasoningLabel("GPT 5.5", "High")).toBe("GPT 5.5 · High")
  })
})
