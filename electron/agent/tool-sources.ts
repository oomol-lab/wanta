// 自定义工具（R5）的源码，以字符串内嵌：运行时由 workspace.ts 写入
// <workspace>/.opencode/tools/，供 OpenCode sidecar 加载（OpenCode 自带
// @opencode-ai/plugin，无需在 workspace 旁安装）。工具通过 execFile 调用内置
// oo（路径由 WANTA_OO_BIN 注入），将连接器发现/调用/授权信号都走"工具结果"。
//
// 用 String.raw 内嵌：保留正则中的反斜杠；工具代码刻意不含反引号与模板插值语法，
// 故无转义陷阱。这些代码运行在 OpenCode 的 Bun 运行时，不参与本项目 tsc/oxlint。

const LINK_TOOL_RUNTIME_SHARED_TS = String.raw`
const execFileAsync = promisify(execFile)
const OO_BIN = process.env.WANTA_OO_BIN || "oo"
const OO_EXEC_OPTIONS = { maxBuffer: 16 * 1024 * 1024, timeout: 10 * 1000 }

async function currentOrganizationName(sessionID) {
  const scopePath = process.env.WANTA_ORGANIZATION_SCOPE_PATH || ""
  if (scopePath) {
    try {
      const parsed = JSON.parse(await readFile(scopePath, "utf8"))
      const sessionOrganizations = parsed && parsed.sessionOrganizations
      if (
        sessionID &&
        sessionOrganizations &&
        typeof sessionOrganizations === "object" &&
        typeof sessionOrganizations[sessionID] === "string"
      ) {
        return sessionOrganizations[sessionID]
      }
      if (parsed && typeof parsed.organizationName === "string") {
        return parsed.organizationName
      }
    } catch {
      // 启动期或文件损坏时回退到进程启动时的组织名。
    }
  }
  return process.env.WANTA_ORGANIZATION_NAME || ""
}

async function currentIdentity(sessionID) {
  const organizationName = (await currentOrganizationName(sessionID)).trim()
  return organizationName
    ? { cacheKey: "organization:" + organizationName, organizationName: organizationName, scope: "organization" }
    : { cacheKey: "personal", organizationName: "", scope: "personal" }
}

async function appendIdentityArgs(argv, identity, sessionID) {
  const current = identity || (await currentIdentity(sessionID))
  const organizationName = current.organizationName
  if (organizationName) {
    argv.push("--organization", organizationName)
  } else {
    argv.push("--personal")
  }
  return current.scope
}
`

