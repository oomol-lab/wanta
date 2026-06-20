import type { CustomModelProvider, CustomModelSummary, ModelCatalog, ModelChoice } from "./common.ts"

import { randomUUID } from "node:crypto"
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises"
import path from "node:path"
import { DEFAULT_BUILTIN_MODEL_ID, builtinModelSummaries, isBuiltinModelId } from "./builtin.ts"

export interface PersistedCustomModel {
  id: string
  providerId: string
  providerName: string
  baseUrl: string
  apiKey: string
  modelName: string
  displayName?: string
  supportsImages?: boolean
}

export interface PersistedModels {
  selected?: ModelChoice
  customModels?: PersistedCustomModel[]
}

export const CUSTOM_MODEL_PROVIDERS: CustomModelProvider[] = [
  {
    id: "deepseek",
    displayName: "DeepSeek",
    baseUrl: "https://api.deepseek.com",
    modelOptions: [
      { id: "deepseek-v4-flash", displayName: "DeepSeek V4 Flash" },
      { id: "deepseek-v4-pro", displayName: "DeepSeek V4 Pro" },
    ],
    supportsImages: false,
    requiresBaseUrl: true,
  },
  {
    id: "openrouter",
    displayName: "OpenRouter",
    baseUrl: "https://openrouter.ai/api/v1",
    requiresBaseUrl: true,
  },
  {
    id: "zhipu",
    displayName: "GLM API",
    baseUrl: "https://open.bigmodel.cn/api/paas/v4",
    apiPlans: [
      {
        id: "standard",
        baseUrl: "https://open.bigmodel.cn/api/paas/v4",
        apiRegions: [
          { id: "cn", baseUrl: "https://open.bigmodel.cn/api/paas/v4" },
          { id: "global", baseUrl: "https://api.z.ai/api/paas/v4" },
        ],
      },
      {
        id: "coding",
        baseUrl: "https://api.z.ai/api/coding/paas/v4",
      },
    ],
    apiRegions: [
      { id: "cn", baseUrl: "https://open.bigmodel.cn/api/paas/v4" },
      { id: "global", baseUrl: "https://api.z.ai/api/paas/v4" },
    ],
    modelOptions: [
      { id: "glm-5.2", displayName: "GLM-5.2" },
      { id: "glm-5.1", displayName: "GLM-5.1" },
      { id: "glm-5-turbo", displayName: "GLM-5-Turbo" },
      { id: "glm-5", displayName: "GLM-5" },
      { id: "glm-4.7", displayName: "GLM-4.7" },
      { id: "glm-4.7-flash", displayName: "GLM-4.7 Flash" },
    ],
    supportsImages: false,
    requiresBaseUrl: true,
  },
  {
    id: "kimi",
    displayName: "Kimi",
    baseUrl: "https://api.moonshot.cn/v1",
    apiRegions: [
      { id: "cn", baseUrl: "https://api.moonshot.cn/v1" },
      { id: "global", baseUrl: "https://api.moonshot.ai/v1" },
    ],
    modelOptions: [
      { id: "kimi-k2.7-code", displayName: "Kimi K2.7 Code", supportsImages: true },
      { id: "kimi-k2.7-code-highspeed", displayName: "Kimi K2.7 Code Highspeed", supportsImages: true },
      { id: "kimi-k2.6", displayName: "Kimi K2.6", supportsImages: true },
    ],
    requiresBaseUrl: true,
  },
  {
    id: "minimax",
    displayName: "MiniMax",
    baseUrl: "https://api.minimaxi.com/v1",
    apiRegions: [
      { id: "cn", baseUrl: "https://api.minimaxi.com/v1" },
      { id: "global", baseUrl: "https://api.minimax.io/v1" },
    ],
    modelOptions: [
      { id: "MiniMax-M3", displayName: "MiniMax M3", supportsImages: true },
      { id: "MiniMax-M2.7", displayName: "MiniMax M2.7", supportsImages: false },
      { id: "MiniMax-M2.7-highspeed", displayName: "MiniMax M2.7 Highspeed", supportsImages: false },
      { id: "MiniMax-M2.5", displayName: "MiniMax M2.5", supportsImages: false },
      { id: "MiniMax-M2.5-highspeed", displayName: "MiniMax M2.5 Highspeed", supportsImages: false },
      { id: "MiniMax-M2.1", displayName: "MiniMax M2.1", supportsImages: false },
      { id: "MiniMax-M2.1-highspeed", displayName: "MiniMax M2.1 Highspeed", supportsImages: false },
      { id: "MiniMax-M2", displayName: "MiniMax M2", supportsImages: false },
    ],
    requiresBaseUrl: true,
  },
  {
    id: "qwen",
    displayName: "Qwen",
    baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
    apiPlans: [
      {
        id: "standard",
        baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
        apiRegions: [
          { id: "cn", baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1" },
          { id: "global", baseUrl: "https://dashscope-us.aliyuncs.com/compatible-mode/v1" },
        ],
      },
      {
        id: "coding",
        baseUrl: "https://coding.dashscope.aliyuncs.com/v1",
        apiRegions: [
          { id: "cn", baseUrl: "https://coding.dashscope.aliyuncs.com/v1" },
          { id: "global", baseUrl: "https://coding-intl.dashscope.aliyuncs.com/v1" },
        ],
      },
    ],
    apiRegions: [
      { id: "cn", baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1" },
      { id: "global", baseUrl: "https://dashscope-us.aliyuncs.com/compatible-mode/v1" },
    ],
    modelOptions: [
      { id: "qwen3.7-plus", displayName: "Qwen3.7 Plus", supportsImages: true },
      { id: "qwen3.7-max", displayName: "Qwen3.7 Max", supportsImages: true },
    ],
    requiresBaseUrl: true,
  },
  {
    id: "xiaomi",
    displayName: "Xiaomi MiMo",
    baseUrl: "https://api.xiaomimimo.com/v1",
    apiPlans: [
      {
        id: "standard",
        baseUrl: "https://api.xiaomimimo.com/v1",
      },
      {
        id: "token",
        baseUrl: "https://token-plan-cn.xiaomimimo.com/v1",
        apiRegions: [
          { id: "cn", baseUrl: "https://token-plan-cn.xiaomimimo.com/v1" },
          { id: "sgp", baseUrl: "https://token-plan-sgp.xiaomimimo.com/v1" },
          { id: "ams", baseUrl: "https://token-plan-ams.xiaomimimo.com/v1" },
        ],
      },
    ],
    modelOptions: [
      { id: "mimo-v2.5-pro", displayName: "MiMo V2.5 Pro", supportsImages: false },
      { id: "mimo-v2.5", displayName: "MiMo V2.5", supportsImages: true },
    ],
    requiresBaseUrl: true,
  },
  {
    id: "custom",
    displayName: "Custom",
    baseUrl: "",
    requiresBaseUrl: true,
  },
]

export function customModelDisplayName(
  model: Pick<PersistedCustomModel, "displayName" | "providerName" | "modelName">,
): string {
  return model.displayName?.trim() || `${model.providerName}:${model.modelName}`
}

export function customProviderModelSupportsImages(
  provider: CustomModelProvider | undefined,
  modelName: string,
): boolean {
  const option = provider?.modelOptions?.find((model) => model.id === modelName.trim())
  return option?.supportsImages ?? provider?.supportsImages ?? false
}

export function publicCustomModel(model: PersistedCustomModel): CustomModelSummary {
  return {
    id: model.id,
    providerId: model.providerId,
    providerName: model.providerName,
    baseUrl: model.baseUrl,
    modelName: model.modelName,
    displayName: customModelDisplayName(model),
    apiKeyConfigured: model.apiKey.length > 0,
    supportsImages: model.supportsImages === true,
  }
}

export function sanitizeBaseUrl(value: string): string {
  const trimmed = value.trim()
  if (!trimmed) {
    throw new Error("Base URL is required.")
  }
  let parsed: URL
  try {
    parsed = new URL(trimmed)
  } catch {
    throw new Error("Base URL must be a valid URL.")
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    throw new Error("Base URL must start with http:// or https://.")
  }
  return trimmed.replace(/\/+$/, "")
}

export function defaultModelChoice(): ModelChoice {
  return { kind: "builtin", id: DEFAULT_BUILTIN_MODEL_ID }
}

export function isKnownModelChoice(models: PersistedModels, choice: ModelChoice | undefined): choice is ModelChoice {
  if (!choice) {
    return false
  }
  if (choice.kind === "builtin") {
    return isBuiltinModelId(choice.id)
  }
  return Boolean(models.customModels?.some((model) => model.id === choice.id))
}

export class ModelsStore {
  private readonly file: string

  public constructor(dir: string) {
    this.file = path.join(dir, "models.json")
  }

  public async read(): Promise<PersistedModels> {
    try {
      const parsed = JSON.parse(await readFile(this.file, "utf-8")) as PersistedModels
      return {
        selected: isKnownModelChoice(parsed, parsed.selected) ? parsed.selected : defaultModelChoice(),
        customModels: Array.isArray(parsed.customModels) ? parsed.customModels.filter(isPersistedCustomModel) : [],
      }
    } catch {
      return { selected: defaultModelChoice(), customModels: [] }
    }
  }

  public async write(models: PersistedModels): Promise<void> {
    await mkdir(path.dirname(this.file), { recursive: true })
    const tmp = `${this.file}.tmp-${process.pid}-${randomUUID()}`
    try {
      await writeFile(tmp, JSON.stringify(models, null, 2), { encoding: "utf-8", mode: 0o600 })
      await rename(tmp, this.file)
    } catch (error) {
      await rm(tmp, { force: true })
      throw error
    }
  }

  public async catalog(): Promise<ModelCatalog> {
    const models = await this.read()
    return {
      builtins: builtinModelSummaries(),
      customModels: (models.customModels ?? []).map(publicCustomModel),
      providers: CUSTOM_MODEL_PROVIDERS,
      selected: isKnownModelChoice(models, models.selected) ? models.selected : defaultModelChoice(),
    }
  }

  public async runtimeCustomModels(): Promise<PersistedCustomModel[]> {
    return (await this.read()).customModels ?? []
  }
}

function isPersistedCustomModel(value: unknown): value is PersistedCustomModel {
  if (!value || typeof value !== "object") {
    return false
  }
  const model = value as Record<string, unknown>
  return (
    typeof model.id === "string" &&
    typeof model.providerId === "string" &&
    typeof model.providerName === "string" &&
    typeof model.baseUrl === "string" &&
    typeof model.apiKey === "string" &&
    typeof model.modelName === "string" &&
    (model.displayName === undefined || typeof model.displayName === "string") &&
    (model.supportsImages === undefined || typeof model.supportsImages === "boolean")
  )
}
