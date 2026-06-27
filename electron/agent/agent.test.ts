import assert from "node:assert/strict"
import { mkdtemp, stat } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { test } from "vitest"
import { branding } from "../branding.ts"
import { ooEndpoint } from "../domain.ts"
import { BUILTIN_MODEL_DEFINITIONS, BUILTIN_PROVIDER_DEFINITIONS, resolveBuiltinModel } from "../models/builtin.ts"
import { buildOpencodeConfig, customProviderId, WANTA_AGENT_NAME, WANTA_MODEL_ID, WANTA_PROVIDER_ID } from "./config.ts"
import { AgentManager } from "./manager.ts"
import { AUTH_BLOCKING_ERROR_CODES, buildOoEnv, isAuthBlocking, parseConnectorErrorCode } from "./oo.ts"
import { WANTA_SYSTEM_PROMPT } from "./system-prompt.ts"
import { AGENT_TOOL_FILES } from "./tool-sources.ts"

test("buildOpencodeConfig wires the default Auto OOMOL compatible model", () => {
  const config = buildOpencodeConfig({ authToken: "api-test" })
  assert.equal(config.model, `${WANTA_PROVIDER_ID}/${WANTA_MODEL_ID}`)
  assert.equal(config.model, "oomol/oopilot")
  const provider = config.provider?.[WANTA_PROVIDER_ID]
  assert.ok(provider)
  assert.equal(provider.npm, "@ai-sdk/openai-compatible")
  assert.equal(provider.options?.baseURL, `https://llm.${ooEndpoint}/v1`)
  assert.equal(provider.options?.apiKey, "api-test")
  const model = provider.models?.[WANTA_MODEL_ID]
  assert.ok(model)
  assert.equal(model.attachment, true)
  assert.deepEqual(model.modalities, { input: ["text", "image"], output: ["text"] })
})

test("buildOpencodeConfig wires the oomol openai-compatible provider", () => {
  const config = buildOpencodeConfig({ authToken: "api-test" })
  const auto = resolveBuiltinModel("oopilot")
  const provider = config.provider?.[auto.runtime.providerID]
  assert.ok(provider)
  assert.equal(provider.npm, "@ai-sdk/openai-compatible")
  assert.equal(provider.options?.baseURL, `https://llm.${ooEndpoint}/v1`)
  assert.equal(provider.options?.apiKey, "api-test")
  const model = provider.models?.[auto.runtime.modelID]
  assert.ok(model)
  assert.equal(model.attachment, true)
  assert.deepEqual(model.modalities, { input: ["text", "image"], output: ["text"] })
})

test("buildOpencodeConfig covers every registered built-in model runtime", () => {
  const config = buildOpencodeConfig({ authToken: "api-test" })

  for (const providerDefinition of BUILTIN_PROVIDER_DEFINITIONS) {
    const provider = config.provider?.[providerDefinition.id]
    assert.ok(provider, `missing built-in provider ${providerDefinition.id}`)
    assert.equal(provider.name, providerDefinition.displayName)
    assert.equal(provider.options?.baseURL, `https://llm.${ooEndpoint}/v1`)
    assert.equal(provider.options?.apiKey, "api-test")
    assert.equal(provider.npm, providerDefinition.npm)
  }

  for (const definition of BUILTIN_MODEL_DEFINITIONS) {
    const provider = config.provider?.[definition.runtime.providerID]
    const model = provider?.models?.[definition.runtime.modelID]
    assert.ok(model, `missing built-in model ${definition.runtime.providerID}/${definition.runtime.modelID}`)
    assert.equal(model.name, definition.displayName)
    assert.equal(model.tool_call, definition.capabilities.toolCall)
    assert.equal(model.attachment, definition.capabilities.supportsImages ? true : undefined)
  }
})

test("GPT 5.5 resolves through the OpenAI provider for Responses API semantics", () => {
  const gpt55 = resolveBuiltinModel("gpt-5.5")
  assert.deepEqual(gpt55.runtime, { providerID: "openai", modelID: "gpt-5.5" })
  const config = buildOpencodeConfig({ authToken: "api-test" })
  const provider = config.provider?.[gpt55.runtime.providerID]
  const model = provider?.models?.[gpt55.runtime.modelID]
  assert.ok(provider)
  assert.equal(provider.npm, undefined)
  assert.equal(provider.options?.baseURL, `https://llm.${ooEndpoint}/v1`)
  assert.equal(provider.options?.apiKey, "api-test")
  assert.ok(model)
  assert.equal(model.name, "GPT 5.5")
  assert.equal(model.attachment, true)
  assert.deepEqual(model.modalities, { input: ["text", "image"], output: ["text"] })
})

