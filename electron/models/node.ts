import type { ModelCatalog, ModelChoice, ModelsService, SaveCustomModelRequest } from "./common.ts"
import type { PersistedCustomModel, ModelsStore } from "./store.ts"
import type { IConnectionService } from "@oomol/connection"

import { ConnectionService } from "@oomol/connection"
import { randomUUID } from "node:crypto"
import { ModelsService as ModelsServiceName } from "./common.ts"
import {
  CUSTOM_MODEL_PROVIDERS,
  customProviderModelContextWindow,
  customProviderModelInputTokenLimit,
  customProviderModelMaxOutputTokens,
  customProviderModelReasoningVariants,
  customProviderModelSupportsImages,
  customProviderModelSupportsToolCalls,
  defaultModelChoice,
  isKnownModelChoice,
  sanitizeBaseUrl,
  sanitizeOptionalTokenLimit,
} from "./store.ts"

export interface ModelsServiceDeps {
  store: ModelsStore
  onCustomModelsChanged?: () => void
}

export class ModelsServiceImpl extends ConnectionService<ModelsService> implements IConnectionService<ModelsService> {
  private readonly deps: ModelsServiceDeps

  public constructor(deps: ModelsServiceDeps) {
    super(ModelsServiceName)
    this.deps = deps
  }

  public async listModels(): Promise<ModelCatalog> {
    return this.deps.store.catalog()
  }

  public async setSelectedModel(choice: ModelChoice): Promise<ModelCatalog> {
    const models = await this.deps.store.read()
    const selected = isKnownModelChoice(models, choice) ? choice : defaultModelChoice()
    await this.deps.store.write({ ...models, selected })
    return this.emitCatalog()
  }

  public async saveCustomModel(req: SaveCustomModelRequest): Promise<ModelCatalog> {
    const models = await this.deps.store.read()
    const current = models.customModels ?? []
    const existing = req.id ? current.find((model) => model.id === req.id) : undefined
    const provider = CUSTOM_MODEL_PROVIDERS.find((item) => item.id === req.providerId)
    const providerName = (req.providerName ?? provider?.displayName ?? req.providerId).trim()
    const baseUrl = sanitizeBaseUrl(req.baseUrl ?? provider?.baseUrl ?? existing?.baseUrl ?? "")
    const modelName = req.modelName.trim()
    if (!modelName) {
      throw new Error("Model name is required.")
    }
    const apiKey = req.apiKey?.trim() || existing?.apiKey || ""
    if (!apiKey) {
      throw new Error("API Key is required.")
    }
    const contextWindow = sanitizeOptionalTokenLimit(
      req.contextWindow ?? existing?.contextWindow ?? customProviderModelContextWindow(provider, modelName),
      "Context window",
    )
    const maxOutputTokens = sanitizeOptionalTokenLimit(
      req.maxOutputTokens ?? existing?.maxOutputTokens ?? customProviderModelMaxOutputTokens(provider, modelName),
      "Max output tokens",
    )
    const inputTokenLimit = sanitizeOptionalTokenLimit(
      req.inputTokenLimit ?? existing?.inputTokenLimit ?? customProviderModelInputTokenLimit(provider, modelName),
      "Input token limit",
    )
    const next: PersistedCustomModel = {
      id: existing?.id ?? randomUUID(),
      providerId: req.providerId,
      providerName,
      baseUrl,
      apiKey,
      modelName,
      displayName: req.displayName?.trim() || undefined,
      supportsImages:
        req.supportsImages ?? existing?.supportsImages ?? customProviderModelSupportsImages(provider, modelName),
      supportsToolCalls:
        req.supportsToolCalls ??
        existing?.supportsToolCalls ??
        customProviderModelSupportsToolCalls(provider, modelName),
      ...(contextWindow ? { contextWindow } : {}),
      ...(inputTokenLimit ? { inputTokenLimit } : {}),
      ...(maxOutputTokens ? { maxOutputTokens } : {}),
      reasoningVariants:
        req.reasoningVariants !== undefined
          ? [...req.reasoningVariants]
          : (existing?.reasoningVariants ?? customProviderModelReasoningVariants(provider, modelName)),
    }
    const customModels = existing
      ? current.map((model) => (model.id === existing.id ? next : model))
      : [...current, next]
    await this.deps.store.write({
      ...models,
      customModels,
      selected: { kind: "custom", id: next.id },
    })
    this.deps.onCustomModelsChanged?.()
    return this.emitCatalog()
  }

  public async deleteCustomModel(id: string): Promise<ModelCatalog> {
    const models = await this.deps.store.read()
    const customModels = (models.customModels ?? []).filter((model) => model.id !== id)
    const selected =
      models.selected?.kind === "custom" && models.selected.id === id ? defaultModelChoice() : models.selected
    await this.deps.store.write({ ...models, customModels, selected })
    this.deps.onCustomModelsChanged?.()
    return this.emitCatalog()
  }

  private async emitCatalog(): Promise<ModelCatalog> {
    const catalog = await this.deps.store.catalog()
    await this.send("modelsChanged", catalog).catch(() => undefined)
    return catalog
  }
}
