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
}

export interface BuiltinModelDefinition {
  id: BuiltinModelId
  displayName: string
  providerName: string
  runtime: BuiltinModelRuntime
  capabilities: BuiltinModelCapabilities
}

export const BUILTIN_MODEL_IDS = [
  "oopilot",
  "gpt-5.5",
  "deepseek-v4-flash",
  "deepseek-v4-pro",
  "qwen3.7-plus",
  "kimi/kimi-k2.7-code-highspeed",
  "kimi/kimi-k2.7-code",
  "ZHIPU/GLM-5.2",
  "qwen3.7-max",
  "xiaomi/mimo-v2.5-pro",
] as const

export type BuiltinModelId = (typeof BUILTIN_MODEL_IDS)[number]

export const DEFAULT_BUILTIN_MODEL_ID: BuiltinModelId = "gpt-5.5"

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
      supportsImages: true,
      toolCall: true,
    },
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
      supportsImages: true,
      toolCall: true,
    },
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
      supportsImages: false,
      toolCall: true,
    },
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
      supportsImages: false,
      toolCall: true,
    },
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
      supportsImages: true,
      toolCall: true,
    },
  },
  {
    id: "kimi/kimi-k2.7-code-highspeed",
    displayName: "Kimi K2.7 Code Fast",
    providerName: "Kimi",
    runtime: {
      providerID: "oomol",
      modelID: "kimi/kimi-k2.7-code-highspeed",
    },
    capabilities: {
      supportsImages: true,
      toolCall: true,
    },
  },
  {
    id: "kimi/kimi-k2.7-code",
    displayName: "Kimi K2.7 Code",
    providerName: "Kimi",
    runtime: {
      providerID: "oomol",
      modelID: "kimi/kimi-k2.7-code",
    },
    capabilities: {
      supportsImages: true,
      toolCall: true,
    },
  },
  {
    id: "ZHIPU/GLM-5.2",
    displayName: "GLM-5.2",
    providerName: "ZHIPU",
    runtime: {
      providerID: "oomol",
      modelID: "ZHIPU/GLM-5.2",
    },
    capabilities: {
      supportsImages: false,
      toolCall: true,
    },
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
      supportsImages: true,
      toolCall: true,
    },
  },
  {
    id: "xiaomi/mimo-v2.5-pro",
    displayName: "Xiaomi MiMo V2.5 Pro",
    providerName: "Xiaomi",
    runtime: {
      providerID: "oomol",
      modelID: "xiaomi/mimo-v2.5-pro",
    },
    capabilities: {
      supportsImages: false,
      toolCall: true,
    },
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
}> {
  return BUILTIN_MODEL_DEFINITIONS.map((model) => ({
    id: model.id,
    displayName: model.displayName,
    providerName: model.providerName,
    supportsImages: model.capabilities.supportsImages,
    toolCall: model.capabilities.toolCall,
    runtimeKind: resolveBuiltinProvider(model.runtime.providerID).kind,
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
