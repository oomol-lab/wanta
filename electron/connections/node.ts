import type {
  ConnectionAccount,
  ConnectionAction,
  ConnectionActionResult,
  ConnectionConnectInput,
  ConnectionExecution,
  ConnectionExecutionLogRequest,
  ConnectionExecutionLogSummary,
  ConnectionProviderDetail,
  ConnectionsService,
  ConnectionSummary,
  ConnectionSummaryRequest,
  ConnectionWorkspace,
} from "./common.ts"
import type { RawApp, RawAppListMeta, RawProvider } from "./summary.ts"
import type { IConnectionService } from "@oomol/connection"

import { ConnectionService } from "@oomol/connection"
import { shell } from "electron"
import { connectorBaseUrl, consoleBaseUrl } from "../domain.ts"
import { ConnectionsService as ConnectionsServiceName } from "./common.ts"
import { createConnectorOAuthReturnUri, parseConnectorAuthorizationUrl } from "./domain.ts"
import { normalizeConnectionExecutionLogs } from "./executions.ts"
import { createFederatedConnectBody } from "./federated.ts"
import {
  connectionUsageSummaryDays,
  createEmptyConnectionSummary,
  createEmptyConnectionUsageSummary,
  createSupersededConnectionSummaryFallback,
  createUnavailableConnectionSummaryFallback,
} from "./summary-model.ts"
import {
  mergeConnectionSummary,
  normalizeApiKeyConfig,
  normalizeCustomCredentialConfig,
  normalizeProvider,
} from "./summary.ts"
import { normalizeUsageSummary } from "./usage.ts"

interface ConnectorEnvelope<T> {
  data?: T
  errorMessage?: string
  message?: string
  meta?: unknown
  success?: boolean
}

interface ConnectorRequestContext {
  accountKey: string
  connectorOrigin: string
  headers: Record<string, string>
  workspace: ConnectionWorkspace
  workspaceKey: string
}

interface ConnectorCacheEntry<T> {
  data: T
  etag?: string
  fetchedAt: number
  lastModified?: string
  meta: unknown
}

interface ConnectionSummaryCacheEntry {
  accountKey: string
  fetchedAt: number
  summary: ConnectionSummary
}

interface ConnectionSummaryInFlight {
  accountKey: string
  promise: Promise<ConnectionSummary>
}

const executionLogDefaultLimit = 12
const executionLogMaxLimit = 50
const connectorGetCacheMs = 30_000
const connectionSummaryCacheMs = 10_000

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined
}

function normalizeConnectionWorkspace(workspace: ConnectionWorkspace): ConnectionWorkspace {
  if (workspace.type !== "organization") {
    return { type: "personal" }
  }

  const organizationName = workspace.organizationName.trim()
  return organizationName ? { type: "organization", organizationName } : { type: "personal" }
}

function connectionWorkspaceKey(workspace: ConnectionWorkspace): string {
  return workspace.type === "organization" ? `organization:${workspace.organizationName}` : "personal"
}

function isAccountEntry<T extends { accountKey: string }>(entry: T | undefined, accountKey: string): entry is T {
  return Boolean(entry && entry.accountKey === accountKey)
}

function clampExecutionLogLimit(value: number | undefined): number {
  if (value === undefined || !Number.isInteger(value) || value <= 0) {
    return executionLogDefaultLimit
  }

  return Math.min(value, executionLogMaxLimit)
}

function unwrapConnectorEnvelope<T>(payload: unknown): { data: T; meta: unknown } {
  if (Array.isArray(payload)) {
    return { data: payload as T, meta: null }
  }
  if (!payload || typeof payload !== "object") {
    return { data: payload as T, meta: null }
  }

  const envelope = payload as ConnectorEnvelope<T>
  if (envelope.success === false) {
    throw new Error(envelope.errorMessage || envelope.message || "Connector request failed")
  }
  if ("data" in envelope) {
    return { data: envelope.data as T, meta: envelope.meta ?? null }
  }
  return { data: payload as T, meta: null }
}

function extractEnvelopeMessage(payload: unknown): string | undefined {
  if (payload && typeof payload === "object") {
    const envelope = payload as ConnectorEnvelope<unknown>
    return envelope.errorMessage || envelope.message
  }
  return undefined
}

