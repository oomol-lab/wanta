import type { WantaReasoningVariant } from "../agent/reasoning.ts"
import type { CustomModelProvider, CustomModelSummary, ModelCatalog, ModelChoice } from "./common.ts"

import { randomUUID } from "node:crypto"
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises"
import path from "node:path"
import { externalModelProviderBaseUrls } from "../domain.ts"
import { logStoreReadFailure } from "../store-diagnostics.ts"
import { DEFAULT_BUILTIN_MODEL_ID, builtinModelSummaries, isBuiltinModelId } from "./builtin.ts"

const providerBaseUrls = externalModelProviderBaseUrls
const context200K = 204_800
const context256K = 262_144
const millionTokenContextWindow = 1_000_000
const gemini3InputTokenLimit = 1_048_576
const gemini3MaxOutputTokens = 65_536
const gemini3ContextWindow = gemini3InputTokenLimit + gemini3MaxOutputTokens
const maxOutput128K = 128_000
const deepSeekV4ReasoningVariants = ["low", "high", "max"] as const satisfies readonly WantaReasoningVariant[]
const glm52ReasoningVariants = ["high", "max"] as const satisfies readonly WantaReasoningVariant[]

export interface PersistedCustomModel {
  id: string
  providerId: string
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
  reasoningVariants?: WantaReasoningVariant[]
}

export interface PersistedModels {
  selected?: ModelChoice
  customModels?: PersistedCustomModel[]
}

