import type { Config } from "@opencode-ai/sdk"

import { llmBaseUrl } from "../domain.ts"
import {
  BUILTIN_MODEL_DEFINITIONS,
  BUILTIN_PROVIDER_DEFINITIONS,
  DEFAULT_BUILTIN_MODEL_ID,
  resolveBuiltinModel,
} from "../models/builtin.ts"
import { customModelDisplayName } from "../models/store.ts"
import { WANTA_SYSTEM_PROMPT } from "./system-prompt.ts"

type OpencodeModelConfig = NonNullable<NonNullable<Config["provider"]>[string]["models"]>[string] & {
  variants?: Record<string, { reasoningEffort: string }>
}

// OpenCode 内部标识（产品内部约定，可随品牌改，但 OO_/connector 协议契约不改）。
export const WANTA_AGENT_NAME = "wanta"
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

const WANTA_REASONING_VARIANTS = {
  low: { reasoningEffort: "low" },
  medium: { reasoningEffort: "medium" },
  high: { reasoningEffort: "high" },
  max: { reasoningEffort: "max" },
} as const

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
      [WANTA_AGENT_NAME]: {
        description: "OOMOL connector + local coding assistant",
        mode: "primary",
        prompt: WANTA_SYSTEM_PROMPT,
        // 不再下发 tools 禁用表：所有内置工具默认启用。
        permission: WANTA_PERMISSION,
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
  supportsImages,
  toolCall,
}: {
  name: string
  supportsImages: boolean
  toolCall: boolean
}): OpencodeModelConfig {
  return {
    name,
    reasoning: true,
    variants: WANTA_REASONING_VARIANTS,
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
