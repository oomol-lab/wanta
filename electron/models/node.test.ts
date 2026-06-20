import assert from "node:assert/strict"
import { mkdtemp } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { test } from "vitest"
import { ModelsServiceImpl } from "./node.ts"
import { ModelsStore } from "./store.ts"

test("ModelsServiceImpl preserves custom model image support on update", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "lumo-models-service-"))
  const service = new ModelsServiceImpl({ store: new ModelsStore(dir) })

  const created = await service.saveCustomModel({
    providerId: "openrouter",
    providerName: "OpenRouter",
    baseUrl: "https://openrouter.ai/api/v1",
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
    baseUrl: "https://openrouter.ai/api/v1",
    modelName: "vision-model-v2",
  })

  assert.equal(updated.customModels[0]?.supportsImages, true)
})

test("ModelsServiceImpl defaults known provider image support but honors user choices", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "lumo-models-service-"))
  const service = new ModelsServiceImpl({ store: new ModelsStore(dir) })

  const qwen = await service.saveCustomModel({
    providerId: "qwen",
    providerName: "Qwen",
    baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
    apiKey: "sk-secret",
    modelName: "qwen3.7-plus",
  })
  assert.equal(qwen.customModels[0]?.supportsImages, true)

  const openRouter = await service.saveCustomModel({
    providerId: "openrouter",
    providerName: "OpenRouter",
    baseUrl: "https://openrouter.ai/api/v1",
    apiKey: "sk-secret",
    modelName: "openai/gpt-5.5",
    supportsImages: true,
  })

  assert.equal(openRouter.customModels.at(-1)?.supportsImages, true)
})