const SEARCH_ACTIONS_TOOL_TS =
  String.raw`import { tool } from "@opencode-ai/plugin"
import { execFile } from "node:child_process"
import { readFile } from "node:fs/promises"
import { promisify } from "node:util"
` +
  LINK_TOOL_RUNTIME_SHARED_TS +
  String.raw`

function serviceFromApp(app) {
  if (!app || typeof app !== "object") {
    return ""
  }
  return typeof app.service === "string" ? app.service : typeof app.serviceName === "string" ? app.serviceName : ""
}

function isActiveApp(app) {
  if (!app || typeof app !== "object") {
    return false
  }
  return typeof app.status !== "string" || app.status === "active"
}

function parseApps(stdout) {
  const parsed = JSON.parse((stdout || "").trim() || "[]")
  if (Array.isArray(parsed)) {
    return parsed
  }
  if (Array.isArray(parsed && parsed.data)) {
    return parsed.data
  }
  if (Array.isArray(parsed && parsed.apps)) {
    return parsed.apps
  }
  return Array.isArray(parsed && parsed.items) ? parsed.items : []
}

const authorizedServicesCache = new Map()
const AUTHORIZED_SERVICES_CACHE_MS = 5 * 1000
const providerAuthTypesCache = new Map()
const PROVIDER_AUTH_TYPES_CACHE_MS = 30 * 1000

async function authorizedServices(sessionID) {
  const now = Date.now()
  const identity = await currentIdentity(sessionID)
  const cacheKey = identity.cacheKey
  const cached = authorizedServicesCache.get(cacheKey)
  if (cached && now - cached.createdAt < AUTHORIZED_SERVICES_CACHE_MS) {
    return cached.authorization
  }
  const argv = ["connector", "apps"]
  const scope = await appendIdentityArgs(argv, identity)
  argv.push("--json")
  try {
    const result = await execFileAsync(OO_BIN, argv, OO_EXEC_OPTIONS)
    const apps = parseApps(result.stdout)
    const authorization = {
      scope: scope,
      services: new Set(apps.filter(isActiveApp).map(serviceFromApp).filter(Boolean)),
    }
    authorizedServicesCache.set(cacheKey, { createdAt: now, authorization: authorization })
    return authorization
  } catch {
    authorizedServicesCache.set(cacheKey, { createdAt: now, authorization: null })
    return null
  }
}

function parseProviders(payload) {
  if (Array.isArray(payload)) {
    return payload
  }
  if (Array.isArray(payload && payload.data)) {
    return payload.data
  }
  if (Array.isArray(payload && payload.providers)) {
    return payload.providers
  }
  return Array.isArray(payload && payload.items) ? payload.items : []
}

function authTypesFromProvider(provider) {
  if (!provider || typeof provider !== "object" || !Array.isArray(provider.authTypes)) {
    return []
  }
  return provider.authTypes.filter((authType) => typeof authType === "string")
}

function isNoAuthOnly(authTypes) {
  return authTypes.length === 1 && authTypes[0] === "no_auth"
}

async function providerAuthTypes(sessionID) {
  const connectorUrl = String(process.env.WANTA_CONNECTOR_URL || "").replace(/\/+$/, "")
  const token = String(process.env.OO_API_KEY || "")
  if (!connectorUrl || !token) {
    return null
  }
  const now = Date.now()
  const identity = await currentIdentity(sessionID)
  const cacheKey = identity.cacheKey
  const cached = providerAuthTypesCache.get(cacheKey)
  if (cached && now - cached.createdAt < PROVIDER_AUTH_TYPES_CACHE_MS) {
    return cached.authTypesByService
  }
  try {
    const headers = { authorization: "Bearer " + token }
    if (identity.organizationName) {
      headers["x-oo-organization-name"] = identity.organizationName
    }
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 10 * 1000)
    let response
    try {
      response = await fetch(connectorUrl + "/v1/providers", { headers: headers, signal: controller.signal })
    } finally {
      clearTimeout(timer)
    }
    if (!response.ok) {
      providerAuthTypesCache.set(cacheKey, { createdAt: now, authTypesByService: null })
      return null
    }
    const providers = parseProviders(await response.json())
    const authTypesByService = new Map()
    for (const provider of providers) {
      if (!provider || typeof provider !== "object" || typeof provider.service !== "string") {
        continue
      }
      authTypesByService.set(provider.service, authTypesFromProvider(provider))
    }
    providerAuthTypesCache.set(cacheKey, { createdAt: now, authTypesByService: authTypesByService })
    return authTypesByService
  } catch {
    providerAuthTypesCache.set(cacheKey, { createdAt: now, authTypesByService: null })
    return null
  }
}

async function normalizeSearchOutput(stdout, sessionID) {
  const text = (stdout || "").trim()
  try {
    const parsed = JSON.parse(text || "[]")
    if (!Array.isArray(parsed)) {
      return text || "[]"
    }
    const authorization = await authorizedServices(sessionID)
    const authTypesByService = await providerAuthTypes(sessionID)
    return JSON.stringify(
      parsed.map((item) => {
        if (!item || typeof item !== "object") {
          return item
        }
        const service = typeof item.service === "string" ? item.service : ""
        if (!authorization) {
          return { ...item, authenticatedReliable: false, authenticatedScope: "active_workspace_unknown" }
        }
        const authTypes = authTypesByService ? authTypesByService.get(service) : null
        const noAuthReady = Array.isArray(authTypes) && isNoAuthOnly(authTypes)
        return {
          ...item,
          authenticated: noAuthReady || authorization.services.has(service),
          authenticatedReliable: true,
          noAuthReady: noAuthReady,
          authenticatedScope: authorization.scope,
        }
      }),
    )
  } catch {
    return text || "[]"
  }
}

export default tool({
  description:
    "Search the OOMOL connector catalog for Link actions matching a natural-language query. Use this only after deciding the task needs private/account-specific SaaS data or actions and the exact service + action is unknown; use list_apps instead when the user asks what is connected. Do NOT use it for direct answers, local files, concrete URLs, webpage fetching/crawling/scraping, or general web browsing. On success, returns a JSON array; each item has service (slug), name (action name), description, and authenticated (whether the current workspace has already connected that service). authenticatedReliable is true only when Wanta confirmed active-workspace authorization; if authenticatedReliable is false, call_action is the authority for authorization_required. On failure, returns a JSON object with status 'error' and message. If the clearly relevant provider is returned with authenticated false and authenticatedReliable is not false, Wanta can render an inline Connect button from this result, so tell the user briefly that authorization is needed and do not write manual Settings or Connections navigation steps. The search result does NOT include input parameters — after selecting an action, call inspect_action to read its inputSchema before call_action.",
  args: {
    query: tool.schema.string().describe("Natural-language description of the desired action, e.g. 'list hacker news top stories'"),
  },
  async execute(args, context) {
    const argv = ["connector", "search", args.query, "--json"]
    try {
      const result = await execFileAsync(OO_BIN, argv, OO_EXEC_OPTIONS)
      return await normalizeSearchOutput(result.stdout, context.sessionID)
    } catch (error) {
      const e = error || {}
      const message = String(e.stderr || e.message || "search failed").trim()
      return JSON.stringify({ status: "error", message: message })
    }
  },
})
`

