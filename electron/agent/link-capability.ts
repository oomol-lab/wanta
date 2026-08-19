import type { LinkRuntime } from "../runtime/agent-runtime.ts"

import { execFile } from "node:child_process"
import { promisify } from "node:util"
import { connectorBaseUrl, consoleBaseUrl } from "../domain.ts"
import { redactConnectorOutput } from "./oo-guard-core.ts"
import { AUTH_BLOCKING_ERROR_CODES, buildAgentLinkEnv, parseConnectorErrorCode } from "./oo.ts"

const execFileAsync = promisify(execFile)
const actionIdPattern = /^[a-z0-9][a-z0-9_-]*\.[A-Za-z0-9][A-Za-z0-9_-]*$/u
const actionNamePattern = /^[A-Za-z0-9][A-Za-z0-9_-]*$/u
const servicePattern = /^[a-z0-9][a-z0-9_-]*$/u
const ACTION_PROBE_CACHE_MS = 5_000
const AUTHORIZATION_CACHE_MS = 5_000
const CONNECTION_BLOCK_MS = 10_000
const MAX_PARALLEL_ACTION_CALLS = 2
const PROVIDER_AUTH_TYPES_CACHE_MS = 30_000

export interface LinkCapabilityContext {
  runtime?: LinkCapabilityRuntime | null
  sessionId: string
  teamName?: string
}

export interface LinkCapabilityRuntime {
  accountName?: string
  linkRuntime: LinkRuntime
}

export interface LinkCapabilityOptions {
  execute?: LinkCommandExecutor
  ooBinPath: string
  runtime: () => LinkCapabilityRuntime | null
  storeDir: string
}

export type LinkCommandExecutor = (
  command: string,
  args: string[],
  options: { env: NodeJS.ProcessEnv; maxBuffer: number; timeout: number },
) => Promise<{ stderr: string; stdout: string }>

interface CommandFailure extends Error {
  stderr?: string
  stdout?: string
}

interface ActionProbeState {
  active: number
  createdAt: number
  probePromise: Promise<string> | null
  waiters: Array<() => void>
}

interface AuthorizationResult {
  errorCode?: string
  status: "authorization_required"
}

export class LinkCapability {
  private readonly actionProbeStates = new Map<string, ActionProbeState>()
  private readonly authorizationCache = new Map<string, { createdAt: number; services: Set<string> | null }>()
  private readonly connectionBlocks = new Map<string, { authorization: AuthorizationResult; expiresAt: number }>()
  private readonly options: LinkCapabilityOptions
  private readonly providerAuthTypesCache = new Map<
    string,
    { authTypesByService: Map<string, string[]> | null; createdAt: number }
  >()

  public constructor(options: LinkCapabilityOptions) {
    this.options = options
  }

  public async listApps(context: LinkCapabilityContext, service?: string): Promise<string> {
    const normalizedService = service?.trim()
    if (normalizedService && !servicePattern.test(normalizedService)) {
      return errorResult("invalid_service", "service must be a provider slug.")
    }
    const runtime = this.requireRuntime(context)
    const args = [
      "connector",
      "apps",
      ...(normalizedService ? [normalizedService] : []),
      ...workspaceArgs(runtime),
      "--json",
    ]
    return this.run(args, runtime, "connection_inventory_unavailable")
  }

  public async searchActions(context: LinkCapabilityContext, query: string): Promise<string> {
    const normalizedQuery = query.trim()
    if (!normalizedQuery) return errorResult("invalid_query", "query is required.")
    const runtime = this.requireRuntime(context)
    const output = await this.run(["connector", "search", normalizedQuery, "--json"], runtime, "action_search_failed")
    return this.enrichSearchOutput(context, runtime, output)
  }

  public async inspectActions(context: LinkCapabilityContext, actions: readonly string[]): Promise<string> {
    const normalizedActions = actions.map((action) => action.trim()).filter(Boolean)
    if (normalizedActions.length === 0 || normalizedActions.some((action) => !actionIdPattern.test(action))) {
      return errorResult("invalid_action_id", "actions must contain one or more <service>.<action> ids.")
    }
    const runtime = this.requireRuntime(context)
    // Schema metadata is identity-independent. Never add --team/--personal.
    return this.run(["connector", "schema", ...normalizedActions, "--json"], runtime, "schema_lookup_failed")
  }

