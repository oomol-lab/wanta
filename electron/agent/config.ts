import type { BuiltinModelDefinition } from "../models/builtin.ts"
import type { WantaReasoningVariant } from "./reasoning.ts"
import type { Config } from "@opencode-ai/sdk/v2/client"

import { llmBaseUrl } from "../domain.ts"
import {
  BUILTIN_MODEL_DEFINITIONS,
  BUILTIN_PROVIDER_DEFINITIONS,
  DEFAULT_BUILTIN_MODEL_ID,
  resolveBuiltinModel,
} from "../models/builtin.ts"
import { customModelDisplayName } from "../models/store.ts"
import { WANTA_BUILD_AGENT_NAME, WANTA_PLAN_AGENT_NAME } from "./mode.ts"
import { WANTA_PLAN_SYSTEM_PROMPT, WANTA_SYSTEM_PROMPT } from "./system-prompt.ts"

type OpencodeModelConfig = NonNullable<NonNullable<Config["provider"]>[string]["models"]>[string] & {
  limit?: {
    context?: number
    input?: number
    output?: number
  }
  variants?: Record<string, Record<string, unknown>>
}
type OpencodeAgentConfig = NonNullable<NonNullable<Config["agent"]>[string]>
type OpencodePermissionConfig = NonNullable<OpencodeAgentConfig["permission"]>
type OpencodeReasoningVariantConfig = Record<string, unknown>

export const WANTA_PROVIDER_ID = resolveBuiltinModel(DEFAULT_BUILTIN_MODEL_ID).runtime.providerID
export const WANTA_MODEL_ID = resolveBuiltinModel(DEFAULT_BUILTIN_MODEL_ID).runtime.modelID

export interface OpencodeCustomModel {
  id: string
  providerId?: string
  providerName: string
  baseUrl: string
  apiKey: string
  modelName: string
  displayName?: string
  supportsImages?: boolean
  supportsToolCalls?: boolean
  contextWindow?: number
  inputTokenLimit?: number
  maxOutputTokens?: number
  reasoningVariants?: readonly WantaReasoningVariant[]
}

// 内置工具与自定义连接器工具并存；本地 shell、写入和越出私有 scratch workspace
// 的路径访问经 permission ask 进入 Wanta 两档权限 UI。连接器自定义工具不受内置工具 permission 影响。
const WANTA_PERMISSION = {
  edit: "ask",
  bash: {
    "*": "ask",
  },
  webfetch: "allow",
  external_directory: "ask",
} as const

// 覆盖 OpenCode 原生 plan agent 时保留其“不写用户文件”的语义；是否允许本地 shell 仍交给两档权限 UI。
const WANTA_PLAN_PERMISSION = {
  bash: {
    "*": "ask",
  },
  webfetch: "allow",
  external_directory: "ask",
  edit: {
    "*": "deny",
    ".opencode/plans/*.md": "allow",
  },
} as unknown as OpencodePermissionConfig

const OOMOL_REASONING_VARIANTS = {
  low: { reasoningEffort: "low" },
  medium: { reasoningEffort: "medium" },
  high: { reasoningEffort: "high" },
  max: { reasoningEffort: "max" },
} as const satisfies Record<WantaReasoningVariant, OpencodeReasoningVariantConfig>

const OPENAI_REASONING_VARIANTS = {
  low: { reasoningEffort: "low" },
  medium: { reasoningEffort: "medium" },
  high: { reasoningEffort: "high" },
  max: { reasoningEffort: "xhigh" },
} as const satisfies Record<WantaReasoningVariant, OpencodeReasoningVariantConfig>

const QWEN_REASONING_VARIANTS = {
  low: { enable_thinking: false },
  high: { enable_thinking: true },
} as const satisfies Partial<Record<WantaReasoningVariant, OpencodeReasoningVariantConfig>>

export interface OpencodeConfigOptions {
  /** 网关鉴权凭证：现为会话 token（网关层接受 cookie/token/api-key）。仅入内存 env，不落盘。 */
  authToken: string
  customModels?: OpencodeCustomModel[]
}

/** 构建 OpenCode 配置（经 OPENCODE_CONFIG_CONTENT 内联注入；authToken 仅入内存 env，不落盘）。 */
export function buildOpencodeConfig({ authToken, customModels = [] }: OpencodeConfigOptions): Config {
  return {
    $schema: "https://opencode.ai/config.json",
    model: `${WANTA_PROVIDER_ID}/${WANTA_MODEL_ID}`,
    provider: {
      ...builtinProviderConfigs(authToken),
      ...Object.fromEntries(customModels.map((model) => [customProviderId(model.id), customProviderConfig(model)])),
    },
    agent: {
      [WANTA_BUILD_AGENT_NAME]: {
        description: "OOMOL connector + local coding assistant",
        mode: "primary",
        prompt: WANTA_SYSTEM_PROMPT,
        // 不再下发 tools 禁用表：所有内置工具默认启用。
        permission: WANTA_PERMISSION,
      },
      [WANTA_PLAN_AGENT_NAME]: {
        description: "Plan mode. Disallows edit tools and produces an implementation plan.",
        mode: "primary",
        prompt: WANTA_PLAN_SYSTEM_PROMPT,
        permission: WANTA_PLAN_PERMISSION,
      },
    },
    permission: WANTA_PERMISSION,
  }
}