const LIST_APPS_TOOL_TS =
  String.raw`import { tool } from "@opencode-ai/plugin"
import { execFile } from "node:child_process"
import { readFile } from "node:fs/promises"
import { promisify } from "node:util"
` +
  LINK_TOOL_RUNTIME_SHARED_TS +
  String.raw`

export default tool({
  description:
    "List connected OOMOL Link provider apps/accounts in the active workspace. Use only for connection inventory or explicit account validation, not as a health check before normal reads or actions. For runnable actions, use search_actions.",
  args: {
    service: tool.schema.string().optional().describe("Optional service slug to filter, e.g. 'gmail'. Omit to list every connected provider app in the active workspace."),
  },
  async execute(args, context) {
    const service = String(args.service || "").trim()
    const identity = await currentIdentity(context.sessionID)
    const argv = ["connector", "apps"]
    if (service) {
      argv.push(service)
    }
    await appendIdentityArgs(argv, identity, context.sessionID)
    argv.push("--json")
    try {
      const result = await execFileAsync(OO_BIN, argv, OO_EXEC_OPTIONS)
      return (result.stdout || "").trim() || "[]"
    } catch (error) {
      const e = error || {}
      const message = String(e.stderr || e.message || "list connected apps failed").trim()
      return JSON.stringify({
        status: "error",
        errorCode: "connection_inventory_unavailable",
        operation: "list_connected_apps",
        workspace: {
          scope: identity.scope,
          organizationName: identity.organizationName || undefined,
        },
        message: message,
      })
    }
  },
})
`

