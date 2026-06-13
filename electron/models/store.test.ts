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
  assert.equal(catalog.customModels.length, 0)
  assert.ok(catalog.providers.some((provider) => provider.id === "deepseek"))
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
  })
  assert.equal(statSync(path.join(dir, "models.json")).mode & 0o777, 0o600)
  assert.deepEqual(readdirSync(dir), ["models.json"])
})

test("sanitizeBaseUrl trims trailing slash and rejects invalid protocols", () => {
  assert.equal(sanitizeBaseUrl(" https://openrouter.ai/api/v1/ "), "https://openrouter.ai/api/v1")
  assert.throws(() => sanitizeBaseUrl("file:///tmp/model"))
})