export function customProviderId(id: string): string {
  return `wanta-custom-${id}`
}

function builtinProviderConfigs(authToken: string): NonNullable<Config["provider"]> {
  return Object.fromEntries(
    BUILTIN_PROVIDER_DEFINITIONS.map((provider) => [
      provider.id,
      {
        name: provider.displayName,
        ...(provider.npm ? { npm: provider.npm } : {}),
        options: {
          baseURL: llmBaseUrl,
          // SDK 字段名固定为 apiKey（外部契约）；值是会话 token，网关层统一鉴权。
          apiKey: authToken,
        },
        models: Object.fromEntries(
          BUILTIN_MODEL_DEFINITIONS.filter((model) => model.runtime.providerID === provider.id).map((model) => [
            model.runtime.modelID,
            modelCapabilities({
              name: model.displayName,
              contextWindow: model.contextWindow,
              inputTokenLimit: model.inputTokenLimit,
              maxOutputTokens: model.maxOutputTokens,
              reasoningVariants: builtinReasoningVariants(model),
              supportsImages: model.capabilities.supportsImages,
              toolCall: model.capabilities.toolCall,
            }),
          ]),
        ),
      },
    ]),
  )
}

function customProviderConfig(model: OpencodeCustomModel): NonNullable<Config["provider"]>[string] {
  return {
    name: model.providerName,
    npm: "@ai-sdk/openai-compatible",
    options: {
      baseURL: model.baseUrl,
      apiKey: model.apiKey,
    },
    models: {
      [model.modelName]: modelCapabilities({
        name: customModelDisplayName(model),
        contextWindow: model.contextWindow,
        inputTokenLimit: model.inputTokenLimit,
        maxOutputTokens: model.maxOutputTokens,
        reasoningVariants: customReasoningVariants(model),
        supportsImages: model.supportsImages === true,
        toolCall: model.supportsToolCalls !== false,
      }),
    },
  }
}

function modelCapabilities({
  name,
  contextWindow,
  inputTokenLimit,
  maxOutputTokens,
  reasoningVariants,
  supportsImages,
  toolCall,
}: {
  name: string
  contextWindow?: number
  inputTokenLimit?: number
  maxOutputTokens?: number
  reasoningVariants?: Record<string, OpencodeReasoningVariantConfig>
  supportsImages: boolean
  toolCall: boolean
}): OpencodeModelConfig {
  const limitContext = contextWindow ?? inputTokenLimit
  const limit =
    limitContext && maxOutputTokens
      ? {
          context: limitContext,
          ...(inputTokenLimit ? { input: inputTokenLimit } : {}),
          output: maxOutputTokens,
        }
      : undefined
  return {
    name,
    ...(limit ? { limit } : {}),
    ...(reasoningVariants
      ? {
          reasoning: true,
          variants: reasoningVariants,
        }
      : {}),
    tool_call: toolCall,
    ...(supportsImages
      ? {
          attachment: true,
          modalities: {
            input: ["text", "image"],
            output: ["text"],
          },
        }
      : {}),
  }
}

function builtinReasoningVariants(
  model: BuiltinModelDefinition,
): Record<string, OpencodeReasoningVariantConfig> | undefined {
  const levels = model.capabilities.reasoningVariants
  if (!levels || levels.length === 0) {
    return undefined
  }
  const variantSet: Partial<Record<WantaReasoningVariant, OpencodeReasoningVariantConfig>> =
    model.providerName === "Qwen"
      ? QWEN_REASONING_VARIANTS
      : model.runtime.providerID === "openai"
        ? OPENAI_REASONING_VARIANTS
        : OOMOL_REASONING_VARIANTS
  return Object.fromEntries(
    levels.flatMap((level) => {
      const variant = variantSet[level]
      return variant ? [[level, variant]] : []
    }),
  )
}

function customReasoningVariants(
  model: OpencodeCustomModel,
): Record<string, OpencodeReasoningVariantConfig> | undefined {
  const levels = model.reasoningVariants
  if (!levels || levels.length === 0) {
    return undefined
  }
  const variantSet: Partial<Record<WantaReasoningVariant, OpencodeReasoningVariantConfig>> = isQwenCustomModel(model)
    ? QWEN_REASONING_VARIANTS
    : OOMOL_REASONING_VARIANTS
  return Object.fromEntries(
    levels.flatMap((level) => {
      const variant = variantSet[level]
      return variant ? [[level, variant]] : []
    }),
  )
}

function isQwenCustomModel(model: OpencodeCustomModel): boolean {
  return (
    model.providerId === "qwen" ||
    model.providerName.trim().toLowerCase() === "qwen" ||
    model.modelName.trim().toLowerCase().startsWith("qwen")
  )
}