export const CUSTOM_MODEL_PROVIDERS: CustomModelProvider[] = [
  {
    id: "deepseek",
    displayName: "DeepSeek",
    baseUrl: providerBaseUrls.deepseek,
    modelOptions: [
      {
        id: "deepseek-v4-flash",
        displayName: "DeepSeek V4 Flash",
        contextWindow: millionTokenContextWindow,
        reasoningVariants: deepSeekV4ReasoningVariants,
      },
      {
        id: "deepseek-v4-pro",
        displayName: "DeepSeek V4 Pro",
        contextWindow: millionTokenContextWindow,
        reasoningVariants: deepSeekV4ReasoningVariants,
      },
    ],
    supportsImages: false,
    supportsToolCalls: true,
    requiresBaseUrl: true,
  },
  {
    id: "openrouter",
    displayName: "OpenRouter",
    baseUrl: providerBaseUrls.openrouter,
    requiresBaseUrl: true,
  },
  {
    id: "gemini",
    displayName: "Gemini",
    baseUrl: providerBaseUrls.gemini,
    modelOptions: [
      {
        id: "gemini-3.5-flash",
        displayName: "Gemini 3.5 Flash",
        supportsImages: true,
        supportsToolCalls: true,
        contextWindow: gemini3ContextWindow,
        inputTokenLimit: gemini3InputTokenLimit,
        maxOutputTokens: gemini3MaxOutputTokens,
      },
      {
        id: "gemini-3.1-pro-preview",
        displayName: "Gemini 3.1 Pro Preview",
        supportsImages: true,
        supportsToolCalls: true,
        contextWindow: gemini3ContextWindow,
        inputTokenLimit: gemini3InputTokenLimit,
        maxOutputTokens: gemini3MaxOutputTokens,
      },
      {
        id: "gemini-2.5-pro",
        displayName: "Gemini 2.5 Pro",
        supportsImages: true,
        supportsToolCalls: true,
        contextWindow: gemini3ContextWindow,
        inputTokenLimit: gemini3InputTokenLimit,
        maxOutputTokens: gemini3MaxOutputTokens,
      },
    ],
    supportsImages: true,
    supportsToolCalls: true,
    requiresBaseUrl: true,
  },
  {
    id: "zhipu",
    displayName: "GLM API",
    baseUrl: providerBaseUrls.zhipuCn,
    apiPlans: [
      {
        id: "standard",
        baseUrl: providerBaseUrls.zhipuCn,
        apiRegions: [
          { id: "cn", baseUrl: providerBaseUrls.zhipuCn },
          { id: "global", baseUrl: providerBaseUrls.zhipuGlobal },
        ],
      },
      {
        id: "coding",
        baseUrl: providerBaseUrls.zhipuCoding,
      },
    ],
    apiRegions: [
      { id: "cn", baseUrl: providerBaseUrls.zhipuCn },
      { id: "global", baseUrl: providerBaseUrls.zhipuGlobal },
    ],
    modelOptions: [
      {
        id: "glm-5.2",
        displayName: "GLM-5.2",
        contextWindow: millionTokenContextWindow,
        maxOutputTokens: maxOutput128K,
        reasoningVariants: glm52ReasoningVariants,
      },
      { id: "glm-5.1", displayName: "GLM-5.1" },
      { id: "glm-5-turbo", displayName: "GLM-5-Turbo" },
      { id: "glm-5", displayName: "GLM-5" },
      { id: "glm-4.7", displayName: "GLM-4.7", contextWindow: context200K, maxOutputTokens: maxOutput128K },
      {
        id: "glm-4.7-flash",
        displayName: "GLM-4.7 Flash",
        contextWindow: context200K,
        maxOutputTokens: maxOutput128K,
      },
    ],
    supportsImages: false,
    supportsToolCalls: true,
    requiresBaseUrl: true,
  },
  {
    id: "kimi",
    displayName: "Kimi",
    baseUrl: providerBaseUrls.kimiCn,
    apiRegions: [
      { id: "cn", baseUrl: providerBaseUrls.kimiCn },
      { id: "global", baseUrl: providerBaseUrls.kimiGlobal },
    ],
    modelOptions: [
      { id: "kimi-k2.7-code", displayName: "Kimi K2.7 Code", supportsImages: true, contextWindow: context256K },
      {
        id: "kimi-k2.7-code-highspeed",
        displayName: "Kimi K2.7 Code Highspeed",
        supportsImages: true,
        contextWindow: context256K,
      },
      { id: "kimi-k2.6", displayName: "Kimi K2.6", supportsImages: true, contextWindow: context256K },
    ],
    supportsToolCalls: true,
    requiresBaseUrl: true,
  },
  {
    id: "minimax",
    displayName: "MiniMax",
    baseUrl: providerBaseUrls.minimaxCn,
    apiRegions: [
      { id: "cn", baseUrl: providerBaseUrls.minimaxCn },
      { id: "global", baseUrl: providerBaseUrls.minimaxGlobal },
    ],
    modelOptions: [
      { id: "MiniMax-M3", displayName: "MiniMax M3", supportsImages: true, contextWindow: millionTokenContextWindow },
      {
        id: "MiniMax-M2.7",
        displayName: "MiniMax M2.7",
        supportsImages: false,
        contextWindow: context200K,
        maxOutputTokens: maxOutput128K,
      },
      {
        id: "MiniMax-M2.7-highspeed",
        displayName: "MiniMax M2.7 Highspeed",
        supportsImages: false,
        contextWindow: context200K,
        maxOutputTokens: maxOutput128K,
      },
      {
        id: "MiniMax-M2.5",
        displayName: "MiniMax M2.5",
        supportsImages: false,
        contextWindow: context200K,
        maxOutputTokens: maxOutput128K,
      },
      {
        id: "MiniMax-M2.5-highspeed",
        displayName: "MiniMax M2.5 Highspeed",
        supportsImages: false,
        contextWindow: context200K,
        maxOutputTokens: maxOutput128K,
      },
      {
        id: "MiniMax-M2.1",
        displayName: "MiniMax M2.1",
        supportsImages: false,
        contextWindow: context200K,
        maxOutputTokens: maxOutput128K,
      },
      {
        id: "MiniMax-M2.1-highspeed",
        displayName: "MiniMax M2.1 Highspeed",
        supportsImages: false,
        contextWindow: context200K,
        maxOutputTokens: maxOutput128K,
      },
      {
        id: "MiniMax-M2",
        displayName: "MiniMax M2",
        supportsImages: false,
        contextWindow: context200K,
        maxOutputTokens: maxOutput128K,
      },
    ],
    supportsToolCalls: true,
    requiresBaseUrl: true,
  },
  {
    id: "qwen",
    displayName: "Qwen",
    baseUrl: providerBaseUrls.qwenStandardCn,
    apiPlans: [
      {
        id: "standard",
        baseUrl: providerBaseUrls.qwenStandardCn,
        apiRegions: [
          { id: "cn", baseUrl: providerBaseUrls.qwenStandardCn },
          { id: "global", baseUrl: providerBaseUrls.qwenStandardGlobal },
        ],
      },
      {
        id: "coding",
        baseUrl: providerBaseUrls.qwenCodingCn,
        apiRegions: [
          { id: "cn", baseUrl: providerBaseUrls.qwenCodingCn },
          { id: "global", baseUrl: providerBaseUrls.qwenCodingGlobal },
        ],
      },
    ],
    apiRegions: [
      { id: "cn", baseUrl: providerBaseUrls.qwenStandardCn },
      { id: "global", baseUrl: providerBaseUrls.qwenStandardGlobal },
    ],
    modelOptions: [
      {
        id: "qwen3.7-plus",
        displayName: "Qwen3.7 Plus",
        supportsImages: true,
        contextWindow: millionTokenContextWindow,
      },
      { id: "qwen3.7-max", displayName: "Qwen3.7 Max", supportsImages: true, contextWindow: millionTokenContextWindow },
    ],
    supportsToolCalls: true,
    requiresBaseUrl: true,
  },
  {
    id: "xiaomi",
    displayName: "Xiaomi MiMo",
    baseUrl: providerBaseUrls.xiaomiStandard,
    apiPlans: [
      {
        id: "standard",
        baseUrl: providerBaseUrls.xiaomiStandard,
      },
      {
        id: "token",
        baseUrl: providerBaseUrls.xiaomiTokenCn,
        apiRegions: [
          { id: "cn", baseUrl: providerBaseUrls.xiaomiTokenCn },
          { id: "sgp", baseUrl: providerBaseUrls.xiaomiTokenSgp },
          { id: "ams", baseUrl: providerBaseUrls.xiaomiTokenAms },
        ],
      },
    ],
    modelOptions: [
      {
        id: "mimo-v2.5-pro",
        displayName: "MiMo V2.5 Pro",
        supportsImages: false,
        contextWindow: millionTokenContextWindow,
      },
      { id: "mimo-v2.5", displayName: "MiMo V2.5", supportsImages: true, contextWindow: millionTokenContextWindow },
    ],
    supportsToolCalls: true,
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

export function customProviderModelSupportsToolCalls(
  provider: CustomModelProvider | undefined,
  modelName: string,
): boolean {
  const option = provider?.modelOptions?.find((model) => model.id === modelName.trim())
  return option?.supportsToolCalls ?? provider?.supportsToolCalls ?? true
}

export function customProviderModelContextWindow(
  provider: CustomModelProvider | undefined,
  modelName: string,
): number | undefined {
  const option = provider?.modelOptions?.find((model) => model.id === modelName.trim())
  return option?.contextWindow ?? provider?.contextWindow
}

export function customProviderModelMaxOutputTokens(
  provider: CustomModelProvider | undefined,
  modelName: string,
): number | undefined {
  const option = provider?.modelOptions?.find((model) => model.id === modelName.trim())
  return option?.maxOutputTokens ?? provider?.maxOutputTokens
}

export function customProviderModelInputTokenLimit(
  provider: CustomModelProvider | undefined,
  modelName: string,
): number | undefined {
  const option = provider?.modelOptions?.find((model) => model.id === modelName.trim())
  return option?.inputTokenLimit ?? provider?.inputTokenLimit
}

export function customProviderModelReasoningVariants(
  provider: CustomModelProvider | undefined,
  modelName: string,
): WantaReasoningVariant[] | undefined {
  const option = provider?.modelOptions?.find((model) => model.id === modelName.trim())
  const variants = option?.reasoningVariants ?? provider?.reasoningVariants
  return variants ? [...variants] : undefined
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
    supportsToolCalls: model.supportsToolCalls !== false,
    ...(model.contextWindow ? { contextWindow: model.contextWindow } : {}),
    ...(model.inputTokenLimit ? { inputTokenLimit: model.inputTokenLimit } : {}),
    ...(model.maxOutputTokens ? { maxOutputTokens: model.maxOutputTokens } : {}),
    ...(model.reasoningVariants ? { reasoningVariants: model.reasoningVariants } : {}),
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

export function sanitizeOptionalTokenLimit(value: number | undefined, fieldName: string): number | undefined {
  if (value === undefined) {
    return undefined
  }
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${fieldName} must be a positive integer.`)
  }
  return value
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
    } catch (error) {
      logStoreReadFailure("models", this.file, error)
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
    (model.supportsImages === undefined || typeof model.supportsImages === "boolean") &&
    (model.supportsToolCalls === undefined || typeof model.supportsToolCalls === "boolean") &&
    (model.contextWindow === undefined || isPositiveSafeInteger(model.contextWindow)) &&
    (model.inputTokenLimit === undefined || isPositiveSafeInteger(model.inputTokenLimit)) &&
    (model.maxOutputTokens === undefined || isPositiveSafeInteger(model.maxOutputTokens)) &&
    (model.reasoningVariants === undefined || isReasoningVariantArray(model.reasoningVariants))
  )
}

function isPositiveSafeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0
}

function isReasoningVariantArray(value: unknown): value is WantaReasoningVariant[] {
  return (
    Array.isArray(value) &&
    value.every((item) => item === "low" || item === "medium" || item === "high" || item === "max")
  )
}