  public async callAction(
    context: LinkCapabilityContext,
    input: { action: string; connectionName?: string; params?: Record<string, unknown>; service: string },
  ): Promise<string> {
    const service = input.service.trim()
    const action = input.action.trim()
    if (!servicePattern.test(service) || !actionNamePattern.test(action)) {
      return errorResult("invalid_action", "service and action must use connector slug identifiers.")
    }
    const runtime = this.requireRuntime(context)
    const connectionName = input.connectionName?.trim()
    if (connectionName) {
      const inventory = await this.listApps(context, service)
      const names = connectionNames(inventory)
      if (!names) {
        return errorResult(
          "connection_inventory_unavailable",
          "The selected connectionName could not be verified in the active workspace.",
          { action, service },
        )
      }
      if (!names.has(connectionName)) {
        return errorResult("invalid_connection_name", "connectionName must exactly match list_apps.", {
          action,
          service,
        })
      }
    }
    const args = [
      "connector",
      "run",
      service,
      "--action",
      action,
      "--data",
      JSON.stringify(input.params ?? {}),
      ...(connectionName ? ["--connection-name", connectionName] : []),
      ...workspaceArgs(runtime),
      "--json",
    ]
    return this.runCoordinatedAction(context, runtime, service, action, connectionName, async () => {
      try {
        return await this.runCommand(args, runtime)
      } catch (error) {
        const message = commandErrorMessage(error)
        const errorCode = parseConnectorErrorCode(message)
        if (errorCode && AUTH_BLOCKING_ERROR_CODES.has(errorCode)) {
          const authUrl = authorizationUrl(runtime.linkRuntime, service)
          return JSON.stringify({
            status: "authorization_required",
            service,
            action,
            errorCode,
            ...(authUrl ? { authUrl } : {}),
            message: this.redact(message, runtime),
            workspace: workspaceMetadata(runtime),
          })
        }
        return errorResult(errorCode ?? "action_failed", this.redact(message, runtime), {
          action,
          service,
          ...(errorCode === "POLICY_DENIED"
            ? {
                authorizationState: "action_denied",
                policyOrigin: "connector_or_provider",
                workspaceVerified: Boolean(connectionName),
                connectionSelection: connectionName
                  ? { mode: "explicit", name: connectionName, verified: true }
                  : { mode: "workspace_default", verified: false },
                guidance:
                  "The active Wanta workspace was applied successfully. A connected app does not guarantee permission for this action; verify the provider credential scopes and target resource membership. The available error does not identify whether the connector policy or upstream provider denied the request.",
              }
            : {}),
          ...(connectionName ? { connectionName } : {}),
          workspace: workspaceMetadata(runtime),
        })
      }
    })
  }

  private async enrichSearchOutput(
    context: LinkCapabilityContext,
    runtime: LinkCapabilityRuntime,
    output: string,
  ): Promise<string> {
    try {
      const parsed = JSON.parse(output) as unknown
      if (!Array.isArray(parsed)) return output
      const [authorized, authTypes] = await Promise.all([
        this.authorizedServices(context, runtime),
        this.providerAuthTypes(context, runtime),
      ])
      return JSON.stringify(
        parsed.map((item) => {
          if (!isRecord(item)) return item
          const service = typeof item["service"] === "string" ? item["service"] : ""
          if (!authorized) return { ...item, authenticatedReliable: false }
          const providerAuthTypes = authTypes?.get(service)
          const noAuthReady = providerAuthTypes?.length === 1 && providerAuthTypes[0] === "no_auth"
          const authenticated = noAuthReady || authorized.has(service)
          return {
            ...item,
            authenticated,
            authenticatedReliable: true,
            noAuthReady,
            ...(!authenticated ? { authUrl: authorizationUrl(runtime.linkRuntime, service) } : {}),
          }
        }),
      )
    } catch {
      return output
    }
  }

