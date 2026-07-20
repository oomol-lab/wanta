import assert from "node:assert/strict"
import { mkdtemp } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { test, vi } from "vitest"
import { externalModelProviderBaseUrls } from "../domain.ts"
import { ModelsServiceImpl } from "./node.ts"
import { ModelsStore } from "./store.ts"

const providerBaseUrls = externalModelProviderBaseUrls

test("ModelsServiceImpl preserves custom model image support on update", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "wanta-models-service-"))
  const service = new ModelsServiceImpl({ store: new ModelsStore(dir) })

  const created = await service.saveCustomModel({
    providerId: "openrouter",
    providerName: "OpenRouter",
    baseUrl: providerBaseUrls.openrouter,
    apiKey: "sk-secret",
    modelName: "vision-model",
    supportsImages: true,
  })
  const existing = created.customModels[0]
  assert.ok(existing)

  const updated = await service.saveCustomModel({
    id: existing.id,
    providerId: "openrouter",
    providerName: "OpenRouter",
    baseUrl: providerBaseUrls.openrouter,
    modelName: "vision-model-v2",
  })

  assert.equal(updated.customModels[0]?.supportsImages, true)
})

test("ModelsServiceImpl defaults known provider image support but honors user choices", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "wanta-models-service-"))
  const service = new ModelsServiceImpl({ store: new ModelsStore(dir) })

  const qwen = await service.saveCustomModel({
    providerId: "qwen",
    providerName: "Qwen",
    baseUrl: providerBaseUrls.qwenStandardCn,
    apiKey: "sk-secret",
    modelName: "qwen3.7-plus",
  })
  assert.equal(qwen.customModels[0]?.supportsImages, true)
  assert.equal(qwen.customModels[0]?.contextWindow, 1_000_000)

  const gemini = await service.saveCustomModel({
    providerId: "gemini",
    providerName: "Gemini",
    baseUrl: providerBaseUrls.gemini,
    apiKey: "sk-secret",
    modelName: "gemini-3.5-flash",
  })
  const geminiModel = gemini.customModels.at(-1)
  assert.equal(geminiModel?.supportsImages, true)
  assert.equal(geminiModel?.supportsToolCalls, true)
  assert.equal(geminiModel?.contextWindow, 1_114_112)
  assert.equal(geminiModel?.inputTokenLimit, 1_048_576)
  assert.equal(geminiModel?.maxOutputTokens, 65_536)

  const openRouter = await service.saveCustomModel({
    providerId: "openrouter",
    providerName: "OpenRouter",
    baseUrl: providerBaseUrls.openrouter,
    apiKey: "sk-secret",
    modelName: "openai/gpt-5.5",
    supportsImages: true,
  })

  assert.equal(openRouter.customModels.at(-1)?.supportsImages, true)
})

test("ModelsServiceImpl can clear token limits on update", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "wanta-models-service-"))
  const service = new ModelsServiceImpl({ store: new ModelsStore(dir) })

  const created = await service.saveCustomModel({
    providerId: "openrouter",
    providerName: "OpenRouter",
    baseUrl: providerBaseUrls.openrouter,
    apiKey: "sk-secret",
    modelName: "custom-model",
    contextWindow: 100_000,
    inputTokenLimit: 80_000,
    maxOutputTokens: 20_000,
  })
  const existing = created.customModels[0]
  assert.ok(existing)

  const updated = await service.saveCustomModel({
    id: existing.id,
    providerId: "openrouter",
    providerName: "OpenRouter",
    baseUrl: providerBaseUrls.openrouter,
    modelName: "custom-model",
    contextWindow: undefined,
    inputTokenLimit: undefined,
    maxOutputTokens: undefined,
  })

  assert.equal(updated.customModels[0]?.contextWindow, undefined)
  assert.equal(updated.customModels[0]?.inputTokenLimit, undefined)
  assert.equal(updated.customModels[0]?.maxOutputTokens, undefined)
})

test("ModelsServiceImpl serializes concurrent model mutations", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "wanta-models-service-"))
  const store = new ModelsStore(dir)
  const service = new ModelsServiceImpl({ store })

  await Promise.all([
    service.saveCustomModel({
      providerId: "openrouter",
      baseUrl: providerBaseUrls.openrouter,
      apiKey: "first-key",
      modelName: "first-model",
    }),
    service.saveCustomModel({
      providerId: "openrouter",
      baseUrl: providerBaseUrls.openrouter,
      apiKey: "second-key",
      modelName: "second-model",
    }),
  ])

  assert.deepEqual((await store.catalog()).customModels.map((model) => model.modelName).sort(), [
    "first-model",
    "second-model",
  ])
})

test("ModelsServiceImpl requests runtime refresh for save, selection, and deletion", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "wanta-models-service-"))
  const onCustomModelsChanged = vi.fn()
  const service = new ModelsServiceImpl({ store: new ModelsStore(dir), onCustomModelsChanged })

  const catalog = await service.saveCustomModel({
    providerId: "openrouter",
    baseUrl: providerBaseUrls.openrouter,
    apiKey: "runtime-key",
    modelName: "runtime-model",
  })
  const customModel = catalog.customModels[0]
  assert.ok(customModel)
  await service.setSelectedModel({ kind: "custom", id: customModel.id })
  await service.deleteCustomModel(customModel.id)

  assert.equal(onCustomModelsChanged.mock.calls.length, 3)
})
