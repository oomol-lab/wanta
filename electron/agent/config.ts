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
  variants?: Record<string, { reasoningEffort: string }>
}
type OpencodeAgentConfig = NonNullable<NonNullable<Config["agent"]>[string]>
type OpencodePermissionConfig = NonNullable<OpencodeAgentConfig["permission"]>
type OpencodeReasoningVariantConfig = { reasoningEffort: string }

export const WANTA_PROVIDER_ID = resolveBuiltinModel(DEFAULT_BUILTIN_MODEL_ID).runtime.providerID
export const WANTA_MODEL_ID = resolveBuiltinModel(DEFAULT_BUILTIN_MODEL_ID).runtime.modelID

export interface OpencodeCustomModel {
  id: string
  providerName: string
  baseUrl: string
  apiKey: string
  modelName: string
  displayName?: string
  supportsImages?: boolean
}

// 全量放开内置工具 + 权限：bash/read/write/edit/grep/glob/list/webfetch/task/todo* 与自定义
// 连接器工具并存。permission 全 allow——本应用未接入 OpenCode 的权限询问 UI，"ask" 会让会话
// 挂起（无人应答），故只能 allow 或 deny；external_directory: allow 让 read/glob/list 等文件
// 工具能访问 workspace cwd（App 私有 scratch 目录）之外的真实文件系统，bash 本就不受此限。
const WANTA_PERMISSION = {
  edit: "allow",
  bash: "allow",
  webfetch: "allow",
  external_directory: "allow",
} as const

// 覆盖 OpenCode 原生 plan agent 时保留其“只读调查，只允许写计划文件”的语义。
const WANTA_PLAN_PERMISSION = {
  bash: {
    "*": "deny",
    "cat *": "allow",
    "head *": "allow",
    "tail *": "allow",
    "sed -n *": "allow",
    "rg *": "allow",
    "grep *": "allow",
    "find *": "allow",
    "ls *": "allow",
    pwd: "allow",
    "git status*": "allow",
    "git diff*": "allow",
    "git log*": "allow",
    "git show*": "allow",
    "git branch*": "allow",
    "git rev-parse*": "allow",
    "git ls-files*": "allow",
    "git grep*": "allow",
    "git remote*": "allow",
  },
  webfetch: "allow",
  external_directory: "allow",
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
        supportsImages: model.supportsImages === true,
        toolCall: true,
      }),
    },
  }
}

function modelCapabilities({
  name,
  reasoningVariants,
  supportsImages,
  toolCall,
}: {
  name: string
  reasoningVariants?: Record<string, OpencodeReasoningVariantConfig>
  supportsImages: boolean
  toolCall: boolean
}): OpencodeModelConfig {
  return {
    name,
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
  const variantSet = model.runtime.providerID === "openai" ? OPENAI_REASONING_VARIANTS : OOMOL_REASONING_VARIANTS
  return Object.fromEntries(levels.map((level) => [level, variantSet[level]]))
}
