import assert from "node:assert/strict"
import { mkdtempSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { test } from "vitest"
import { externalModelProviderBaseUrls } from "../domain.ts"
import { ModelCredentialStore } from "./credential-store.ts"
import { defaultModelChoice, ModelsStore, sanitizeBaseUrl } from "./store.ts"

const providerBaseUrls = externalModelProviderBaseUrls

function createStore(dir: string): { credentials: ModelCredentialStore; store: ModelsStore } {
  const credentials = new ModelCredentialStore(
    dir,
    {
      decryptString: (encrypted) => encrypted.toString("utf8").replace(/^encrypted:/, ""),
      encryptString: (plainText) => Buffer.from(`encrypted:${plainText}`, "utf8"),
      isEncryptionAvailable: () => true,
    },
    "darwin",
  )
  return { credentials, store: new ModelsStore(dir, credentials) }
}

test("ModelsStore returns default catalog on missing file", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "wanta-models-"))
  const { store } = createStore(dir)
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
  const { store } = createStore(dir)
  const catalog = await store.catalog()
  const providers = new Map(catalog.providers.map((provider) => [provider.id, provider]))

  assert.equal(providers.get("deepseek")?.baseUrl, providerBaseUrls.deepseek)
  assert.equal(providers.get("deepseek")?.modelOptions?.[0]?.id, "deepseek-v4-flash")
  assert.equal(providers.get("deepseek")?.supportsImages, false)
  assert.equal(providers.get("openrouter")?.baseUrl, providerBaseUrls.openrouter)
  assert.equal(providers.get("openrouter")?.apiRegions, undefined)
  assert.equal(providers.get("openrouter")?.modelOptions, undefined)
  assert.equal(providers.get("openrouter")?.supportsImages, undefined)
  assert.equal(providers.get("gemini")?.baseUrl, providerBaseUrls.gemini)
  assert.deepEqual(
    providers
      .get("gemini")
      ?.modelOptions?.map((model) => [
        model.id,
        model.supportsImages,
        model.supportsToolCalls,
        model.contextWindow,
        model.inputTokenLimit,
        model.maxOutputTokens,
      ]),
    [
      ["gemini-3.5-flash", true, true, 1_114_112, 1_048_576, 65_536],
      ["gemini-3.1-pro-preview", true, true, 1_114_112, 1_048_576, 65_536],
      ["gemini-2.5-pro", true, true, 1_114_112, 1_048_576, 65_536],
    ],
  )
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
  assert.equal(providers.get("zhipu")?.supportsToolCalls, true)
  assert.deepEqual(
    providers
      .get("zhipu")
      ?.modelOptions?.map((model) => [model.id, model.contextWindow, model.maxOutputTokens, model.reasoningVariants]),
    [
      ["glm-5.2", 1_000_000, 128_000, ["high", "max"]],
      ["glm-5.1", undefined, undefined, undefined],
      ["glm-5-turbo", undefined, undefined, undefined],
      ["glm-5", undefined, undefined, undefined],
      ["glm-4.7", 204_800, 128_000, undefined],
      ["glm-4.7-flash", 204_800, 128_000, undefined],
    ],
  )
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
    providers.get("kimi")?.modelOptions?.map((model) => [model.supportsImages, model.contextWindow]),
    [
      [true, 262_144],
      [true, 262_144],
      [true, 262_144],
    ],
  )
  assert.equal(providers.get("kimi")?.supportsToolCalls, true)
  assert.equal(providers.get("minimax")?.baseUrl, providerBaseUrls.minimaxCn)
  assert.deepEqual(providers.get("minimax")?.apiRegions, [
    { id: "cn", baseUrl: providerBaseUrls.minimaxCn },
    { id: "global", baseUrl: providerBaseUrls.minimaxGlobal },
  ])
  assert.deepEqual(
    providers
      .get("minimax")
      ?.modelOptions?.map((model) => [model.id, model.supportsImages, model.contextWindow, model.maxOutputTokens]),
    [
      ["MiniMax-M3", true, 1_000_000, undefined],
      ["MiniMax-M2.7", false, 204_800, 128_000],
      ["MiniMax-M2.7-highspeed", false, 204_800, 128_000],
      ["MiniMax-M2.5", false, 204_800, 128_000],
      ["MiniMax-M2.5-highspeed", false, 204_800, 128_000],
      ["MiniMax-M2.1", false, 204_800, 128_000],
      ["MiniMax-M2.1-highspeed", false, 204_800, 128_000],
      ["MiniMax-M2", false, 204_800, 128_000],
    ],
  )
  assert.equal(providers.get("minimax")?.supportsToolCalls, true)
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
    providers.get("xiaomi")?.modelOptions?.map((model) => [model.id, model.supportsImages, model.contextWindow]),
    [
      ["mimo-v2.5-pro", false, 1_000_000],
      ["mimo-v2.5", true, 1_000_000],
    ],
  )
  assert.equal(providers.get("xiaomi")?.supportsToolCalls, true)
  assert.equal(providers.has("ollama"), false)
})