function normalizeOptionalUsageSummary(
  results: readonly PromiseSettledResult<{ data: unknown; meta: unknown }>[],
): ConnectionSummary["usage"] {
  const [dailyResult, servicesResult] = results

  if (dailyResult?.status !== "fulfilled" || servicesResult?.status !== "fulfilled") {
    return createEmptyConnectionUsageSummary()
  }

  try {
    return normalizeUsageSummary(dailyResult.value.data, servicesResult.value.data)
  } catch {
    return createEmptyConnectionUsageSummary()
  }
}

export interface ConnectionsServiceOptions {
  authToken?: string
  onWorkspaceChanged?: (workspace: ConnectionWorkspace) => void
}

export class ConnectionsServiceImpl
  extends ConnectionService<ConnectionsService>
  implements IConnectionService<ConnectionsService>
{
  private authToken?: string
  private readonly connectorGetCache = new Map<string, ConnectorCacheEntry<unknown>>()
  private readonly connectorGetInFlight = new Map<string, Promise<{ data: unknown; meta: unknown }>>()
  private connectionSummaryCache: ConnectionSummaryCacheEntry | undefined
  private connectionSummaryGeneration = 0
  private connectionSummaryInFlight: ConnectionSummaryInFlight | undefined
  private lastReadySummary: ConnectionSummaryCacheEntry | undefined
  private readonly onWorkspaceChanged?: (workspace: ConnectionWorkspace) => void
  private workspace: ConnectionWorkspace = { type: "personal" }

  public constructor(options?: ConnectionsServiceOptions) {
    super(ConnectionsServiceName)
    this.authToken = options?.authToken
    this.onWorkspaceChanged = options?.onWorkspaceChanged
  }

  /** 登录 / 登出时由 main 更新凭证（现为会话 token；注入 connector 请求的 Bearer，网关层统一鉴权）。 */
  public setAuthToken(authToken: string | undefined): void {
    if (this.authToken === authToken) {
      return
    }

    this.authToken = authToken
    this.clearConnectionSummaryState()
    this.clearConnectorGetCache()
  }

  public isReady(): Promise<boolean> {
    return Promise.resolve(Boolean(this.authToken))
  }

  public getSummary(request?: ConnectionSummaryRequest): Promise<ConnectionSummary> {
    return this.getConnectionSummary(request)
  }

  public async getConnectionSummary(request: ConnectionSummaryRequest = {}): Promise<ConnectionSummary> {
    if (!this.authToken) {
      this.clearConnectionSummaryState()
      return createEmptyConnectionSummary("signed-out", "未登录", this.workspace)
    }

    const authToken = this.authToken
    const accountKey = this.connectionAccountKey(authToken)
    const now = Date.now()
    if (!request.forceRefresh) {
      const cachedSummary = this.getCachedConnectionSummary(accountKey, now)
      if (cachedSummary) {
        return cachedSummary
      }
    }

    const inFlight = this.connectionSummaryInFlight
    if (!request.forceRefresh && isAccountEntry(inFlight, accountKey)) {
      return inFlight.promise
    }

    const generation = this.connectionSummaryGeneration
    const refreshPromise = this.refreshConnectionSummary(authToken, accountKey, request, generation).finally(() => {
      if (this.connectionSummaryInFlight?.promise === refreshPromise) {
        this.connectionSummaryInFlight = undefined
      }
    })
    this.connectionSummaryInFlight = { accountKey, promise: refreshPromise }
    return refreshPromise
  }

  public connect(input: ConnectionConnectInput): Promise<ConnectionActionResult> {
    return this.connectProvider(input)
  }

  public async connectProvider(input: ConnectionConnectInput): Promise<ConnectionActionResult> {
    const service = encodeURIComponent(input.service)

    switch (input.authType) {
      case "oauth2": {
        const path = input.appId
          ? `/v1/apps/by-id/${encodeURIComponent(input.appId)}/connect`
          : `/v1/apps/${service}/connect`
        const result = await this.requestConnector<{ authorizationUrl?: unknown }>(path, {
          method: "POST",
          body: JSON.stringify({ returnUri: createConnectorOAuthReturnUri(consoleBaseUrl) }),
        })
        const authorizationUrl = asString(result.data.authorizationUrl)
        if (!authorizationUrl) {
          throw new Error("Connector connect request did not return an authorization URL")
        }

        await shell.openExternal(parseConnectorAuthorizationUrl(authorizationUrl).toString())
        this.clearConnectorGetCache()
        const summary = await this.getConnectionSummary({ forceRefresh: true })
        await this.emitSummaryChanged(summary)
        return { status: "opened", summary }
      }
      case "api_key": {
        const path = input.appId
          ? `/v1/apps/by-id/${encodeURIComponent(input.appId)}/connect/api-key`
          : `/v1/apps/${service}/connect/api-key`
        await this.requestConnector(path, {
          method: "POST",
          body: JSON.stringify({ apiKey: input.apiKey, label: input.label, extra: input.extra }),
        })
        break
      }
      case "custom_credential": {
        const path = input.appId
          ? `/v1/apps/by-id/${encodeURIComponent(input.appId)}/connect/custom-credential`
          : `/v1/apps/${service}/connect/custom-credential`
        await this.requestConnector(path, {
          method: "POST",
          body: JSON.stringify({ values: input.values, label: input.label }),
        })
        break
      }
      case "federated": {
        const path = input.appId
          ? `/v1/apps/by-id/${encodeURIComponent(input.appId)}/connect/federated`
          : `/v1/apps/${service}/connect/federated`
        await this.requestConnector(path, {
          method: "POST",
          body: JSON.stringify(createFederatedConnectBody(input)),
        })
        break
      }
      case "no_auth": {
        await this.requestConnector(`/v1/apps/${service}/connect/no-auth`, { method: "POST" })
        break
      }
    }

    this.clearConnectorGetCache()
    const summary = await this.getConnectionSummary({ forceRefresh: true })
    await this.emitSummaryChanged(summary)
    return { status: "connected", summary }
  }

  public disconnect(service: string): Promise<ConnectionActionResult> {
    return this.disconnectProvider(service)
  }

  public async disconnectProvider(service: string): Promise<ConnectionActionResult> {
    await this.requestConnector(`/v1/apps/${encodeURIComponent(service)}`, { method: "DELETE" })
    this.clearConnectorGetCache()
    const summary = await this.getConnectionSummary({ forceRefresh: true })
    await this.emitSummaryChanged(summary)
    return { status: "disconnected", summary }
  }

  public async disconnectAccount(appId: string): Promise<ConnectionActionResult> {
    await this.requestConnector(`/v1/apps/by-id/${encodeURIComponent(appId)}`, { method: "DELETE" })
    this.clearConnectorGetCache()
    const summary = await this.getConnectionSummary({ forceRefresh: true })
    await this.emitSummaryChanged(summary)
    return { status: "disconnected", summary }
  }

  public async setWorkspace(workspace: ConnectionWorkspace): Promise<ConnectionSummary> {
    const nextWorkspace = normalizeConnectionWorkspace(workspace)
    if (connectionWorkspaceKey(nextWorkspace) === connectionWorkspaceKey(this.workspace)) {
      return this.getConnectionSummary()
    }

    this.workspace = nextWorkspace
    this.clearConnectionSummaryState()
    this.clearConnectorGetCache()
    this.onWorkspaceChanged?.(nextWorkspace)
    const summary = await this.getConnectionSummary({ forceRefresh: true })
    await this.emitSummaryChanged(summary)
    return summary
  }

  public getProviderDetail(service: string): Promise<ConnectionProviderDetail> {
    return this.getConnectionProviderDetail(service)
  }

  public async getConnectionProviderDetail(service: string): Promise<ConnectionProviderDetail> {
    const [summary, providerResult] = await Promise.all([
      this.getConnectionSummary(),
      this.getConnector<RawProvider>(`/v1/providers/${encodeURIComponent(service)}`),
    ])
    const appsByService = new Map<string, ConnectionSummary["apps"]>()
    for (const app of summary.apps) {
      const current = appsByService.get(app.service) ?? []
      current.push(app)
      appsByService.set(app.service, current)
    }
    const provider = normalizeProvider(providerResult.data, appsByService)
    if (!provider) {
      throw new Error(`Provider ${service} is not available`)
    }

    return {
      ...provider,
      apiKeyConfig: normalizeApiKeyConfig(providerResult.data.apiKeyConfig),
      customCredentialConfig: normalizeCustomCredentialConfig(providerResult.data.customCredentialConfig),
      federatedCredentialConfig: null,
      homepageUrl: asString(providerResult.data.homepageUrl),
    }
  }

  public async getConnectionExecutionLogs(
    request: ConnectionExecutionLogRequest,
  ): Promise<ConnectionExecutionLogSummary> {
    const service = request.service.trim()
    if (!service) {
      return { items: [] }
    }

    const searchParams = new URLSearchParams({ limit: String(clampExecutionLogLimit(request.limit)) })
    if (request.cursor) {
      searchParams.set("cursor", request.cursor)
    }
    if (request.status) {
      searchParams.set("status", request.status)
    }

    const result = await this.getConnector<unknown>(
      `/v1/apps/${encodeURIComponent(service)}/executions?${searchParams.toString()}`,
      { forceRefresh: true },
    )
    return normalizeConnectionExecutionLogs(result.data)
  }

  public async listExecutions(service: string): Promise<ConnectionExecution[]> {
    const result = await this.getConnectionExecutionLogs({ service, limit: 20 })
    return result.items
  }

  public async listActions(service: string): Promise<ConnectionAction[]> {
    const result = await this.getConnector<RawAction[]>(`/v1/actions?service=${encodeURIComponent(service)}`)
    return result.data
      .filter((action) => typeof action.name === "string")
      .map((action) => ({
        id: action.id ?? `${action.service}.${action.name}`,
        service: action.service,
        name: action.name as string,
        description: action.description,
        requiredScopes: action.requiredScopes ?? [],
      }))
  }

  public async listAccounts(service: string): Promise<ConnectionAccount[]> {
    const result = await this.getConnector<RawAccount[]>(`/v1/apps/services/${encodeURIComponent(service)}`)
    return result.data.map((account) => ({
      id: account.id,
      service: account.service,
      accountLabel: account.accountLabel ?? account.displayName ?? account.providerAccountId ?? account.id,
      alias: account.alias ?? undefined,
      status: account.status ?? "unknown",
      isDefault: Boolean(account.isDefault),
      authType: account.authType ?? undefined,
      scopes: account.scopes ?? [],
      providerAccountId: account.providerAccountId ?? "",
      createdAt: account.createdAt,
      updatedAt: account.updatedAt,
    }))
  }

  public async updateAlias(appId: string, alias: string): Promise<void> {
    await this.requestConnector(`/v1/apps/by-id/${encodeURIComponent(appId)}`, {
      method: "PATCH",
      body: JSON.stringify({ alias: alias.trim() === "" ? null : alias.trim() }),
    })
    this.clearConnectorGetCache()
    await this.refreshAndEmit()
  }

  public async setDefaultAccount(service: string, appId: string): Promise<void> {
    await this.requestConnector(`/v1/apps/services/${encodeURIComponent(service)}/default`, {
      method: "PUT",
      body: JSON.stringify({ appId }),
    })
    this.clearConnectorGetCache()
    await this.refreshAndEmit()
  }

  public async openExternal(url: string): Promise<void> {
    await shell.openExternal(parseConnectorAuthorizationUrl(url).toString())
  }

  /** 重新拉取摘要并广播（凭证变化后由 main 调用，面板即时刷新）。 */
  public async refreshAndEmit(): Promise<ConnectionSummary> {
    const summary = await this.getConnectionSummary({ forceRefresh: true })
    await this.emitSummaryChanged(summary)
    return summary
  }

  private async refreshConnectionSummary(
    authToken: string,
    accountKey: string,
    request: ConnectionSummaryRequest,
    generation: number,
  ): Promise<ConnectionSummary> {
    try {
      const context = this.createConnectorRequestContext(authToken)
      const usageResultsRequest = Promise.allSettled([
        this.getConnectorWithContext<unknown>(context, `/v1/usage/daily?days=${connectionUsageSummaryDays}`, request),
        this.getConnectorWithContext<unknown>(
          context,
          `/v1/usage/services?days=${connectionUsageSummaryDays}`,
          request,
        ),
      ])
      const [appsResult, providersResult, usageResults] = await Promise.all([
        this.getConnectorWithContext<RawApp[]>(context, "/v1/apps", request),
        this.getConnectorWithContext<RawProvider[]>(context, "/v1/providers", request),
        usageResultsRequest,
      ])
      const summary = mergeConnectionSummary({
        apps: appsResult.data,
        meta: appsResult.meta as RawAppListMeta | null,
        providers: providersResult.data,
        usage: normalizeOptionalUsageSummary(usageResults),
        workspace: context.workspace,
      })

      if (!this.isCurrentConnectionSummaryRefresh(accountKey, generation)) {
        return this.createSupersededConnectionSummary(accountKey)
      }

      this.setConnectionSummaryCache(accountKey, summary)
      return summary
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      if (!this.isCurrentConnectionSummaryRefresh(accountKey, generation)) {
        return this.createSupersededConnectionSummary(accountKey, message)
      }

      const previousSummary = this.getLastReadySummary(accountKey)
      if (previousSummary) {
        const fallback = createUnavailableConnectionSummaryFallback(previousSummary, message)
        this.setConnectionSummaryCache(accountKey, fallback)
        return fallback
      }

      const summary = createEmptyConnectionSummary("unavailable", message, this.workspace)
      this.setConnectionSummaryCache(accountKey, summary)
      return summary
    }
  }

  private createConnectorRequestContext(authToken: string): ConnectorRequestContext {
    const workspaceKey = connectionWorkspaceKey(this.workspace)
    return {
      accountKey: authToken,
      connectorOrigin: connectorBaseUrl,
      headers: {
        Authorization: `Bearer ${authToken}`,
        "content-type": "application/json",
        ...(this.workspace.type === "organization"
          ? { "x-oo-organization-name": this.workspace.organizationName }
          : {}),
      },
      workspace: this.workspace,
      workspaceKey,
    }
  }

  private async requestConnector<T>(
    path: string,
    init: RequestInit & { headers?: Record<string, string> } = {},
  ): Promise<{ data: T; meta: unknown }> {
    const context = this.getConnectorRequestContext()
    const response = await fetch(`${context.connectorOrigin}${path}`, {
      ...init,
      headers: { ...context.headers, ...init.headers },
      signal: init.signal ?? AbortSignal.timeout(20_000),
    })
    const payload = await readConnectorPayload(response)
    if (!response.ok) {
      throw new Error(`Connector ${path} failed: ${extractEnvelopeMessage(payload) ?? `HTTP ${response.status}`}`)
    }
    return unwrapConnectorEnvelope<T>(payload)
  }

  private getConnectorRequestContext(): ConnectorRequestContext {
    if (!this.authToken) {
      throw new Error("Connections not available (sign in first)")
    }
    return this.createConnectorRequestContext(this.authToken)
  }

  private getConnector<T>(path: string, options: { forceRefresh?: boolean } = {}): Promise<{ data: T; meta: unknown }> {
    return this.getConnectorWithContext(this.getConnectorRequestContext(), path, options)
  }

  private async getConnectorWithContext<T>(
    context: ConnectorRequestContext,
    path: string,
    options: { forceRefresh?: boolean } = {},
  ): Promise<{ data: T; meta: unknown }> {
    const cacheKey = `${context.connectorOrigin}:${context.accountKey}:${context.workspaceKey}:${path}`
    const cached = this.connectorGetCache.get(cacheKey) as ConnectorCacheEntry<T> | undefined
    const now = Date.now()

    if (!options.forceRefresh && cached && now - cached.fetchedAt < connectorGetCacheMs) {
      return { data: cached.data, meta: cached.meta }
    }

    const inFlight = this.connectorGetInFlight.get(cacheKey)
    if (!options.forceRefresh && inFlight) {
      return inFlight as Promise<{ data: T; meta: unknown }>
    }

    const request = this.fetchConnectorGet<T>(context, path, cacheKey, cached).finally(() => {
      this.connectorGetInFlight.delete(cacheKey)
    })
    this.connectorGetInFlight.set(cacheKey, request as Promise<{ data: unknown; meta: unknown }>)
    return request
  }

  private async fetchConnectorGet<T>(
    context: ConnectorRequestContext,
    path: string,
    cacheKey: string,
    cached: ConnectorCacheEntry<T> | undefined,
  ): Promise<{ data: T; meta: unknown }> {
    const response = await fetch(`${context.connectorOrigin}${path}`, {
      headers: {
        ...context.headers,
        ...(cached?.etag ? { "if-none-match": cached.etag } : {}),
        ...(cached?.lastModified ? { "if-modified-since": cached.lastModified } : {}),
      },
      signal: AbortSignal.timeout(20_000),
    })

    if (response.status === 304 && cached) {
      cached.fetchedAt = Date.now()
      return { data: cached.data, meta: cached.meta }
    }

    const payload = await readConnectorPayload(response)
    if (!response.ok) {
      throw new Error(`Connector request failed with status ${response.status}`)
    }

    const result = unwrapConnectorEnvelope<T>(payload)
    this.connectorGetCache.set(cacheKey, {
      data: result.data,
      etag: asString(response.headers.get("etag")),
      fetchedAt: Date.now(),
      lastModified: asString(response.headers.get("last-modified")),
      meta: result.meta,
    })
    return result
  }

  private clearConnectorGetCache(): void {
    this.connectorGetCache.clear()
    this.connectorGetInFlight.clear()
    this.invalidateConnectionSummaryCache()
  }

  private clearConnectionSummaryState(): void {
    this.invalidateConnectionSummaryCache({ clearLastReady: true })
  }

  private invalidateConnectionSummaryCache(options: { clearLastReady?: boolean } = {}): void {
    this.connectionSummaryCache = undefined
    this.connectionSummaryInFlight = undefined
    this.connectionSummaryGeneration += 1
    if (options.clearLastReady) {
      this.lastReadySummary = undefined
    }
  }

  private getCachedConnectionSummary(accountKey: string, now: number): ConnectionSummary | undefined {
    const entry = this.connectionSummaryCache
    if (!isAccountEntry(entry, accountKey)) {
      return undefined
    }
    return now - entry.fetchedAt < connectionSummaryCacheMs ? entry.summary : undefined
  }

  private setConnectionSummaryCache(accountKey: string, summary: ConnectionSummary): void {
    this.connectionSummaryCache = { accountKey, fetchedAt: Date.now(), summary }
    if (summary.status === "ready") {
      this.lastReadySummary = { accountKey, fetchedAt: Date.now(), summary }
    }
  }

  private getLastReadySummary(accountKey: string): ConnectionSummary | undefined {
    const entry = this.lastReadySummary
    return isAccountEntry(entry, accountKey) ? entry.summary : undefined
  }

  private isCurrentConnectionSummaryRefresh(accountKey: string, generation: number): boolean {
    const authToken = this.authToken
    return (
      this.connectionSummaryGeneration === generation &&
      authToken !== undefined &&
      this.connectionAccountKey(authToken) === accountKey
    )
  }

  private createSupersededConnectionSummary(accountKey: string, message?: string): ConnectionSummary {
    const authToken = this.authToken
    if (authToken === undefined) {
      return createEmptyConnectionSummary("signed-out", message, this.workspace)
    }

    const currentAccountKey = this.connectionAccountKey(authToken)
    if (currentAccountKey !== accountKey) {
      return (
        this.getCachedConnectionSummary(currentAccountKey, Date.now()) ??
        this.getLastReadySummary(currentAccountKey) ??
        createEmptyConnectionSummary("unavailable", message, this.workspace)
      )
    }

    return createSupersededConnectionSummaryFallback({
      accountMatches: true,
      cached: this.getCachedConnectionSummary(accountKey, Date.now()),
      message,
      previous: this.getLastReadySummary(accountKey),
    })
  }

  private connectionAccountKey(authToken: string): string {
    return `${authToken}:${connectionWorkspaceKey(this.workspace)}`
  }

  private async emitSummaryChanged(summary: ConnectionSummary): Promise<void> {
    await this.send("connectionSummaryChanged", { summary })
  }
}

async function readConnectorPayload(response: Response): Promise<unknown> {
  const text = await response.text()
  if (!text) {
    return null
  }

  try {
    return JSON.parse(text)
  } catch {
    return text
  }
}

interface RawAccount {
  accountLabel?: string
  alias?: string | null
  authType?: ConnectionAccount["authType"]
  createdAt?: number
  displayName?: string
  id: string
  isDefault?: boolean
  providerAccountId?: string
  scopes?: string[]
  service: string
  status?: string
  updatedAt?: number
}

interface RawAction {
  description?: string
  id?: string
  name?: string
  requiredScopes?: string[]
  service: string
}