const INSPECT_ACTION_TOOL_TS = String.raw`import { tool } from "@opencode-ai/plugin"
import { execFile } from "node:child_process"
import { promisify } from "node:util"

const execFileAsync = promisify(execFile)
const OO_BIN = process.env.WANTA_OO_BIN || "oo"
const OO_EXEC_OPTIONS = { maxBuffer: 16 * 1024 * 1024, timeout: 10 * 1000 }

export default tool({
  description:
    "Fetch the contract for one or more selected OOMOL Link actions. Pass an 'actions' array of '<service>.<action>' ids: one id returns a single JSON object, two or more ids return a JSON ARRAY of contracts in the same order you requested. Each contract has description, inputSchema (a JSON Schema describing the EXACT input field names, types, required fields, and constraints), and outputSchema. ALWAYS inspect an action before call_action, so the call_action params use the real declared field names instead of guesses; when a workflow needs several contracts (for example an async submit/result pair, or a read step feeding a write step) inspect them all in one call. Inspecting a schema does not mean you must execute the action; if a schema does not fit the task, choose another path or explain the limitation. The schema is identity-independent and read-only; calling it never sends or changes anything.",
  args: {
    actions: tool.schema
      .array(tool.schema.string())
      .describe("One or more action ids in the form '<service>.<action>' (service segment before the first dot, action after it), e.g. ['hackernews.get_item']. When a workflow needs several contracts at once, such as an async submit/result pair or a read step feeding a write step, pass every id in one call, e.g. ['cal.create_schedule','callingly.get_agent_schedule']."),
  },
  async execute(args, context) {
    const ids = (args.actions || []).map((id) => String(id).trim()).filter(Boolean)
    if (ids.length === 0) {
      return JSON.stringify({ status: "error", message: "Provide at least one action id in the form <service>.<action>." })
    }
    const argv = ["connector", "schema", ...ids, "--json"]
    try {
      const result = await execFileAsync(OO_BIN, argv, OO_EXEC_OPTIONS)
      return (result.stdout || "").trim() || "{}"
    } catch (error) {
      const e = error || {}
      const message = String(e.stderr || e.message || "schema lookup failed").trim()
      return JSON.stringify({ status: "error", message: message })
    }
  },
})
`

