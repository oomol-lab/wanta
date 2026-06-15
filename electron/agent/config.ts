import type { Config } from "@opencode-ai/sdk"

import { llmBaseUrl } from "../domain.ts"
import { customModelDisplayName } from "../models/store.ts"
import { LUMO_SYSTEM_PROMPT } from "./system-prompt.ts"

// OpenCode 内部标识（产品内部约定，可随品牌改，但 OO_/connector 协议契约不改）。
export const LUMO_AGENT_NAME = "lumo"
export const LUMO_PROVIDER_ID = "oomol"
export const LUMO_MODEL_ID = "oopilot"

export interface OpencodeCustomModel {
  id: string
  providerName: string
  baseUrl: string
  apiKey: string
  modelName: string
  displayName?: string
}

// 全量放开内置工具 + 权限：bash/read/write/edit/grep/glob/list/webfetch/task/todo* 与自定义
// 连接器工具并存。permission 全 allow——本应用未接入 OpenCode 的权限询问 UI，"ask" 会让会话
// 挂起（无人应答），故只能 allow 或 deny；external_directory: allow 让 read/glob/list 等文件
// 工具能访问 workspace cwd（App 私有 scratch 目录）之外的真实文件系统，bash 本就不受此限。
const LUMO_PERMISSION = {
  edit: "allow",
  bash: "allow",
  webfetch: "allow",
  external_directory: "allow",
} as const

export interface OpencodeConfigOptions {
  apiKey: string
  customModels?: OpencodeCustomModel[]
}

/** 构建 OpenCode 配置（经 OPENCODE_CONFIG_CONTENT 内联注入；apiKey 仅入内存 env，不落盘）。 */
export function buildOpencodeConfig({ apiKey, customModels = [] }: OpencodeConfigOptions): Config {
  return {
    $schema: "https://opencode.ai/config.json",
    model: `${LUMO_PROVIDER_ID}/${LUMO_MODEL_ID}`,
    provider: {
      [LUMO_PROVIDER_ID]: {
        name: "OOMOL",
        npm: "@ai-sdk/openai-compatible",
        options: { baseURL: llmBaseUrl, apiKey },
        models: { [LUMO_MODEL_ID]: { name: "OOMOL Chat", tool_call: true } },
      },
      ...Object.fromEntries(customModels.map((model) => [customProviderId(model.id), customProviderConfig(model)])),
    },
    agent: {
      [LUMO_AGENT_NAME]: {
        description: "OOMOL connector + local coding assistant",
        mode: "primary",
        prompt: LUMO_SYSTEM_PROMPT,
        // 不再下发 tools 禁用表：所有内置工具默认启用。
        permission: LUMO_PERMISSION,
      },
    },
    permission: LUMO_PERMISSION,
  }
}

export function customProviderId(id: string): string {
  return `lumo-custom-${id}`
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
      [model.modelName]: {
        name: customModelDisplayName(model),
        tool_call: true,
      },
    },
  }
}
