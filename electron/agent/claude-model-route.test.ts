import { describe, expect, it } from "vitest"
import { resolveClaudeModelRoute } from "./claude-model-route.ts"

describe("resolveClaudeModelRoute", () => {
  it("routes built-in choices through the Wanta account without exposing a Claude credential", () => {
    const route = resolveClaudeModelRoute({
      accountSessionToken: "wanta-session-token",
      choice: { kind: "builtin", id: "gpt-5.6-sol" },
      customModels: [],
      reasoningLevel: "high",
    })
    expect(route).toMatchObject({
      apiKey: "wanta-session-token",
      modelId: "gpt-5.6-sol",
      providerKind: "openai-responses",
      reasoningLevel: "high",
    })
  })

  it("routes a selected BYOK model using its safe-storage runtime credential", () => {
    const route = resolveClaudeModelRoute({
      choice: { kind: "custom", id: "custom-1" },
      customModels: [
        {
          id: "custom-1",
          providerId: "openrouter",
          providerName: "OpenRouter",
          baseUrl: "https://openrouter.example/v1",
          modelName: "vendor/model",
          apiKey: "byok-secret",
          apiKeyConfigured: true,
        },
      ],
    })
    expect(route).toMatchObject({
      apiKey: "byok-secret",
      baseUrl: "https://openrouter.example/v1",
      modelId: "vendor/model",
      providerKind: "openai-compatible",
    })
  })

  it("fails clearly when a built-in model has no Wanta account route", () => {
    expect(() => resolveClaudeModelRoute({ choice: { kind: "builtin", id: "oopilot" }, customModels: [] })).toThrow(
      /Sign in to Wanta/u,
    )
  })
})
