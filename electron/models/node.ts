import type { ModelCatalog, ModelChoice, ModelsService, SaveCustomModelRequest } from "./common.ts"
import type { PersistedCustomModel, ModelsStore } from "./store.ts"
import type { IConnectionService } from "@oomol/connection"

import { ConnectionService } from "@oomol/connection"
import { randomUUID } from "node:crypto"
import { logDiagnostic } from "../diagnostics-log.ts"
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

type OptionalTokenLimitField = "contextWindow" | "inputTokenLimit" | "maxOutputTokens"

export class ModelsServiceImpl extends ConnectionService<ModelsService> implements IConnectionService<ModelsService> {
  private readonly deps: ModelsServiceDeps
  private mutationQueue: Promise<void> = Promise.resolve()

  public constructor(deps: ModelsServiceDeps) {
    super(ModelsServiceName)
    this.deps = deps
  }

  public async listModels(): Promise<ModelCatalog> {
    return this.deps.store.catalog()
  }

  public setSelectedModel(choice: ModelChoice): Promise<ModelCatalog> {
    return this.enqueueMutation(async () => {
      const models = await this.deps.store.read()
      const selected = isKnownModelChoice(models, choice) ? choice : defaultModelChoice()
      await this.deps.store.write({ ...models, selected })
      this.deps.onCustomModelsChanged?.()
      return this.emitCatalog()
    })
  }

  public saveCustomModel(req: SaveCustomModelRequest): Promise<ModelCatalog> {
    return this.enqueueMutation(async () => {
      const models = await this.deps.store.read()
      const current = models.customModels ?? []
      const existing = req.id ? current.find((model) => model.id === req.id) : undefined
      const provider = CUSTOM_MODEL_PROVIDERS.find((item) => item.id === req.providerId)
      const providerName = (req.providerName ?? provider?.displayName ?? req.providerId).trim()
      const baseUrl = sanitizeBaseUrl(req.baseUrl ?? provider?.baseUrl ?? existing?.baseUrl ?? "")
      const modelName = req.modelName.trim()
      if (!modelName) throw new Error("Model name is required.")
      const id = existing?.id ?? randomUUID()
      const credentialStore = this.deps.store.credentialStore()
      const existingApiKey = existing ? await credentialStore.get(id) : undefined
      const requestedApiKey = req.apiKey?.trim()
      const apiKey = requestedApiKey || existingApiKey || ""
      if (!apiKey) throw new Error("API Key is required.")
      const contextWindow = resolveOptionalTokenLimit(
        req,
        "contextWindow",
        existing,
        customProviderModelContextWindow(provider, modelName),
        "Context window",
      )
      const maxOutputTokens = resolveOptionalTokenLimit(
        req,
        "maxOutputTokens",
        existing,
        customProviderModelMaxOutputTokens(provider, modelName),
        "Max output tokens",
      )
      const inputTokenLimit = resolveOptionalTokenLimit(
        req,
        "inputTokenLimit",
        existing,
        customProviderModelInputTokenLimit(provider, modelName),
        "Input token limit",
      )
      const next: PersistedCustomModel = {
        id,
        providerId: req.providerId,
        providerName,
        baseUrl,
        apiKeyConfigured: true,
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
      const credentialChanged = Boolean(requestedApiKey && requestedApiKey !== existingApiKey)
      if (credentialChanged) await credentialStore.set(id, apiKey)
      try {
        await this.deps.store.write({
          ...models,
          customModels,
          selected: { kind: "custom", id: next.id },
        })
      } catch (error) {
        if (!credentialChanged) throw error
        try {
          if (existingApiKey) await credentialStore.set(id, existingApiKey)
          else await credentialStore.delete(id)
        } catch (rollbackError) {
          throw new AggregateError([error, rollbackError], "Failed to save and roll back the custom model")
        }
        throw error
      }
      this.deps.onCustomModelsChanged?.()
      return this.emitCatalog()
    })
  }

  public deleteCustomModel(id: string): Promise<ModelCatalog> {
    return this.enqueueMutation(async () => {
      const models = await this.deps.store.read()
      const existing = (models.customModels ?? []).find((model) => model.id === id)
      if (!existing) return this.emitCatalog()
      const credentialStore = this.deps.store.credentialStore()
      const existingApiKey = await credentialStore.get(id)
      const customModels = (models.customModels ?? []).filter((model) => model.id !== id)
      const selected =
        models.selected?.kind === "custom" && models.selected.id === id ? defaultModelChoice() : models.selected
      await credentialStore.delete(id)
      try {
        await this.deps.store.write({ ...models, customModels, selected })
      } catch (error) {
        if (existingApiKey) {
          try {
            await credentialStore.set(id, existingApiKey)
          } catch (rollbackError) {
            throw new AggregateError([error, rollbackError], "Failed to delete and roll back the custom model")
          }
        }
        throw error
      }
      this.deps.onCustomModelsChanged?.()
      return this.emitCatalog()
    })
  }

  private async emitCatalog(): Promise<ModelCatalog> {
    const catalog = await this.deps.store.catalog()
    await this.send("modelsChanged", catalog).catch((error: unknown) => {
      console.warn("[wanta] failed to emit models catalog:", error)
      logDiagnostic("models-service", "failed to emit models catalog", { error }, "warn")
    })
    return catalog
  }

  private async enqueueMutation<T>(mutation: () => Promise<T>): Promise<T> {
    const previous = this.mutationQueue
    let release!: () => void
    this.mutationQueue = new Promise<void>((resolve) => {
      release = resolve
    })
    await previous.catch(() => undefined)
    try {
      return await mutation()
    } finally {
      release()
    }
  }
}

function resolveOptionalTokenLimit(
  req: SaveCustomModelRequest,
  field: OptionalTokenLimitField,
  existing: PersistedCustomModel | undefined,
  providerDefault: number | undefined,
  fieldName: string,
): number | undefined {
  const value = Object.hasOwn(req, field) ? req[field] : (existing?.[field] ?? providerDefault)
  return sanitizeOptionalTokenLimit(value, fieldName)
}
