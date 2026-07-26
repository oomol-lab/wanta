import type { ModelCatalog } from "../../../electron/models/common.ts"

import { describe, expect, it } from "vitest"
import {
  buildModelMenuItems,
  combinedModelReasoningLabel,
  modelReasoningTriggerLabel,
  selectedModelSummary,
} from "./model-control-options.ts"
import { llmBaseUrl } from "@/lib/domain"

const catalog: ModelCatalog = {
  selected: { kind: "builtin", id: "gpt-5.6-sol" },
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
      id: "gpt-5.6-sol",
      displayName: "GPT 5.6 Sol",
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
    expect(selectedModelSummary(catalog)).toEqual({ kind: "builtin", label: "GPT 5.6 Sol", supportsImages: true })
  })

  it("falls back to Auto before the catalog loads", () => {
    expect(selectedModelSummary(null)).toEqual({ kind: "builtin", label: "Auto", supportsImages: true })
  })

  it("builds built-in, custom, and add rows in order", () => {
    expect(buildModelMenuItems(catalog, "Configure").map((item) => item.id)).toEqual([
      "builtin:oopilot",
      "builtin:gpt-5.6-sol",
      "custom:custom-1",
      "action:add",
    ])
  })

  it("labels the GPT 5.6 family by capability tier", () => {
    const tierCatalog: ModelCatalog = {
      ...catalog,
      builtins: [
        ...catalog.builtins,
        {
          ...catalog.builtins[1],
          id: "gpt-5.6-terra",
          displayName: "GPT 5.6 Terra",
        },
        {
          ...catalog.builtins[1],
          id: "gpt-5.6-luna",
          displayName: "GPT 5.6 Luna",
        },
      ],
    }
    expect(
      buildModelMenuItems(tierCatalog, "Configure")
        .filter((item) => item.kind === "builtin")
        .map((item) => [item.choice.id, item.tier]),
    ).toEqual([
      ["oopilot", undefined],
      ["gpt-5.6-sol", "high"],
      ["gpt-5.6-terra", "medium"],
      ["gpt-5.6-luna", "low"],
    ])
  })

  it("preserves BYOK identity for custom model presentation", () => {
    const customCatalog: ModelCatalog = { ...catalog, selected: { kind: "custom", id: "custom-1" } }
    expect(selectedModelSummary(customCatalog)).toEqual({
      kind: "custom",
      label: "Custom Model",
      supportsImages: false,
    })
    expect(buildModelMenuItems(customCatalog, "Configure").find((item) => item.kind === "custom")).toMatchObject({
      kind: "custom",
      title: "Custom Model",
    })
  })

  it("combines model and reasoning labels for the compact trigger", () => {
    expect(combinedModelReasoningLabel("GPT 5.6 Sol", "High")).toBe("GPT 5.6 Sol · High")
  })

  it("shows the configuration prompt instead of a fallback model when a model is required", () => {
    expect(
      modelReasoningTriggerLabel({
        modelLabel: "Auto",
        modelRequired: true,
        modelRequiredLabel: "Select or configure model",
        reasoningLabel: "Default",
      }),
    ).toBe("Select or configure model")
  })
})
