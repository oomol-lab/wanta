import type { WantaReasoningVariant } from "../agent/reasoning.ts"

import { WANTA_REASONING_VARIANT_LEVELS } from "../agent/reasoning.ts"
import { branding } from "../branding.ts"

export type BuiltinProviderKind = "openai-compatible" | "openai-responses"

export interface BuiltinProviderDefinition {
  id: string
  displayName: string
  kind: BuiltinProviderKind
  npm?: string
}

export interface BuiltinModelRuntime {
  providerID: string
  modelID: string
}

export interface BuiltinModelCapabilities {
  supportsImages: boolean
  toolCall: boolean
  reasoningVariants?: readonly WantaReasoningVariant[]
}

export interface BuiltinModelDefinition {
  id: BuiltinModelId
  displayName: string
  providerName: string
  runtime: BuiltinModelRuntime
  capabilities: BuiltinModelCapabilities
  contextWindow?: number
  inputTokenLimit?: number
  maxOutputTokens?: number
}

// UI 展示用的内置模型上下文窗口；网关别名实际窗口调整时只改这里。
const autoContextWindow = 200_000
const gpt55ContextWindow = 400_000
const gpt55InputTokenLimit = 258_400
const gpt55MaxOutputTokens = 128_000
const millionTokenContextWindow = 1_000_000
const deepSeekV4ReasoningVariants = ["low", "high", "max"] as const satisfies readonly WantaReasoningVariant[]
const qwen37ReasoningVariants = ["low", "high"] as const satisfies readonly WantaReasoningVariant[]

export const BUILTIN_MODEL_IDS = [
  "oopilot",
  "gpt-5.5",
  "deepseek-v4-flash",
  "deepseek-v4-pro",
  "qwen3.7-plus",
  "qwen3.7-max",
] as const

export type BuiltinModelId = (typeof BUILTIN_MODEL_IDS)[number]

export const DEFAULT_BUILTIN_MODEL_ID: BuiltinModelId = "oopilot"

export const BUILTIN_PROVIDER_DEFINITIONS: BuiltinProviderDefinition[] = [
  {
    id: "oomol",
    displayName: branding.organizationName,
    kind: "openai-compatible",
    npm: "@ai-sdk/openai-compatible",
  },
  {
    id: "openai",
    displayName: "OpenAI",
    kind: "openai-responses",
  },
]

export const BUILTIN_MODEL_DEFINITIONS: BuiltinModelDefinition[] = [
  {
    id: "oopilot",
    displayName: "Auto",
    providerName: branding.organizationName,
    runtime: {
      providerID: "oomol",
      modelID: "oopilot",
    },
    capabilities: {
      reasoningVariants: WANTA_REASONING_VARIANT_LEVELS,
      supportsImages: true,
      toolCall: true,
    },
    contextWindow: autoContextWindow,
  },
  {
    id: "gpt-5.5",
    displayName: "GPT 5.5",
    providerName: "OpenAI",
    runtime: {
      providerID: "openai",
      modelID: "gpt-5.5",
    },
    capabilities: {
      reasoningVariants: WANTA_REASONING_VARIANT_LEVELS,
      supportsImages: true,
      toolCall: true,
    },
    contextWindow: gpt55ContextWindow,
    inputTokenLimit: gpt55InputTokenLimit,
    maxOutputTokens: gpt55MaxOutputTokens,
  },
  {
    id: "deepseek-v4-flash",
    displayName: "DeepSeek V4 Flash",
    providerName: "DeepSeek",
    runtime: {
      providerID: "oomol",
      modelID: "deepseek-v4-flash",
    },
    capabilities: {
      reasoningVariants: deepSeekV4ReasoningVariants,
      supportsImages: false,
      toolCall: true,
    },
    contextWindow: millionTokenContextWindow,
  },
  {
    id: "deepseek-v4-pro",
    displayName: "DeepSeek V4 Pro",
    providerName: "DeepSeek",
    runtime: {
      providerID: "oomol",
      modelID: "deepseek-v4-pro",
    },
    capabilities: {
      reasoningVariants: deepSeekV4ReasoningVariants,
      supportsImages: false,
      toolCall: true,
    },
    contextWindow: millionTokenContextWindow,
  },
  {
    id: "qwen3.7-plus",
    displayName: "Qwen 3.7 Plus",
    providerName: "Qwen",
    runtime: {
      providerID: "oomol",
      modelID: "qwen3.7-plus",
    },
    capabilities: {
      reasoningVariants: qwen37ReasoningVariants,
      supportsImages: true,
      toolCall: true,
    },
    contextWindow: millionTokenContextWindow,
  },
  {
    id: "qwen3.7-max",
    displayName: "Qwen 3.7 Max",
    providerName: "Qwen",
    runtime: {
      providerID: "oomol",
      modelID: "qwen3.7-max",
    },
    capabilities: {
      reasoningVariants: qwen37ReasoningVariants,
      supportsImages: true,
      toolCall: true,
    },
    contextWindow: millionTokenContextWindow,
  },
]

const builtinModelById = new Map(BUILTIN_MODEL_DEFINITIONS.map((model) => [model.id, model]))

export function builtinModelSummaries(): Array<{
  id: BuiltinModelId
  displayName: string
  providerName: string
  supportsImages: boolean
  toolCall: boolean
  runtimeKind: BuiltinProviderKind
  contextWindow?: number
  inputTokenLimit?: number
  maxOutputTokens?: number
  reasoningVariants?: readonly WantaReasoningVariant[]
}> {
  return BUILTIN_MODEL_DEFINITIONS.map((model) => ({
    id: model.id,
    displayName: model.displayName,
    providerName: model.providerName,
    supportsImages: model.capabilities.supportsImages,
    toolCall: model.capabilities.toolCall,
    runtimeKind: resolveBuiltinProvider(model.runtime.providerID).kind,
    ...(model.contextWindow ? { contextWindow: model.contextWindow } : {}),
    ...(model.inputTokenLimit ? { inputTokenLimit: model.inputTokenLimit } : {}),
    ...(model.maxOutputTokens ? { maxOutputTokens: model.maxOutputTokens } : {}),
    ...(model.capabilities.reasoningVariants ? { reasoningVariants: model.capabilities.reasoningVariants } : {}),
  }))
}

export function builtinProviderDefinition(id: string): BuiltinProviderDefinition | undefined {
  return BUILTIN_PROVIDER_DEFINITIONS.find((provider) => provider.id === id)
}

function resolveBuiltinProvider(id: string): BuiltinProviderDefinition {
  const provider = builtinProviderDefinition(id)
  if (!provider) {
    throw new Error(`Unknown built-in provider: ${id}`)
  }
  return provider
}

export function isBuiltinModelId(value: string): value is BuiltinModelId {
  return (BUILTIN_MODEL_IDS as readonly string[]).includes(value)
}

export function resolveBuiltinModel(id: BuiltinModelId): BuiltinModelDefinition {
  const model = builtinModelById.get(id)
  if (!model) {
    throw new Error(`Unknown built-in model: ${id}`)
  }
  return model
}