test("buildOpencodeConfig wires text-only custom openai-compatible providers without changing the default model", () => {
  const config = buildOpencodeConfig({
    authToken: "api-test",
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
  assert.equal(config.model, `${WANTA_PROVIDER_ID}/${WANTA_MODEL_ID}`)
  const provider = config.provider?.[customProviderId("custom-1")]
  assert.ok(provider)
  assert.equal(provider.npm, "@ai-sdk/openai-compatible")
  assert.equal(provider.options?.baseURL, "https://api.deepseek.com/v1")
  assert.equal(provider.options?.apiKey, "sk-custom")
  const model = provider.models?.["deepseek-chat"]
  assert.equal(model?.tool_call, true)
  assert.equal(model?.attachment, undefined)
  assert.equal(model?.modalities, undefined)
})

test("buildOpencodeConfig marks custom providers as image-capable only when requested", () => {
  const config = buildOpencodeConfig({
    authToken: "api-test",
    customModels: [
      {
        id: "custom-vision",
        providerName: "OpenRouter",
        baseUrl: "https://openrouter.ai/api/v1",
        apiKey: "sk-custom",
        modelName: "vision-model",
        supportsImages: true,
      },
    ],
  })

  const model = config.provider?.[customProviderId("custom-vision")]?.models?.["vision-model"]

  assert.equal(model?.attachment, true)
  assert.deepEqual(model?.modalities, { input: ["text", "image"], output: ["text"] })
})

test("wanta agent enables built-in coding/shell tools alongside connector tools, permissions allowed", () => {
  const config = buildOpencodeConfig({ authToken: "k" })
  const agent = config.agent?.[WANTA_AGENT_NAME]
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

test("system prompt treats Link as a contextual capability, not the default path", () => {
  assert.match(WANTA_SYSTEM_PROMPT, /work agent/)
  assert.match(WANTA_SYSTEM_PROMPT, /Start from the result the user needs/)
  assert.match(WANTA_SYSTEM_PROMPT, /Tools are means to finish work, not features to showcase/)
  assert.match(
    WANTA_SYSTEM_PROMPT,
    /Use Link tools only when the task requires private\/account-specific data or actions inside a SaaS account/,
  )
  assert.match(WANTA_SYSTEM_PROMPT, /Authorized providers.*are context only/s)
  assert.match(WANTA_SYSTEM_PROMPT, /concrete URL.*local web tools/s)
  assert.match(WANTA_SYSTEM_PROMPT, /Locate and read the relevant context before editing/)
  assert.match(WANTA_SYSTEM_PROMPT, /Use focused validation when feasible/)
  assert.match(WANTA_SYSTEM_PROMPT, new RegExp(`${branding.organizationName} connectors`))
  assert.match(WANTA_SYSTEM_PROMPT, /search_actions when needed.*inspect_action.*call_action/s)
  assert.match(WANTA_SYSTEM_PROMPT, /inline Connect button/)
  assert.match(WANTA_SYSTEM_PROMPT, /avoid writing manual navigation paths/)
})

test("buildOoEnv injects the required OO_* control vars (R3)", () => {
  const env = buildOoEnv({
    authToken: "api-x",
    organizationName: "acme-corp",
    organizationScopePath: "/tmp/scope.json",
    storeDir: "/tmp/store",
    ooBinPath: "/usr/bin/oo",
  })
  assert.equal(env.OO_API_KEY, "api-x")
  assert.equal(env.OO_ENDPOINT, ooEndpoint)
  assert.equal(env.OO_SKILLS_SYNC_DISABLED, "1")
  assert.equal(env.OO_NO_SELF_UPDATE, "1")
  assert.equal(env.OO_TELEMETRY_DISABLED, "1")
  assert.equal(env.OO_LOG_LEVEL, "warn")
  assert.ok(env.OO_CONFIG_DIR.endsWith("/store/config"))
  assert.ok(env.OO_DATA_DIR.endsWith("/store/data"))
  assert.ok(env.OO_LOG_DIR.endsWith("/store/log"))
  assert.equal(env.WANTA_CONSOLE_URL, `https://console.${ooEndpoint}`)
  assert.equal(env.WANTA_OO_BIN, "/usr/bin/oo")
  assert.equal(env.WANTA_ORGANIZATION_NAME, "acme-corp")
  assert.equal(env.WANTA_ORGANIZATION_SCOPE_PATH, "/tmp/scope.json")
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
  assert.ok(AGENT_TOOL_FILES["search_actions.ts"]?.includes("private/account-specific SaaS data or actions"))
  assert.ok(AGENT_TOOL_FILES["search_actions.ts"]?.includes("concrete URLs"))
  assert.ok(AGENT_TOOL_FILES["inspect_action.ts"]?.includes("connector"))
  assert.ok(AGENT_TOOL_FILES["inspect_action.ts"]?.includes("schema"))
  assert.ok(AGENT_TOOL_FILES["inspect_action.ts"]?.includes("does not mean you must execute the action"))
  assert.ok(AGENT_TOOL_FILES["call_action.ts"]?.includes("authorization_required"))
  assert.ok(AGENT_TOOL_FILES["call_action.ts"]?.includes("do not probe unrelated services or actions"))
})

test("createArtifactDir creates an isolated per-session turn directory", async () => {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), "wanta-agent-artifacts-"))
  const manager = new AgentManager({
    authToken: "api-test",
    opencodeBinPath: "/bin/opencode",
    ooBinPath: "/bin/oo",
    rootDir,
  })

  const first = await manager.createArtifactDir("session/one")
  const second = await manager.createArtifactDir("session/one")

  assert.notEqual(first, second)
  assert.ok(first.startsWith(path.join(rootDir, "artifacts", "session_one")))
  assert.ok((await stat(first)).isDirectory())
  assert.ok((await stat(second)).isDirectory())
})