  private async authorizedServices(
    context: LinkCapabilityContext,
    runtime: LinkCapabilityRuntime,
  ): Promise<Set<string> | null> {
    const key = this.workspaceKey(context, runtime)
    const now = Date.now()
    const cached = this.authorizationCache.get(key)
    if (cached && now - cached.createdAt < AUTHORIZATION_CACHE_MS) return cached.services
    try {
      const output = await this.runCommand(["connector", "apps", ...workspaceArgs(runtime), "--json"], runtime)
      const apps = parseArrayPayload(output, ["data", "apps", "items"])
      const services = new Set(
        apps.flatMap((app) => {
          if (!isRecord(app) || app["status"] === "disconnected") return []
          const service = typeof app["service"] === "string" ? app["service"] : app["serviceName"]
          return typeof service === "string" && service ? [service] : []
        }),
      )
      this.authorizationCache.set(key, { createdAt: now, services })
      return services
    } catch {
      this.authorizationCache.set(key, { createdAt: now, services: null })
      return null
    }
  }

  private async providerAuthTypes(
    context: LinkCapabilityContext,
    runtime: LinkCapabilityRuntime,
  ): Promise<Map<string, string[]> | null> {
    const key = this.workspaceKey(context, runtime)
    const now = Date.now()
    const cached = this.providerAuthTypesCache.get(key)
    if (cached && now - cached.createdAt < PROVIDER_AUTH_TYPES_CACHE_MS) return cached.authTypesByService
    const url =
      runtime.linkRuntime.kind === "openconnector"
        ? `${runtime.linkRuntime.baseUrl.replace(/\/+$/u, "")}/v1/providers`
        : `${connectorBaseUrl.replace(/\/+$/u, "")}/v1/providers`
    const headers: Record<string, string> = {}
    const token =
      runtime.linkRuntime.kind === "openconnector" ? runtime.linkRuntime.runtimeToken : runtime.linkRuntime.sessionToken
    if (token) headers.authorization = `Bearer ${token}`
    if (runtime.linkRuntime.kind === "oomol" && runtime.linkRuntime.teamName) {
      headers["x-oo-team-name"] = runtime.linkRuntime.teamName
    }
    try {
      const response = await fetchSameOriginJson(url, headers)
      if (!response) throw new Error("Provider catalog is unavailable.")
      const providers = Array.isArray(response)
        ? response
        : isRecord(response)
          ? (["data", "providers", "items"].map((field) => response[field]).find(Array.isArray) ?? [])
          : []
      const authTypesByService = new Map<string, string[]>()
      for (const provider of providers) {
        if (!isRecord(provider) || typeof provider["service"] !== "string") continue
        authTypesByService.set(
          provider["service"],
          Array.isArray(provider["authTypes"])
            ? provider["authTypes"].filter((value): value is string => typeof value === "string")
            : [],
        )
      }
      this.providerAuthTypesCache.set(key, { authTypesByService, createdAt: now })
      return authTypesByService
    } catch {
      this.providerAuthTypesCache.set(key, { authTypesByService: null, createdAt: now })
      return null
    }
  }

  private async runCoordinatedAction(
    context: LinkCapabilityContext,
    runtime: LinkCapabilityRuntime,
    service: string,
    action: string,
    connectionName: string | undefined,
    call: () => Promise<string>,
  ): Promise<string> {
    this.pruneRuntimeState()
    const connectionKey = `${context.sessionId}:${this.workspaceKey(context, runtime)}:${service}:${connectionName ?? "default"}`
    const blocked = this.currentConnectionBlock(connectionKey)
    if (blocked) return skippedForConnectionBlock(service, action, blocked.authorization)
    const actionKey = `${connectionKey}:${action}`
    const now = Date.now()
    let state = this.actionProbeStates.get(actionKey)
    if (!state || now - state.createdAt >= ACTION_PROBE_CACHE_MS) {
      state = { active: 0, createdAt: now, probePromise: null, waiters: [] }
      this.actionProbeStates.set(actionKey, state)
      const probePromise = call()
      state.probePromise = probePromise
      try {
        const output = await probePromise
        this.markConnectionBlock(connectionKey, output)
        return output
      } finally {
        state.probePromise = null
      }
    }
    if (state.probePromise) {
      const output = await state.probePromise
      const authorization = parseAuthorizationResult(output)
      if (authorization) return skippedForConnectionBlock(service, action, authorization)
    }
    await acquireActionSlot(state)
    try {
      const currentBlock = this.currentConnectionBlock(connectionKey)
      if (currentBlock) return skippedForConnectionBlock(service, action, currentBlock.authorization)
      const output = await call()
      this.markConnectionBlock(connectionKey, output)
      return output
    } finally {
      releaseActionSlot(state)
    }
  }