test("ModelsStore persists credential metadata while public catalog and models.json redact apiKey", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "wanta-models-"))
  const { credentials, store } = createStore(dir)
  await credentials.set("m1", "sk-secret")
  const modelWithRuntimeSecret = {
    id: "m1",
    providerId: "deepseek",
    providerName: "DeepSeek",
    baseUrl: `${providerBaseUrls.deepseek}/v1`,
    apiKeyConfigured: true,
    // 即使调用方误把 runtime 对象传给元数据写入，store 也必须按字段白名单剥离凭证。
    apiKey: "must-never-be-written",
    modelName: "deepseek-chat",
  }
  await store.write({
    selected: { kind: "custom", id: "m1" },
    customModels: [modelWithRuntimeSecret],
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
  assert.equal(statSync(path.join(dir, "model-credentials.json")).mode & 0o777, 0o600)
  assert.equal(readFileSync(path.join(dir, "models.json"), "utf8").includes("sk-secret"), false)
  assert.equal(readFileSync(path.join(dir, "models.json"), "utf8").includes("must-never-be-written"), false)
  assert.equal(readFileSync(path.join(dir, "model-credentials.json"), "utf8").includes("sk-secret"), false)
  assert.deepEqual(readdirSync(dir).sort(), ["model-credentials.json", "models.json"])
})

test("ModelsStore exposes custom model image support", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "wanta-models-"))
  const { credentials, store } = createStore(dir)
  await credentials.set("m1", "sk-secret")
  await store.write({
    selected: { kind: "custom", id: "m1" },
    customModels: [
      {
        id: "m1",
        providerId: "openrouter",
        providerName: "OpenRouter",
        baseUrl: providerBaseUrls.openrouter,
        apiKeyConfigured: true,
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

test("ModelsStore excludes incomplete custom models from runtime configuration", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "wanta-models-"))
  const { store } = createStore(dir)
  await store.write({
    selected: { kind: "custom", id: "missing-key" },
    customModels: [
      {
        id: "missing-key",
        providerId: "custom",
        providerName: "Custom",
        baseUrl: "http://127.0.0.1:11434/v1",
        apiKeyConfigured: false,
        modelName: "local-model",
      },
    ],
  })

  assert.deepEqual((await store.runtimeModels()).customModels, [])
  assert.deepEqual(await store.runtimeCustomModels(), [])
})

test("ModelsStore migrates legacy plaintext API keys before rewriting metadata", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "wanta-models-"))
  writeFileSync(
    path.join(dir, "models.json"),
    JSON.stringify({
      selected: { kind: "custom", id: "legacy" },
      customModels: [
        {
          id: "legacy",
          providerId: "openrouter",
          providerName: "OpenRouter",
          baseUrl: providerBaseUrls.openrouter,
          apiKey: "legacy-secret",
          modelName: "legacy-model",
        },
      ],
    }),
  )
  const { credentials, store } = createStore(dir)

  const models = await store.read()

  assert.equal(models.customModels?.[0]?.apiKeyConfigured, true)
  assert.equal(readFileSync(path.join(dir, "models.json"), "utf8").includes("legacy-secret"), false)
  assert.equal(await credentials.get("legacy"), "legacy-secret")
  assert.equal((await store.runtimeModels()).customModels[0]?.apiKey, "legacy-secret")
})

test("legacy migration keeps the plaintext source when secure credential writing fails", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "wanta-models-"))
  const modelsFile = path.join(dir, "models.json")
  writeFileSync(
    modelsFile,
    JSON.stringify({
      customModels: [
        {
          id: "legacy",
          providerId: "custom",
          providerName: "Custom",
          baseUrl: "https://models.example.test/v1",
          apiKey: "only-copy",
          modelName: "legacy-model",
        },
      ],
    }),
  )
  const credentials = new ModelCredentialStore(
    dir,
    {
      decryptString: () => "",
      encryptString: () => {
        throw new Error("keychain write failed")
      },
      isEncryptionAvailable: () => true,
    },
    "darwin",
  )
  const store = new ModelsStore(dir, credentials)

  await assert.rejects(store.read(), /keychain write failed/)

  assert.equal(readFileSync(modelsFile, "utf8").includes("only-copy"), true)
})

test("legacy migration retains both copies when metadata cleanup fails after secure storage succeeds", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "wanta-models-"))
  const modelsFile = path.join(dir, "models.json")
  writeFileSync(
    modelsFile,
    JSON.stringify({
      customModels: [
        {
          id: "legacy",
          providerId: "custom",
          providerName: "Custom",
          baseUrl: "https://models.example.test/v1",
          apiKey: "migration-secret",
          modelName: "legacy-model",
        },
      ],
    }),
  )
  const { credentials } = createStore(dir)
  const store = new ModelsStore(dir, credentials, {
    writeText: async () => {
      throw new Error("metadata cleanup failed")
    },
  })

  await assert.rejects(store.read(), /metadata cleanup failed/)

  assert.equal(readFileSync(modelsFile, "utf8").includes("migration-secret"), true)
  assert.equal(await credentials.get("legacy"), "migration-secret")
})

test("sanitizeBaseUrl trims trailing slash and rejects invalid protocols", () => {
  assert.equal(sanitizeBaseUrl(` ${providerBaseUrls.openrouter}/ `), providerBaseUrls.openrouter)
  assert.throws(() => sanitizeBaseUrl("file:///tmp/model"))
})
