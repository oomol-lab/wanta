import type {
  BuiltinModelSummary,
  CustomModelProvider,
  CustomModelSummary,
  ModelCatalog,
  ModelChoice,
} from "./common.ts"

import { randomUUID } from "node:crypto"
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises"
import path from "node:path"

export interface PersistedCustomModel {
  id: string
  providerId: string
  providerName: string
  baseUrl: string
  apiKey: string
  modelName: string
  displayName?: string
}

export interface PersistedModels {
  selected?: ModelChoice
  customModels?: PersistedCustomModel[]
}

export const BUILTIN_MODELS: BuiltinModelSummary[] = [{ id: "oomol-chat", displayName: "Auto", providerName: "OOMOL" }]

export const CUSTOM_MODEL_PROVIDERS: CustomModelProvider[] = [
  {
    id: "deepseek",
    displayName: "DeepSeek",
    baseUrl: "",
    requiresBaseUrl: true,
  },
  {
    id: "openrouter",
    displayName: "OpenRouter",
    baseUrl: "",
    requiresBaseUrl: true,
  },
  {
    id: "zhipu",
    displayName: "GLM API",
    baseUrl: "",
    requiresBaseUrl: true,
  },
  {
    id: "kimi",
    displayName: "Kimi",
    baseUrl: "",
    requiresBaseUrl: true,
  },
  {
    id: "minimax",
    displayName: "MiniMax",
    baseUrl: "",
    requiresBaseUrl: true,
  },
  {
    id: "ollama",
    displayName: "Ollama",
    baseUrl: "http://127.0.0.1:11434/v1",
    requiresBaseUrl: false,
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

export function publicCustomModel(model: PersistedCustomModel): CustomModelSummary {
  return {
    id: model.id,
    providerId: model.providerId,
    providerName: model.providerName,
    baseUrl: model.baseUrl,
    modelName: model.modelName,
    displayName: customModelDisplayName(model),
    apiKeyConfigured: model.apiKey.length > 0,
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
  return { kind: "builtin", id: "oomol-chat" }
}

export function isKnownModelChoice(models: PersistedModels, choice: ModelChoice | undefined): choice is ModelChoice {
  if (!choice) {
    return false
  }
  if (choice.kind === "builtin") {
    return choice.id === "oomol-chat"
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
      builtins: BUILTIN_MODELS,
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
    (model.displayName === undefined || typeof model.displayName === "string")
  )
}