  private currentConnectionBlock(key: string): { authorization: AuthorizationResult; expiresAt: number } | null {
    const block = this.connectionBlocks.get(key)
    if (!block) return null
    if (Date.now() >= block.expiresAt) {
      this.connectionBlocks.delete(key)
      return null
    }
    return block
  }

  private markConnectionBlock(key: string, output: string): void {
    const authorization = parseAuthorizationResult(output)
    if (authorization) this.connectionBlocks.set(key, { authorization, expiresAt: Date.now() + CONNECTION_BLOCK_MS })
  }

  private pruneRuntimeState(now = Date.now()): void {
    for (const [key, state] of this.actionProbeStates) {
      if (!state.probePromise && state.active === 0 && now - state.createdAt >= ACTION_PROBE_CACHE_MS) {
        this.actionProbeStates.delete(key)
      }
    }
    for (const [key, block] of this.connectionBlocks) {
      if (now >= block.expiresAt) this.connectionBlocks.delete(key)
    }
  }

  private workspaceKey(context: LinkCapabilityContext, runtime: LinkCapabilityRuntime): string {
    return runtime.linkRuntime.kind === "oomol"
      ? `oomol:${runtime.accountName ?? ""}:${runtime.linkRuntime.teamName ?? context.teamName ?? ""}`
      : `openconnector:${runtime.accountName ?? ""}:${runtime.linkRuntime.baseUrl}`
  }

  private requireRuntime(context: LinkCapabilityContext): LinkCapabilityRuntime {
    const current = Object.hasOwn(context, "runtime") ? context.runtime : this.options.runtime()
    if (!current) throw new Error("Wanta Link runtime is unavailable.")
    if (current.linkRuntime.kind === "oomol") {
      const teamName = context.teamName?.trim()
      if (!teamName) throw new Error("Wanta OOMOL team workspace identity is unavailable.")
      return { ...current, linkRuntime: { ...current.linkRuntime, teamName } }
    }
    return current
  }

  private async run(args: string[], runtime: LinkCapabilityRuntime, fallbackCode: string): Promise<string> {
    try {
      return await this.runCommand(args, runtime)
    } catch (error) {
      const message = this.redact(commandErrorMessage(error), runtime)
      return errorResult(parseConnectorErrorCode(message) ?? fallbackCode, message, {
        workspace: workspaceMetadata(runtime),
      })
    }
  }

  private async runCommand(args: string[], runtime: LinkCapabilityRuntime): Promise<string> {
    const env = buildAgentLinkEnv({
      accountName: runtime.accountName,
      linkRuntime: runtime.linkRuntime,
      teamName: runtime.linkRuntime.kind === "oomol" ? runtime.linkRuntime.teamName : undefined,
      storeDir: this.options.storeDir,
      ooBinPath: this.options.ooBinPath,
    })
    const execute = this.options.execute ?? (execFileAsync as LinkCommandExecutor)
    const result = await execute(this.options.ooBinPath, args, {
      env: { ...process.env, ...env },
      maxBuffer: 16 * 1024 * 1024,
      timeout: 30_000,
    })
    return this.redact((result.stdout || "").trim() || "{}", runtime)
  }

  private redact(value: string, runtime: LinkCapabilityRuntime): string {
    let redacted = redactConnectorOutput(value)
    const secret =
      runtime.linkRuntime.kind === "oomol" ? runtime.linkRuntime.sessionToken : runtime.linkRuntime.runtimeToken
    if (secret) redacted = redacted.split(secret).join("[REDACTED]")
    return redacted
  }
}

