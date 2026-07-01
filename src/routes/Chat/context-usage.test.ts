import type { ChatMessage } from "../../../electron/chat/common.ts"
import type { ModelCatalog } from "../../../electron/models/common.ts"

import { describe, expect, it } from "vitest"
import {
  buildContextUsageInfo,
  contextTokensFromUsage,
  formatTokenCount,
  latestContextTokenUsage,
  selectedModelContextWindow,
} from "./context-usage.ts"

const catalog: ModelCatalog = {
  selected: { kind: "builtin", id: "oopilot" },
  providers: [],
  customModels: [],
  builtins: [
    {
      id: "oopilot",
      displayName: "Auto",
      providerName: "OOMOL",
      supportsImages: true,
      toolCall: true,
      runtimeKind: "openai-compatible",
      contextWindow: 200_000,
    },
  ],
}

describe("chat context usage", () => {
  it("uses the latest assistant token usage snapshot", () => {
    const messages: ChatMessage[] = [
      {
        id: "assistant-1",
        role: "assistant",
        createdAt: 1,
        parts: [],
        tokenUsage: { input: 100, output: 20, reasoning: 0, cache: { read: 10, write: 0 } },
      },
      {
        id: "user-1",
        role: "user",
        createdAt: 2,
        parts: [],
      },
      {
        id: "assistant-2",
        role: "assistant",
        createdAt: 3,
        parts: [],
        tokenUsage: { input: 1000, output: 200, reasoning: 50, cache: { read: 300, write: 25 } },
      },
    ]

    expect(latestContextTokenUsage(messages)).toEqual(messages[2]?.tokenUsage)
    expect(buildContextUsageInfo(messages, catalog)).toEqual({
      usedTokens: 1575,
      limitTokens: 200_000,
      percent: 1,
    })
  })

  it("adds token components from one assistant usage snapshot", () => {
    expect(
      contextTokensFromUsage({
        input: 10,
        output: 3,
        reasoning: 2,
        cache: { read: 5, write: 1 },
      }),
    ).toBe(21)
  })

  it("does not invent a percentage for custom models without a known context window", () => {
    const customCatalog: ModelCatalog = {
      ...catalog,
      selected: { kind: "custom", id: "custom-1" },
      customModels: [
        {
          id: "custom-1",
          providerId: "custom",
          providerName: "Custom",
          baseUrl: "",
          modelName: "custom-model",
          displayName: "Custom",
          apiKeyConfigured: true,
          supportsImages: false,
          supportsToolCalls: true,
        },
      ],
    }
    const messages: ChatMessage[] = [
      {
        id: "assistant-1",
        role: "assistant",
        createdAt: 1,
        parts: [],
        tokenUsage: { input: 1500, output: 200, reasoning: 0, cache: { read: 0, write: 0 } },
      },
    ]

    expect(selectedModelContextWindow(customCatalog)).toBeUndefined()
    expect(buildContextUsageInfo(messages, customCatalog)).toEqual({ usedTokens: 1700 })
  })

  it("uses a custom model context window when configured", () => {
    const customCatalog: ModelCatalog = {
      ...catalog,
      selected: { kind: "custom", id: "custom-1" },
      customModels: [
        {
          id: "custom-1",
          providerId: "custom",
          providerName: "Custom",
          baseUrl: "",
          modelName: "custom-model",
          displayName: "Custom",
          apiKeyConfigured: true,
          supportsImages: false,
          supportsToolCalls: true,
          contextWindow: 10_000,
        },
      ],
    }
    const messages: ChatMessage[] = [
      {
        id: "assistant-1",
        role: "assistant",
        createdAt: 1,
        parts: [],
        tokenUsage: { input: 1500, output: 500, reasoning: 0, cache: { read: 0, write: 0 } },
      },
    ]

    expect(selectedModelContextWindow(customCatalog)).toBe(10_000)
    expect(buildContextUsageInfo(messages, customCatalog)).toEqual({
      usedTokens: 2000,
      limitTokens: 10_000,
      percent: 20,
    })
  })

  it("prefers the input token limit over the full context window", () => {
    const customCatalog: ModelCatalog = {
      ...catalog,
      selected: { kind: "custom", id: "custom-1" },
      customModels: [
        {
          id: "custom-1",
          providerId: "custom",
          providerName: "Custom",
          baseUrl: "",
          modelName: "custom-model",
          displayName: "Custom",
          apiKeyConfigured: true,
          supportsImages: false,
          supportsToolCalls: true,
          contextWindow: 1_000_000,
          inputTokenLimit: 128_000,
        },
      ],
    }

    expect(selectedModelContextWindow(customCatalog)).toBe(128_000)
  })

  it("formats compact token counts", () => {
    expect(formatTokenCount(42)).toBe("42")
    expect(formatTokenCount(1200)).toBe("1.2K")
    expect(formatTokenCount(12_000)).toBe("12K")
    expect(formatTokenCount(999_950)).toBe("1M")
    expect(formatTokenCount(1_500_000)).toBe("1.5M")
  })
})
