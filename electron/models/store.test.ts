import assert from "node:assert/strict"
import { mkdtempSync, readdirSync, statSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { test } from "vitest"
import { defaultModelChoice, ModelsStore, sanitizeBaseUrl } from "./store.ts"

test("ModelsStore returns default catalog on missing file", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "lumo-models-"))
  const store = new ModelsStore(dir)
  const catalog = await store.catalog()
  assert.deepEqual(catalog.selected, defaultModelChoice())
  assert.deepEqual(
    catalog.builtins.map((model) => model.id),
    [
      "oopilot",
      "gpt-5.5",
      "deepseek-v4-flash",
      "deepseek-v4-pro",
      "qwen3.7-plus",
      "kimi/kimi-k2.7-code-highspeed",
      "kimi/kimi-k2.7-code",
      "ZHIPU/GLM-5.2",
      "qwen3.7-max",
      "xiaomi/mimo-v2.5-pro",
    ],
  )
  assert.equal(catalog.customModels.length, 0)
  assert.ok(catalog.providers.some((provider) => provider.id === "deepseek"))
})

test("ModelsStore exposes provider default URLs and model options", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "lumo-models-"))
  const store = new ModelsStore(dir)
  const catalog = await store.catalog()
  const providers = new Map(catalog.providers.map((provider) => [provider.id, provider]))

  assert.equal(providers.get("deepseek")?.baseUrl, "https://api.deepseek.com")
  assert.equal(providers.get("deepseek")?.modelOptions?.[0]?.id, "deepseek-v4-flash")
  assert.equal(providers.get("deepseek")?.supportsImages, false)
  assert.equal(providers.get("openrouter")?.baseUrl, "https://openrouter.ai/api/v1")
  assert.equal(providers.get("openrouter")?.apiRegions, undefined)
  assert.equal(providers.get("openrouter")?.modelOptions, undefined)
  assert.equal(providers.get("openrouter")?.supportsImages, undefined)
  assert.equal(providers.get("zhipu")?.baseUrl, "https://open.bigmodel.cn/api/paas/v4")
  assert.deepEqual(providers.get("zhipu")?.apiRegions, [
    { id: "cn", baseUrl: "https://open.bigmodel.cn/api/paas/v4" },
    { id: "global", baseUrl: "https://api.z.ai/api/paas/v4" },
  ])
  assert.deepEqual(providers.get("zhipu")?.apiPlans, [
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
  ])
  assert.equal(providers.get("zhipu")?.supportsImages, false)
  assert.equal(providers.get("kimi")?.baseUrl, "https://api.moonshot.cn/v1")
  assert.deepEqual(providers.get("kimi")?.apiRegions, [
    { id: "cn", baseUrl: "https://api.moonshot.cn/v1" },
    { id: "global", baseUrl: "https://api.moonshot.ai/v1" },
  ])
  assert.deepEqual(
    providers.get("kimi")?.modelOptions?.map((model) => model.id),
    ["kimi-k2.7-code", "kimi-k2.7-code-highspeed", "kimi-k2.6"],
  )
  assert.deepEqual(
    providers.get("kimi")?.modelOptions?.map((model) => model.supportsImages),
    [true, true, true],
  )
  assert.equal(providers.get("minimax")?.baseUrl, "https://api.minimaxi.com/v1")
  assert.deepEqual(providers.get("minimax")?.apiRegions, [
    { id: "cn", baseUrl: "https://api.minimaxi.com/v1" },
    { id: "global", baseUrl: "https://api.minimax.io/v1" },
  ])
  assert.deepEqual(
    providers.get("minimax")?.modelOptions?.map((model) => [model.id, model.supportsImages]),
    [
      ["MiniMax-M3", true],
      ["MiniMax-M2.7", false],
      ["MiniMax-M2.7-highspeed", false],
      ["MiniMax-M2.5", false],
      ["MiniMax-M2.5-highspeed", false],
      ["MiniMax-M2.1", false],
      ["MiniMax-M2.1-highspeed", false],
      ["MiniMax-M2", false],
    ],
  )
  assert.equal(providers.get("qwen")?.baseUrl, "https://dashscope.aliyuncs.com/compatible-mode/v1")
  assert.equal(providers.get("qwen")?.displayName, "Qwen")
  assert.deepEqual(providers.get("qwen")?.apiRegions, [
    { id: "cn", baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1" },
    { id: "global", baseUrl: "https://dashscope-us.aliyuncs.com/compatible-mode/v1" },
  ])
  assert.deepEqual(providers.get("qwen")?.apiPlans, [
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
  ])
  assert.deepEqual(
    providers.get("qwen")?.modelOptions?.map((model) => [model.id, model.supportsImages]),
    [
      ["qwen3.7-plus", true],
      ["qwen3.7-max", true],
    ],
  )
  assert.equal(providers.get("xiaomi")?.baseUrl, "https://api.xiaomimimo.com/v1")
  assert.deepEqual(providers.get("xiaomi")?.apiPlans, [
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
  ])
  assert.deepEqual(
    providers.get("xiaomi")?.modelOptions?.map((model) => [model.id, model.supportsImages]),
    [
      ["mimo-v2.5-pro", false],
      ["mimo-v2.5", true],
    ],
  )
  assert.equal(providers.has("gemini"), false)
  assert.equal(providers.has("ollama"), false)
})

test("ModelsStore persists custom models but public catalog redacts apiKey", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "lumo-models-"))
  const store = new ModelsStore(dir)
  await store.write({
    selected: { kind: "custom", id: "m1" },
    customModels: [
      {
        id: "m1",
        providerId: "deepseek",
        providerName: "DeepSeek",
        baseUrl: "https://api.deepseek.com/v1",
        apiKey: "sk-secret",
        modelName: "deepseek-chat",
      },
    ],
  })
  const catalog = await store.catalog()
  assert.deepEqual(catalog.selected, { kind: "custom", id: "m1" })
  assert.deepEqual(catalog.customModels[0], {
    id: "m1",
    providerId: "deepseek",
    providerName: "DeepSeek",
    baseUrl: "https://api.deepseek.com/v1",
    modelName: "deepseek-chat",
    displayName: "DeepSeek:deepseek-chat",
    apiKeyConfigured: true,
    supportsImages: false,
  })
  assert.equal(statSync(path.join(dir, "models.json")).mode & 0o777, 0o600)
  assert.deepEqual(readdirSync(dir), ["models.json"])
})

test("ModelsStore exposes custom model image support", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "lumo-models-"))
  const store = new ModelsStore(dir)
  await store.write({
    selected: { kind: "custom", id: "m1" },
    customModels: [
      {
        id: "m1",
        providerId: "openrouter",
        providerName: "OpenRouter",
        baseUrl: "https://openrouter.ai/api/v1",
        apiKey: "sk-secret",
        modelName: "vision-model",
        supportsImages: true,
      },
    ],
  })

  const catalog = await store.catalog()

  assert.equal(catalog.customModels[0]?.supportsImages, true)
})

test("sanitizeBaseUrl trims trailing slash and rejects invalid protocols", () => {
  assert.equal(sanitizeBaseUrl(" https://openrouter.ai/api/v1/ "), "https://openrouter.ai/api/v1")
  assert.throws(() => sanitizeBaseUrl("file:///tmp/model"))
})
