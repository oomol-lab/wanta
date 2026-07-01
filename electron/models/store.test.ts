import assert from "node:assert/strict"
import { mkdtempSync, readdirSync, statSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { test } from "vitest"
import { externalModelProviderBaseUrls } from "../domain.ts"
import { defaultModelChoice, ModelsStore, sanitizeBaseUrl } from "./store.ts"

const providerBaseUrls = externalModelProviderBaseUrls

test("ModelsStore returns default catalog on missing file", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "wanta-models-"))
  const store = new ModelsStore(dir)
  const catalog = await store.catalog()
  assert.deepEqual(catalog.selected, defaultModelChoice())
  assert.deepEqual(
    catalog.builtins.map((model) => model.id),
    ["oopilot", "gpt-5.5", "deepseek-v4-flash", "deepseek-v4-pro", "qwen3.7-plus", "qwen3.7-max"],
  )
  assert.equal(catalog.customModels.length, 0)
  assert.ok(catalog.providers.some((provider) => provider.id === "deepseek"))
})

test("ModelsStore exposes provider default URLs and model options", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "wanta-models-"))
  const store = new ModelsStore(dir)
  const catalog = await store.catalog()
  const providers = new Map(catalog.providers.map((provider) => [provider.id, provider]))

  assert.equal(providers.get("deepseek")?.baseUrl, providerBaseUrls.deepseek)
  assert.equal(providers.get("deepseek")?.modelOptions?.[0]?.id, "deepseek-v4-flash")
  assert.equal(providers.get("deepseek")?.supportsImages, false)
  assert.equal(providers.get("openrouter")?.baseUrl, providerBaseUrls.openrouter)
  assert.equal(providers.get("openrouter")?.apiRegions, undefined)
  assert.equal(providers.get("openrouter")?.modelOptions, undefined)
  assert.equal(providers.get("openrouter")?.supportsImages, undefined)
  assert.equal(providers.get("zhipu")?.baseUrl, providerBaseUrls.zhipuCn)
  assert.deepEqual(providers.get("zhipu")?.apiRegions, [
    { id: "cn", baseUrl: providerBaseUrls.zhipuCn },
    { id: "global", baseUrl: providerBaseUrls.zhipuGlobal },
  ])
  assert.deepEqual(providers.get("zhipu")?.apiPlans, [
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
  ])
  assert.equal(providers.get("zhipu")?.supportsImages, false)
  assert.equal(providers.get("kimi")?.baseUrl, providerBaseUrls.kimiCn)
  assert.deepEqual(providers.get("kimi")?.apiRegions, [
    { id: "cn", baseUrl: providerBaseUrls.kimiCn },
    { id: "global", baseUrl: providerBaseUrls.kimiGlobal },
  ])
  assert.deepEqual(
    providers.get("kimi")?.modelOptions?.map((model) => model.id),
    ["kimi-k2.7-code", "kimi-k2.7-code-highspeed", "kimi-k2.6"],
  )
  assert.deepEqual(
    providers.get("kimi")?.modelOptions?.map((model) => model.supportsImages),
    [true, true, true],
  )
  assert.equal(providers.get("minimax")?.baseUrl, providerBaseUrls.minimaxCn)
  assert.deepEqual(providers.get("minimax")?.apiRegions, [
    { id: "cn", baseUrl: providerBaseUrls.minimaxCn },
    { id: "global", baseUrl: providerBaseUrls.minimaxGlobal },
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
  assert.equal(providers.get("qwen")?.baseUrl, providerBaseUrls.qwenStandardCn)
  assert.equal(providers.get("qwen")?.displayName, "Qwen")
  assert.deepEqual(providers.get("qwen")?.apiRegions, [
    { id: "cn", baseUrl: providerBaseUrls.qwenStandardCn },
    { id: "global", baseUrl: providerBaseUrls.qwenStandardGlobal },
  ])
  assert.deepEqual(providers.get("qwen")?.apiPlans, [
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
  ])
  assert.deepEqual(
    providers.get("qwen")?.modelOptions?.map((model) => [model.id, model.supportsImages]),
    [
      ["qwen3.7-plus", true],
      ["qwen3.7-max", true],
    ],
  )
  assert.equal(providers.get("xiaomi")?.baseUrl, providerBaseUrls.xiaomiStandard)
  assert.deepEqual(providers.get("xiaomi")?.apiPlans, [
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
  const dir = mkdtempSync(path.join(tmpdir(), "wanta-models-"))
  const store = new ModelsStore(dir)
  await store.write({
    selected: { kind: "custom", id: "m1" },
    customModels: [
      {
        id: "m1",
        providerId: "deepseek",
        providerName: "DeepSeek",
        baseUrl: `${providerBaseUrls.deepseek}/v1`,
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
    baseUrl: `${providerBaseUrls.deepseek}/v1`,
    modelName: "deepseek-chat",
    displayName: "DeepSeek:deepseek-chat",
    apiKeyConfigured: true,
    supportsImages: false,
    supportsToolCalls: true,
  })
  assert.equal(statSync(path.join(dir, "models.json")).mode & 0o777, 0o600)
  assert.deepEqual(readdirSync(dir), ["models.json"])
})

test("ModelsStore exposes custom model image support", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "wanta-models-"))
  const store = new ModelsStore(dir)
  await store.write({
    selected: { kind: "custom", id: "m1" },
    customModels: [
      {
        id: "m1",
        providerId: "openrouter",
        providerName: "OpenRouter",
        baseUrl: providerBaseUrls.openrouter,
        apiKey: "sk-secret",
        modelName: "vision-model",
        supportsImages: true,
        inputTokenLimit: 128_000,
      },
    ],
  })

  const catalog = await store.catalog()

  assert.equal(catalog.customModels[0]?.supportsImages, true)
  assert.equal(catalog.customModels[0]?.inputTokenLimit, 128_000)
})

test("sanitizeBaseUrl trims trailing slash and rejects invalid protocols", () => {
  assert.equal(sanitizeBaseUrl(` ${providerBaseUrls.openrouter}/ `), providerBaseUrls.openrouter)
  assert.throws(() => sanitizeBaseUrl("file:///tmp/model"))
})