async function fetchSameOriginJson(url: string, headers: Record<string, string>): Promise<unknown | null> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 10_000)
  try {
    let current = new URL(url)
    for (let redirects = 0; redirects <= 3; redirects += 1) {
      const response = await fetch(current, { headers, redirect: "manual", signal: controller.signal })
      if (![301, 302, 303, 307, 308].includes(response.status)) return response.ok ? response.json() : null
      const location = response.headers.get("location")
      if (!location || redirects === 3) return null
      const next = new URL(location, current)
      if (next.origin !== current.origin) return null
      current = next
    }
    return null
  } finally {
    clearTimeout(timer)
  }
}

function parseAuthorizationResult(output: string): AuthorizationResult | null {
  try {
    const value = JSON.parse(output) as unknown
    return isRecord(value) && value["status"] === "authorization_required"
      ? (value as unknown as AuthorizationResult)
      : null
  } catch {
    return null
  }
}

function skippedForConnectionBlock(service: string, action: string, authorization: AuthorizationResult): string {
  return JSON.stringify({
    status: "skipped",
    reason: "connection_blocked",
    service,
    action,
    ...(authorization.errorCode ? { errorCode: authorization.errorCode } : {}),
    message:
      "A matching Link call already reported an authorization block; this call was skipped to avoid duplicate connector requests.",
  })
}

async function acquireActionSlot(state: ActionProbeState): Promise<void> {
  if (state.active >= MAX_PARALLEL_ACTION_CALLS) await new Promise<void>((resolve) => state.waiters.push(resolve))
  state.active += 1
}

function releaseActionSlot(state: ActionProbeState): void {
  const next = state.waiters.shift()
  if (next) next()
  else state.active -= 1
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value)
}

function parseArrayPayload(output: string, fields: readonly string[]): unknown[] {
  const parsed = JSON.parse(output) as unknown
  if (Array.isArray(parsed)) return parsed
  if (!isRecord(parsed)) return []
  for (const field of fields) if (Array.isArray(parsed[field])) return parsed[field]
  return []
}

function workspaceArgs(runtime: LinkCapabilityRuntime): string[] {
  return runtime.linkRuntime.kind === "oomol" ? ["--team", runtime.linkRuntime.teamName ?? ""] : []
}

function workspaceMetadata(runtime: LinkCapabilityRuntime): Record<string, string> {
  return runtime.linkRuntime.kind === "oomol"
    ? { runtime: "oomol", teamName: runtime.linkRuntime.teamName ?? "" }
    : { runtime: "openconnector" }
}

function authorizationUrl(runtime: LinkRuntime, service: string): string | undefined {
  if (runtime.kind === "openconnector") {
    return `${runtime.consoleUrl.replace(/\/+$/u, "")}/providers/${encodeURIComponent(service)}`
  }
  return `${consoleBaseUrl.replace(/\/+$/u, "")}/app-connections?provider=${encodeURIComponent(service)}`
}

function connectionNames(output: string): Set<string> | null {
  try {
    const parsed = JSON.parse(output) as unknown
    const body =
      parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : {}
    const apps = Array.isArray(parsed)
      ? parsed
      : Array.isArray(body["data"])
        ? body["data"]
        : Array.isArray(body["apps"])
          ? body["apps"]
          : Array.isArray(body["items"])
            ? body["items"]
            : null
    if (!apps) return null
    return new Set(
      apps.flatMap((app) => {
        if (!app || typeof app !== "object") return []
        const value = app as Record<string, unknown>
        if (value["status"] === "disconnected") return []
        const name = typeof value["connectionName"] === "string" ? value["connectionName"] : value["alias"]
        return typeof name === "string" && name.trim() ? [name.trim()] : []
      }),
    )
  } catch {
    return null
  }
}

function commandErrorMessage(error: unknown): string {
  const failure = error as CommandFailure
  return String(failure?.stderr || failure?.stdout || failure?.message || error || "Link command failed.").trim()
}

function errorResult(errorCode: string, message: string, extra: Record<string, unknown> = {}): string {
  return JSON.stringify({ status: "error", errorCode, message, ...extra })
}