const CALL_ACTION_TOOL_TS =
  String.raw`import { tool } from "@opencode-ai/plugin"
import { execFile } from "node:child_process"
import { readFile } from "node:fs/promises"
import { promisify } from "node:util"
` +
  LINK_TOOL_RUNTIME_SHARED_TS +
  String.raw`

function authorizationUrl(service) {
  const consoleUrl = String(process.env.WANTA_CONSOLE_URL || "").trim()
  if (!consoleUrl) {
    return null
  }
  return consoleUrl.replace(/\/+$/, "") + "/app-connections?provider=" + encodeURIComponent(service)
}

// 授权阻断码（上游 connector 透传）。命中即返回结构化 authorization_required。
const AUTH_BLOCKING = new Set([
  "connection_required",
  "app_not_found",
  "app_not_ready",
  "credential_expired",
  "scope_missing",
])

const CONNECTION_NAME_CACHE_MS = 5 * 1000
const ACTION_PROBE_CACHE_MS = 5 * 1000
const CONNECTION_BLOCK_MS = 10 * 1000
const MAX_PARALLEL_ACTION_CALLS = 2
const connectionNameLookups = new Map()
const actionProbeStates = new Map()
const connectionBlocks = new Map()

function pruneExpiredRuntimeState(now = Date.now()) {
  for (const [key, cached] of connectionNameLookups) {
    if (now - cached.createdAt >= CONNECTION_NAME_CACHE_MS) connectionNameLookups.delete(key)
  }
  for (const [key, state] of actionProbeStates) {
    if (!state.probePromise && state.active === 0 && now - state.createdAt >= ACTION_PROBE_CACHE_MS) {
      actionProbeStates.delete(key)
    }
  }
  for (const [key, block] of connectionBlocks) {
    if (now >= block.expiresAt) connectionBlocks.delete(key)
  }
}

function parseApps(stdout) {
  const parsed = JSON.parse((stdout || "").trim() || "[]")
  if (Array.isArray(parsed)) {
    return parsed
  }
  if (Array.isArray(parsed && parsed.data)) {
    return parsed.data
  }
  if (Array.isArray(parsed && parsed.apps)) {
    return parsed.apps
  }
  return Array.isArray(parsed && parsed.items) ? parsed.items : []
}

function appConnectionName(app) {
  return app && typeof app === "object" && typeof app.connectionName === "string"
    ? app.connectionName.trim()
    : ""
}

async function knownConnectionNames(service, identity) {
  const key = identity.cacheKey + ":" + service
  const now = Date.now()
  pruneExpiredRuntimeState(now)
  const cached = connectionNameLookups.get(key)
  if (cached && now - cached.createdAt < CONNECTION_NAME_CACHE_MS) {
    return await cached.promise
  }
  const promise = (async () => {
    const argv = ["connector", "apps", service]
    await appendIdentityArgs(argv, identity)
    argv.push("--json")
    try {
      const result = await execFileAsync(OO_BIN, argv, OO_EXEC_OPTIONS)
      const apps = parseApps(result.stdout)
      return {
        names: new Set(
          apps
            .filter((app) => !app || typeof app !== "object" || app.status !== "disconnected")
            .map(appConnectionName)
            .filter(Boolean),
        ),
      }
    } catch (error) {
      const e = error || {}
      return { names: null, message: String(e.stderr || e.message || "connection inventory lookup failed").trim() }
    }
  })()
  connectionNameLookups.set(key, { createdAt: now, promise: promise })
  return await promise
}

function authorizationResult(output) {
  try {
    const parsed = JSON.parse(output || "{}")
    return parsed && parsed.status === "authorization_required" ? parsed : null
  } catch {
    return null
  }
}

function currentConnectionBlock(key) {
  const block = connectionBlocks.get(key)
  if (!block) {
    return null
  }
  if (Date.now() >= block.expiresAt) {
    connectionBlocks.delete(key)
    return null
  }
  return block
}

function skippedForConnectionBlock(args, block) {
  return JSON.stringify({
    status: "skipped",
    reason: "connection_blocked",
    service: args.service,
    action: args.action,
    errorCode: block.authorization && block.authorization.errorCode,
    message: "A matching Link call already reported an authorization block; this call was skipped to avoid duplicate connector requests.",
  })
}

function markConnectionBlock(key, output) {
  const authorization = authorizationResult(output)
  if (authorization) {
    connectionBlocks.set(key, { authorization: authorization, expiresAt: Date.now() + CONNECTION_BLOCK_MS })
  }
}

async function acquireActionSlot(state) {
  if (state.active < MAX_PARALLEL_ACTION_CALLS) {
    state.active += 1
    return
  }
  await new Promise((resolve) => state.waiters.push(resolve))
  state.active += 1
}

function releaseActionSlot(state) {
  state.active -= 1
  const next = state.waiters.shift()
  if (next) {
    next()
  }
}

async function runLimitedAction(state, connectionKey, args, call) {
  await acquireActionSlot(state)
  try {
    const blocked = currentConnectionBlock(connectionKey)
    if (blocked) {
      return skippedForConnectionBlock(args, blocked)
    }
    const output = await call()
    markConnectionBlock(connectionKey, output)
    return output
  } finally {
    releaseActionSlot(state)
  }
}

async function runCoordinatedAction(sessionID, identity, connectionName, args, call) {
  pruneExpiredRuntimeState()
  const target = connectionName || "default"
  const connectionKey = sessionID + ":" + identity.cacheKey + ":" + args.service + ":" + target
  const blocked = currentConnectionBlock(connectionKey)
  if (blocked) {
    return skippedForConnectionBlock(args, blocked)
  }

  const actionKey = connectionKey + ":" + args.action
  const now = Date.now()
  let state = actionProbeStates.get(actionKey)
  if (!state || now - state.createdAt >= ACTION_PROBE_CACHE_MS) {
    state = { active: 0, createdAt: now, probePromise: null, waiters: [] }
    actionProbeStates.set(actionKey, state)
    const probePromise = call()
    state.probePromise = probePromise
    try {
      const output = await probePromise
      markConnectionBlock(connectionKey, output)
      return output
    } finally {
      state.probePromise = null
    }
  }

  if (state.probePromise) {
    const probeOutput = await state.probePromise
    const probeAuthorization = authorizationResult(probeOutput)
    if (probeAuthorization) {
      return skippedForConnectionBlock(args, { authorization: probeAuthorization })
    }
  }
  return await runLimitedAction(state, connectionKey, args, call)
}

export default tool({
  description:
    "Execute one selected OOMOL Link action using the inspected contract. params is the action input JSON described by inspect_action. For an explicitly selected account, connectionName is the exact active-workspace value returned by list_apps; omit it to use the default connection. The runtime validates account identity, probes repeated same-target calls, and limits their concurrency. Structured outcomes are authoritative: authorization_required means the target is blocked pending access; skipped with reason connection_blocked belongs to that same incident; other errors describe action or runtime failures. Wanta groups matching authorization outcomes into one inline connection prompt.",
  args: {
    service: tool.schema.string().describe("Service slug, e.g. 'hackernews'"),
    action: tool.schema.string().describe("Action name, e.g. 'get_top_stories'"),
    params: tool.schema.string().optional().describe("JSON string of the action input parameters built from inspect_action's inputSchema; omit or '{}' if the schema declares no required fields"),
    connectionName: tool.schema.string().optional().describe("Exact connector app connectionName returned by list_apps for an explicitly selected active-workspace account; omit for the default connection."),
  },
  async execute(args, context) {
    let data = "{}"
    if (args.params && args.params.trim()) {
      try {
        data = JSON.stringify(JSON.parse(args.params))
      } catch (parseError) {
        return JSON.stringify({ status: "error", message: "params is not valid JSON: " + args.params })
      }
    }
    const identity = await currentIdentity(context.sessionID)
    const connectionName = String(args.connectionName || "").trim()
    if (connectionName) {
      const inventory = await knownConnectionNames(args.service, identity)
      if (!inventory.names) {
        return JSON.stringify({
          status: "error",
          service: args.service,
          action: args.action,
          errorCode: "connection_inventory_unavailable",
          message: "The selected connectionName could not be verified because the active workspace connection inventory is unavailable. Do not guess a replacement connection name or silently switch accounts.",
        })
      }
      if (!inventory.names.has(connectionName)) {
        return JSON.stringify({
          status: "error",
          service: args.service,
          action: args.action,
          errorCode: "invalid_connection_name",
          message: "connectionName must exactly match a value returned by list_apps for the active workspace. Do not guess provider display names or silently switch accounts.",
        })
      }
    }
    const argv = ["connector", "run", args.service, "--action", args.action, "--data", data]
    if (connectionName) {
      argv.push("--connection-name", connectionName)
    }
    await appendIdentityArgs(argv, identity, context.sessionID)
    argv.push("--json")
    return await runCoordinatedAction(context.sessionID, identity, connectionName, args, async () => {
      try {
        const result = await execFileAsync(OO_BIN, argv, OO_EXEC_OPTIONS)
        return (result.stdout || "").trim() || "{}"
      } catch (error) {
        const e = error || {}
        const stderr = String(e.stderr || e.message || "")
        const match = stderr.match(/errorCode:\s*([^\s)）]+)/)
        const code = match ? match[1] : null
        if (code && AUTH_BLOCKING.has(code)) {
          const authUrl = authorizationUrl(args.service)
          if (!authUrl) {
            return JSON.stringify({
              status: "error",
              service: args.service,
              action: args.action,
              errorCode: "config_missing",
              message: "WANTA_CONSOLE_URL is required to build the connector authorization URL.",
            })
          }
          return JSON.stringify({
            status: "authorization_required",
            service: args.service,
            action: args.action,
            displayName: args.service,
            authUrl: authUrl,
            errorCode: code,
            message: stderr.trim(),
          })
        }
        return JSON.stringify({ status: "error", errorCode: code, message: stderr.trim() })
      }
    })
  },
})
`

/** workspace 写入用：文件名 → 源码。 */
export const AGENT_TOOL_FILES: Readonly<Record<string, string>> = {
  "search_actions.ts": SEARCH_ACTIONS_TOOL_TS,
  "list_apps.ts": LIST_APPS_TOOL_TS,
  "inspect_action.ts": INSPECT_ACTION_TOOL_TS,
  "call_action.ts": CALL_ACTION_TOOL_TS,
}
