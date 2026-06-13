import assert from "node:assert/strict"
import { test } from "vitest"
import { ooEndpoint } from "../domain.ts"
import { buildOpencodeConfig, customProviderId, LUMO_AGENT_NAME, LUMO_MODEL_ID, LUMO_PROVIDER_ID } from "./config.ts"
import { AUTH_BLOCKING_ERROR_CODES, buildOoEnv, isAuthBlocking, parseConnectorErrorCode } from "./oo.ts"
import { AGENT_TOOL_FILES } from "./tool-sources.ts"

test("buildOpencodeConfig wires the oomol openai-compatible provider (derived baseURL)", () => {
  const config = buildOpencodeConfig({ apiKey: "api-test" })
  assert.equal(config.model, `${LUMO_PROVIDER_ID}/${LUMO_MODEL_ID}`)
  const provider = config.provider?.[LUMO_PROVIDER_ID]
  assert.ok(provider)
  assert.equal(provider.npm, "@ai-sdk/openai-compatible")
  assert.equal(provider.options?.baseURL, `https://llm.${ooEndpoint}/v1`)
  assert.equal(provider.options?.apiKey, "api-test")
  assert.ok(provider.models?.[LUMO_MODEL_ID])
})

test("buildOpencodeConfig wires custom openai-compatible providers without changing the default model", () => {
  const config = buildOpencodeConfig({
    apiKey: "api-test",
    customModels: [
      {
        id: "custom-1",
        providerName: "DeepSeek",
        baseUrl: "https://api.deepseek.com/v1",
        apiKey: "sk-custom",
        modelName: "deepseek-chat",
      },
    ],
  })
  assert.equal(config.model, `${LUMO_PROVIDER_ID}/${LUMO_MODEL_ID}`)
  const provider = config.provider?.[customProviderId("custom-1")]
  assert.ok(provider)
  assert.equal(provider.npm, "@ai-sdk/openai-compatible")
  assert.equal(provider.options?.baseURL, "https://api.deepseek.com/v1")
  assert.equal(provider.options?.apiKey, "sk-custom")
  assert.equal(provider.models?.["deepseek-chat"]?.tool_call, true)
})

test("lumo agent enables built-in coding/shell tools alongside connector tools, permissions allowed", () => {
  const config = buildOpencodeConfig({ apiKey: "k" })
  const agent = config.agent?.[LUMO_AGENT_NAME]
  assert.ok(agent)
  assert.ok(typeof agent.prompt === "string" && agent.prompt.length > 0)
  // 不再下发 tools 禁用表：所有内置工具（bash/edit/write/read/webfetch/…）默认启用。
  const tools = agent.tools ?? {}
  for (const builtin of ["bash", "edit", "write", "read", "webfetch"]) {
    assert.notEqual(tools[builtin], false, `${builtin} should not be disabled`)
  }
  // permission 全 allow（含 external_directory，文件工具可越出 workspace cwd）。
  assert.equal(agent.permission?.bash, "allow")
  assert.equal(agent.permission?.edit, "allow")
  assert.equal(agent.permission?.webfetch, "allow")
  assert.equal(config.permission?.bash, "allow")
})

test("buildOoEnv injects the required OO_* control vars (R3)", () => {
  const env = buildOoEnv({ apiKey: "api-x", storeDir: "/tmp/store", ooBinPath: "/usr/bin/oo" })
  assert.equal(env.OO_API_KEY, "api-x")
  assert.equal(env.OO_ENDPOINT, ooEndpoint)
  assert.equal(env.OO_SKILLS_SYNC_DISABLED, "1")
  assert.equal(env.OO_NO_SELF_UPDATE, "1")
  assert.equal(env.OO_TELEMETRY_DISABLED, "1")
  assert.equal(env.OO_LOG_LEVEL, "warn")
  assert.ok(env.OO_CONFIG_DIR.endsWith("/store/config"))
  assert.ok(env.OO_DATA_DIR.endsWith("/store/data"))
  assert.ok(env.OO_LOG_DIR.endsWith("/store/log"))
  assert.equal(env.LUMO_CONSOLE_URL, `https://console.${ooEndpoint}`)
  assert.equal(env.LUMO_OO_BIN, "/usr/bin/oo")
})

test("parseConnectorErrorCode extracts code in both en and zh (full-width parens) locales", () => {
  assert.equal(parseConnectorErrorCode("Request failed (errorCode: app_not_found)"), "app_not_found")
  assert.equal(parseConnectorErrorCode("执行失败（errorCode: scope_missing）"), "scope_missing")
  assert.equal(parseConnectorErrorCode("HTTP 500 with no code"), null)
})

test("isAuthBlocking flags the upstream authorization-blocking codes", () => {
  for (const code of AUTH_BLOCKING_ERROR_CODES) {
    assert.equal(isAuthBlocking(code), true)
  }
  assert.equal(isAuthBlocking("rate_limited"), false)
  assert.equal(isAuthBlocking(null), false)
})

test("agent tool sources are present and shaped", () => {
  assert.ok(AGENT_TOOL_FILES["search_actions.ts"]?.includes("connector"))
  assert.ok(AGENT_TOOL_FILES["search_actions.ts"]?.includes("@opencode-ai/plugin"))
  assert.ok(AGENT_TOOL_FILES["inspect_action.ts"]?.includes("connector"))
  assert.ok(AGENT_TOOL_FILES["inspect_action.ts"]?.includes("schema"))
  assert.ok(AGENT_TOOL_FILES["call_action.ts"]?.includes("authorization_required"))
})
