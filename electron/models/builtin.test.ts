import assert from "node:assert/strict"
import { test } from "vitest"
import {
  BUILTIN_MODEL_DEFINITIONS,
  BUILTIN_MODEL_IDS,
  BUILTIN_PROVIDER_DEFINITIONS,
  DEFAULT_BUILTIN_MODEL_ID,
  builtinModelSummaries,
  isBuiltinModelId,
  resolveBuiltinModel,
} from "./builtin.ts"
import { DEFAULT_MAX_OUTPUT_TOKENS } from "./limits.ts"

test("built-in model registry has unique ids and matching summaries", () => {
  assert.equal(new Set(BUILTIN_MODEL_IDS).size, BUILTIN_MODEL_IDS.length)
  assert.deepEqual(
    BUILTIN_MODEL_DEFINITIONS.map((model) => model.id),
    [...BUILTIN_MODEL_IDS],
  )
  assert.deepEqual(
    builtinModelSummaries().map((model) => model.id),
    [...BUILTIN_MODEL_IDS],
  )
  assert.deepEqual(
    builtinModelSummaries().map((model) => ({
      id: model.id,
      supportsImages: model.supportsImages,
      supportsPdf: resolveBuiltinModel(model.id).capabilities.supportsPdf,
      toolCall: model.toolCall,
      runtimeKind: model.runtimeKind,
      contextWindow: model.contextWindow,
      inputTokenLimit: model.inputTokenLimit,
      maxOutputTokens: model.maxOutputTokens,
    })),
    [
      {
        id: "oopilot",
        supportsImages: true,
        supportsPdf: false,
        toolCall: true,
        runtimeKind: "openai-compatible",
        contextWindow: 200_000,
        inputTokenLimit: undefined,
        maxOutputTokens: DEFAULT_MAX_OUTPUT_TOKENS,
      },
      {
        id: "gpt-5.6-sol",
        supportsImages: true,
        supportsPdf: true,
        toolCall: true,
        runtimeKind: "openai-responses",
        contextWindow: 400_000,
        inputTokenLimit: 258_400,
        maxOutputTokens: 128_000,
      },
      {
        id: "gpt-5.6-terra",
        supportsImages: true,
        supportsPdf: true,
        toolCall: true,
        runtimeKind: "openai-responses",
        contextWindow: 400_000,
        inputTokenLimit: 258_400,
        maxOutputTokens: 128_000,
      },
      {
        id: "gpt-5.6-luna",
        supportsImages: true,
        supportsPdf: true,
        toolCall: true,
        runtimeKind: "openai-responses",
        contextWindow: 400_000,
        inputTokenLimit: 258_400,
        maxOutputTokens: 128_000,
      },
      {
        id: "gpt-5.5",
        supportsImages: true,
        supportsPdf: true,
        toolCall: true,
        runtimeKind: "openai-responses",
        contextWindow: 400_000,
        inputTokenLimit: 258_400,
        maxOutputTokens: 128_000,
      },
      {
        id: "deepseek-v4-flash",
        supportsImages: false,
        supportsPdf: false,
        toolCall: true,
        runtimeKind: "openai-compatible",
        contextWindow: 1_000_000,
        inputTokenLimit: undefined,
        maxOutputTokens: DEFAULT_MAX_OUTPUT_TOKENS,
      },
      {
        id: "deepseek-v4-pro",
        supportsImages: false,
        supportsPdf: false,
        toolCall: true,
        runtimeKind: "openai-compatible",
        contextWindow: 1_000_000,
        inputTokenLimit: undefined,
        maxOutputTokens: DEFAULT_MAX_OUTPUT_TOKENS,
      },
      {
        id: "qwen3.7-plus",
        supportsImages: true,
        supportsPdf: false,
        toolCall: true,
        runtimeKind: "openai-compatible",
        contextWindow: 1_000_000,
        inputTokenLimit: undefined,
        maxOutputTokens: DEFAULT_MAX_OUTPUT_TOKENS,
      },
      {
        id: "qwen3.7-max",
        supportsImages: true,
        supportsPdf: false,
        toolCall: true,
        runtimeKind: "openai-compatible",
        contextWindow: 1_000_000,
        inputTokenLimit: undefined,
        maxOutputTokens: DEFAULT_MAX_OUTPUT_TOKENS,
      },
    ],
  )
})

test("built-in models reference registered providers", () => {
  const providerIDs = new Set(BUILTIN_PROVIDER_DEFINITIONS.map((provider) => provider.id))

  for (const model of BUILTIN_MODEL_DEFINITIONS) {
    assert.equal(providerIDs.has(model.runtime.providerID), true, `${model.id} uses an unknown provider`)
  }
})

test("built-in provider runtime kinds match OpenCode provider configuration", () => {
  for (const provider of BUILTIN_PROVIDER_DEFINITIONS) {
    if (provider.kind === "openai-compatible") {
      assert.equal(provider.npm, "@ai-sdk/openai-compatible")
    } else {
      assert.equal(provider.kind, "openai-responses")
      assert.equal(provider.npm, undefined)
    }
  }
})

test("default built-in model is Auto on the OOMOL compatible runtime", () => {
  const model = resolveBuiltinModel(DEFAULT_BUILTIN_MODEL_ID)

  assert.equal(DEFAULT_BUILTIN_MODEL_ID, "oopilot")
  assert.equal(model.displayName, "Auto")
  assert.deepEqual(model.runtime, { providerID: "oomol", modelID: "oopilot" })
})

test("Auto built-in model remains on the OOMOL compatible runtime", () => {
  const model = resolveBuiltinModel("oopilot")

  assert.equal(model.displayName, "Auto")
  assert.deepEqual(model.runtime, { providerID: "oomol", modelID: "oopilot" })
})

test("GPT models use OpenAI Responses runtime routing", () => {
  const expectedModels = [
    { id: "gpt-5.6-sol", displayName: "GPT 5.6 Sol" },
    { id: "gpt-5.6-terra", displayName: "GPT 5.6 Terra" },
    { id: "gpt-5.6-luna", displayName: "GPT 5.6 Luna" },
    { id: "gpt-5.5", displayName: "GPT 5.5" },
  ] as const

  for (const expected of expectedModels) {
    const model = resolveBuiltinModel(expected.id)
    assert.equal(model.displayName, expected.displayName)
    assert.deepEqual(model.runtime, { providerID: "openai", modelID: expected.id })
  }
})

test("isBuiltinModelId accepts only registered built-in ids", () => {
  assert.equal(isBuiltinModelId("oopilot"), true)
  assert.equal(isBuiltinModelId("gpt-5.6-sol"), true)
  assert.equal(isBuiltinModelId("gpt-5.6-terra"), true)
  assert.equal(isBuiltinModelId("gpt-5.6-luna"), true)
  assert.equal(isBuiltinModelId("gpt-5.5"), true)
  assert.equal(isBuiltinModelId("qwen3.7-max"), true)
  assert.equal(isBuiltinModelId("kimi/kimi-k2.7-code"), false)
  assert.equal(isBuiltinModelId("gpt-5.5-fast"), false)
})
