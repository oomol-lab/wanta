import type {
  ConnectionConnectInput,
  ConnectionAppDetail,
  ConnectionExecutionLogRequest,
  ConnectionExecutionLogSummary,
  ConnectionProviderDetail,
  ConnectionSummary,
  ConnectionUsageSummary,
  ConnectionUserOAuthClientConfigSummary,
  ConnectionWorkspace,
  UpsertConnectionOAuthClientConfigPayload,
} from "../../electron/connections/common.ts"
import type { RawApp, RawAppListMeta, RawProvider } from "../../electron/connections/summary.ts"

import { branding } from "../../electron/branding.ts"
import { createConnectorOAuthReturnUri, parseConnectorAuthorizationUrl } from "../../electron/connections/domain.ts"
import { normalizeConnectionExecutionLogs } from "../../electron/connections/executions.ts"
import { createFederatedConnectBody } from "../../electron/connections/federated.ts"
import {
  connectionUsageSummaryDays,
  createEmptyConnectionUsageSummary,
} from "../../electron/connections/summary-model.ts"
import {
  mergeConnectionSummary,
  normalizeConnectionAppDetail,
  normalizeApiKeyConfig,
  normalizeCustomCredentialConfig,
  normalizeFederatedCredentialConfig,
  normalizeOAuthClientConfig,
  normalizeProvider,
} from "../../electron/connections/summary.ts"
import { normalizeUsageSummary } from "../../electron/connections/usage.ts"
import { connectionWorkspaceKey } from "@/lib/connection-workspace"
import { connectorBaseUrl, consoleBaseUrl } from "@/lib/domain"
import { oomolFetch } from "@/lib/oomol-http"
import { reportRendererHandledError } from "@/lib/renderer-diagnostics"

// 连接器面板的全部 HTTP 在渲染层直接发起：原先这些是渲染业务驱动、却由主进程 ConnectionsServiceImpl
// 代发的请求（且在每 2s 的 oauth 轮询里高频触发，正是"主进程做太多"的典型）。凭证经 httpOnly 会话 cookie
// 自动附带（oomolFetch 内 credentials:"include"），token 不进渲染层（守 R4）；域名从 @/lib/domain 派生（守 R2）。
// oauth2 的"开系统浏览器"与"同步 agent 团队作用域"仍是主进程职责，分别经 openExternalUrl / setAgentTeam IPC。
// summary/usage/executions/federated/domain 的纯函数复用主进程同款模块。

const connectorRequestTimeoutMs = 20_000
const connectorGetCacheMs = 30_000
const oauthClientConfigCacheMs = 5 * 60_000

const executionLogDefaultLimit = 12
const executionLogMaxLimit = 50

interface ConnectorEnvelope<T> {
  data?: T
  errorMessage?: string
  message?: string
  meta?: unknown
  success?: boolean
}

export class ConnectorRequestError extends Error {
  readonly apiMessage: string | undefined
  readonly code: string | undefined
  readonly path: string
  readonly status: number

  constructor({
    apiMessage,
    code,
    path,
    status,
    statusText,
  }: {
    apiMessage?: string
    code?: string
    path: string
    status: number
    statusText: string
  }) {
    super(`Connector ${path} failed: HTTP ${status}: ${apiMessage ?? statusText}`)
    this.name = "ConnectorRequestError"
    this.apiMessage = apiMessage
    this.code = code
    this.path = path
    this.status = status
  }
}

interface ConnectorCacheEntry {
  data: unknown
  etag?: string
  fetchedAt: number
  lastModified?: string
  meta: unknown
}

export interface ConnectorReadOptions {
  forceRefresh?: boolean
  /** 同一次 UI 刷新产生的强制读取可合并；新 mutation 使用新的 generation。 */
  refreshGeneration?: string
}

interface ConnectorInFlightEntry {
  promise: Promise<{ data: unknown; meta: unknown }>
  refreshGeneration?: string
}

interface OAuthClientConfigsCacheEntry {
  data: ConnectionUserOAuthClientConfigSummary[] | null
  fetchedAt: number
  promise: Promise<ConnectionUserOAuthClientConfigSummary[]> | null
}

const connectorGetCache = new Map<string, ConnectorCacheEntry>()
const connectorGetInFlight = new Map<string, ConnectorInFlightEntry>()
const connectorGetRequestVersions = new Map<string, number>()
const oauthConnectInFlight = new Map<string, Promise<OAuthConnectStart>>()
const oauthClientConfigsCache: OAuthClientConfigsCacheEntry = { data: null, fetchedAt: 0, promise: null }
let connectorReadCacheGeneration = 0

function clearConnectorReadCache(): void {
  connectorReadCacheGeneration += 1
  connectorGetCache.clear()
  connectorGetInFlight.clear()
  connectorGetRequestVersions.clear()
}

function invalidateConnectorReadCache(predicate: (cacheKey: string) => boolean): void {
  const keys = new Set([
    ...connectorGetCache.keys(),
    ...connectorGetInFlight.keys(),
    ...connectorGetRequestVersions.keys(),
  ])
  for (const key of keys) {
    if (!predicate(key)) {
      continue
    }
    connectorGetCache.delete(key)
    connectorGetInFlight.delete(key)
    connectorGetRequestVersions.set(key, (connectorGetRequestVersions.get(key) ?? 0) + 1)
  }
}

function invalidateWorkspaceApps(workspace: ConnectionWorkspace, appId?: string): void {
  const prefix = `${connectionWorkspaceKey(workspace)}:`
  invalidateConnectorReadCache((key) => {
    if (!key.startsWith(prefix)) {
      return false
    }
    const path = key.slice(prefix.length)
    return (
      path === "/v1/apps" ||
      (appId ? path === `/v1/apps/by-id/${encodeURIComponent(appId)}` : path.startsWith("/v1/apps/by-id/"))
    )
  })
}

function clearOAuthClientConfigsCache(): void {
  oauthClientConfigsCache.data = null
  oauthClientConfigsCache.fetchedAt = 0
  oauthClientConfigsCache.promise = null
}

export function clearConnectorCache(): void {
  clearConnectorReadCache()
  clearOAuthClientConfigsCache()
  oauthConnectInFlight.clear()
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined
}

function connectorOAuthReturnProtocol(): string {
  return typeof window !== "undefined" && window.location.protocol === "http:"
    ? branding.devProtocolScheme
    : branding.protocolScheme
}

function workspaceHeaders(workspace: ConnectionWorkspace): Record<string, string> {
  return { "x-oo-organization-name": workspace.teamName }
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
  if (typeof payload === "string") {
    return payload || undefined
  }
  if (payload && typeof payload === "object") {
    const envelope = payload as ConnectorEnvelope<unknown>
    return envelope.errorMessage || envelope.message
  }
  return undefined
}

function extractEnvelopeCode(payload: unknown): string | undefined {
  if (!payload || typeof payload !== "object") {
    return undefined
  }
  const envelope = payload as Record<string, unknown>
  const code = envelope["code"] ?? envelope["errorCode"] ?? envelope["error_code"]
  return typeof code === "string" && code.length > 0 ? code : undefined
}

function connectorResponseError(path: string, response: Response, payload: unknown): ConnectorRequestError {
  return new ConnectorRequestError({
    apiMessage: extractEnvelopeMessage(payload),
    code: extractEnvelopeCode(payload),
    path,
    status: response.status,
    statusText: response.statusText,
  })
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

/** 变更类请求（POST/DELETE/PATCH/PUT）：不缓存，cookie 鉴权 + 可选团队头。 */
async function requestConnector<T>(
  path: string,
  workspace: ConnectionWorkspace,
  init: Omit<RequestInit, "headers"> & { headers?: Record<string, string> } = {},
): Promise<{ data: T; meta: unknown }> {
  const headers: Record<string, string> = {
    "content-type": "application/json",
    ...workspaceHeaders(workspace),
    ...init.headers,
  }
  const response = await oomolFetch(`${connectorBaseUrl}${path}`, {
    ...init,
    headers,
    timeoutMs: connectorRequestTimeoutMs,
  })
  const payload = await readConnectorPayload(response)
  if (!response.ok) {
    throw connectorResponseError(path, response, payload)
  }
  return unwrapConnectorEnvelope<T>(payload)
}

/** 用户级连接器请求：OAuth client config 不随团队 workspace 变化。 */
async function requestConnectorGlobal<T>(
  path: string,
  init: Omit<RequestInit, "headers"> & { headers?: Record<string, string> } = {},
): Promise<{ data: T; meta: unknown }> {
  const headers: Record<string, string> = {
    "content-type": "application/json",
    ...init.headers,
  }
  const response = await oomolFetch(`${connectorBaseUrl}${path}`, {
    ...init,
    headers,
    timeoutMs: connectorRequestTimeoutMs,
  })
  const payload = await readConnectorPayload(response)
  if (!response.ok) {
    throw connectorResponseError(path, response, payload)
  }
  return unwrapConnectorEnvelope<T>(payload)
}

/** 读类 GET：带条件请求 + 30s TTL；团队资源按 workspace 隔离，公共目录使用 global 键。 */
async function getConnector<T>(
  path: string,
  workspace: ConnectionWorkspace | null,
  options: ConnectorReadOptions = {},
): Promise<{ data: T; meta: unknown }> {
  const cacheKey = `${workspace ? connectionWorkspaceKey(workspace) : "global"}:${path}`
  const cached = connectorGetCache.get(cacheKey)
  const now = Date.now()
  if (!options.forceRefresh && cached && now - cached.fetchedAt < connectorGetCacheMs) {
    return { data: cached.data as T, meta: cached.meta }
  }
  const inFlight = connectorGetInFlight.get(cacheKey)
  if (
    inFlight &&
    (!options.forceRefresh ||
      (Boolean(options.refreshGeneration) && inFlight.refreshGeneration === options.refreshGeneration))
  ) {
    return inFlight.promise as Promise<{ data: T; meta: unknown }>
  }

  const requestGeneration = connectorReadCacheGeneration
  const requestVersion = (connectorGetRequestVersions.get(cacheKey) ?? 0) + 1
  connectorGetRequestVersions.set(cacheKey, requestVersion)
  const request = fetchConnectorGet<T>(path, workspace, cacheKey, cached, requestGeneration, requestVersion)
  const trackedRequest = request.finally(() => {
    if (
      connectorGetRequestVersions.get(cacheKey) === requestVersion &&
      connectorGetInFlight.get(cacheKey)?.promise === trackedRequest
    ) {
      connectorGetInFlight.delete(cacheKey)
    }
  })
  connectorGetInFlight.set(cacheKey, {
    promise: trackedRequest as Promise<{ data: unknown; meta: unknown }>,
    refreshGeneration: options.refreshGeneration,
  })
  return trackedRequest
}

async function fetchConnectorGet<T>(
  path: string,
  workspace: ConnectionWorkspace | null,
  cacheKey: string,
  cached: ConnectorCacheEntry | undefined,
  generation: number,
  requestVersion: number,
): Promise<{ data: T; meta: unknown }> {
  const response = await oomolFetch(`${connectorBaseUrl}${path}`, {
    headers: {
      ...(workspace ? workspaceHeaders(workspace) : {}),
      ...(cached?.etag ? { "if-none-match": cached.etag } : {}),
      ...(cached?.lastModified ? { "if-modified-since": cached.lastModified } : {}),
    },
    timeoutMs: connectorRequestTimeoutMs,
  })

  if (response.status === 304 && cached) {
    if (connectorReadCacheGeneration === generation && connectorGetRequestVersions.get(cacheKey) === requestVersion) {
      cached.fetchedAt = Date.now()
    }
    return { data: cached.data as T, meta: cached.meta }
  }

  const payload = await readConnectorPayload(response)
  if (!response.ok) {
    throw connectorResponseError(path, response, payload)
  }

  const result = unwrapConnectorEnvelope<T>(payload)
  if (connectorReadCacheGeneration === generation && connectorGetRequestVersions.get(cacheKey) === requestVersion) {
    connectorGetCache.set(cacheKey, {
      data: result.data,
      etag: asString(response.headers.get("etag")),
      fetchedAt: Date.now(),
      lastModified: asString(response.headers.get("last-modified")),
      meta: result.meta,
    })
  }
  return result
}

function reportConnectionUsageFailure(operation: string, cause: unknown): void {
  console.warn("[wanta] connection usage request failed", { error: cause, operation })
  reportRendererHandledError("connections", operation, cause)
}

export async function getConnectionCatalogSummary(
  workspace: ConnectionWorkspace,
  options: ConnectorReadOptions = {},
): Promise<ConnectionSummary> {
  const [appsResult, providersResult] = await Promise.allSettled([
    getConnectionApps(workspace, options),
    // Provider 是公共发现目录，不应因当前团队的连接管理权限而不可见。
    getConnectionProviders(options),
  ])
  if (providersResult.status === "rejected") {
    throw providersResult.reason
  }
  if (appsResult.status === "rejected" && appsResult.reason instanceof ConnectorRequestError) {
    if (appsResult.reason.status === 401) {
      throw appsResult.reason
    }
  }
  const appsStatus =
    appsResult.status === "fulfilled"
      ? "ready"
      : appsResult.reason instanceof ConnectorRequestError && appsResult.reason.status === 403
        ? "forbidden"
        : "unavailable"
  if (
    appsResult.status === "rejected" &&
    !(appsResult.reason instanceof ConnectorRequestError && appsResult.reason.status === 403)
  ) {
    reportRendererHandledError("connections", "team connection state request failed", appsResult.reason)
  }
  return {
    ...mergeConnectionSummary({
      apps: appsResult.status === "fulfilled" ? appsResult.value.data : [],
      meta: appsResult.status === "fulfilled" ? (appsResult.value.meta as RawAppListMeta | null) : null,
      providers: providersResult.value.data,
      usage: createEmptyConnectionUsageSummary(),
      workspace,
    }),
    appsStatus,
    usageStatus: "loading",
  }
}

/** 供团队详情与连接器目录复用同一份 workspace apps 条件请求缓存。 */
export function getConnectionApps(
  workspace: ConnectionWorkspace,
  options: ConnectorReadOptions = {},
): Promise<{ data: RawApp[]; meta: unknown }> {
  return getConnector<RawApp[]>("/v1/apps", workspace, options)
}

/** Provider 是全局公共目录，跨 workspace 复用条件请求缓存。 */
export function getConnectionProviders(
  options: ConnectorReadOptions = {},
): Promise<{ data: RawProvider[]; meta: unknown }> {
  return getConnector<RawProvider[]>("/v1/providers", null, options)
}

/**
 * 目录可交互后再补齐用量。统计失败向状态层抛出，不能伪装成真实的零调用。
 */
export async function getConnectionUsageSummary(
  workspace: ConnectionWorkspace,
  options: ConnectorReadOptions = {},
): Promise<ConnectionUsageSummary> {
  try {
    const [dailyResult, servicesResult] = await Promise.all([
      getConnector<unknown>(`/v1/usage/daily?days=${connectionUsageSummaryDays}`, workspace, options),
      getConnector<unknown>(`/v1/usage/services?days=${connectionUsageSummaryDays}`, workspace, options),
    ])
    return normalizeUsageSummary(dailyResult.data, servicesResult.data)
  } catch (error) {
    reportConnectionUsageFailure("Connection usage request failed", error)
    throw error
  }
}

/** 完整摘要保留给显式动作和详情读取；目录首屏使用 getConnectionCatalogSummary 后台补齐 usage。 */
export async function getConnectionSummary(
  workspace: ConnectionWorkspace,
  options: ConnectorReadOptions = {},
): Promise<ConnectionSummary> {
  const usageRequest = getConnectionUsageSummary(workspace, options).then(
    (usage) => ({ ok: true as const, usage }),
    () => ({ ok: false as const }),
  )
  const catalog = await getConnectionCatalogSummary(workspace, options)
  const usageResult = await usageRequest
  return usageResult.ok
    ? { ...catalog, usage: usageResult.usage, usageStatus: "ready" }
    : { ...catalog, usageStatus: "unavailable" }
}

export async function getActiveConnectionAppIdsForService(
  service: string,
  workspace: ConnectionWorkspace,
): Promise<string[]> {
  const appsResult = await getConnector<RawApp[]>("/v1/apps", workspace, { forceRefresh: true })
  return appsResult.data
    .filter((app) => app.service === service && app.status === "active")
    .map((app) => asString(app.id))
    .filter((appId): appId is string => Boolean(appId))
}

export async function getConnectionProviderDetail(service: string): Promise<ConnectionProviderDetail> {
  // Provider 详情属于公共目录；账号状态已经由摘要提供，不再为打开详情重复读取整套摘要与 usage。
  const providerResult = await getConnector<RawProvider>(`/v1/providers/${encodeURIComponent(service)}`, null)
  const provider = normalizeProvider(providerResult.data, new Map())
  if (!provider) {
    throw new Error(`Provider ${service} is not available`)
  }
  return {
    ...provider,
    apiKeyConfig: normalizeApiKeyConfig(providerResult.data.apiKeyConfig),
    customCredentialConfig: normalizeCustomCredentialConfig(providerResult.data.customCredentialConfig),
    federatedCredentialConfig: normalizeFederatedCredentialConfig(providerResult.data.federatedCredentialConfig),
    homepageUrl: asString(providerResult.data.homepageUrl),
    oauthClientConfig:
      provider.oauthClientConfig ?? normalizeOAuthClientConfig(providerResult.data.oauthClientConfig, service),
  }
}

export async function getConnectionAppDetail(
  appId: string,
  workspace: ConnectionWorkspace,
): Promise<ConnectionAppDetail> {
  const result = await getConnector<RawApp>(`/v1/apps/by-id/${encodeURIComponent(appId)}`, workspace)
  const app = normalizeConnectionAppDetail(result.data)
  if (!app) {
    throw new Error(`Connection app ${appId} is not available`)
  }
  return app
}

export async function getConnectionExecutionLogs(
  request: ConnectionExecutionLogRequest,
  workspace: ConnectionWorkspace,
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
  const result = await getConnector<unknown>(
    `/v1/apps/${encodeURIComponent(service)}/executions?${searchParams.toString()}`,
    workspace,
    { forceRefresh: true },
  )
  return normalizeConnectionExecutionLogs(result.data)
}

export interface OAuthConnectStart {
  authorizationUrl: string
}

function oauthConnectInFlightKey(
  input: Extract<ConnectionConnectInput, { authType: "oauth2" }>,
  workspace: ConnectionWorkspace,
): string {
  // 只有完整请求相同才合并，避免重连或 connect-only 字段串用授权 URL。
  return JSON.stringify({
    appId: input.appId ?? null,
    extra: input.extra ?? null,
    secretExtra: input.secretExtra ?? null,
    service: input.service,
    workspace: connectionWorkspaceKey(workspace),
  })
}

/** oauth2 连接：POST 取授权 URL（渲染层随后经 openExternalUrl IPC 交系统浏览器打开）。 */
export async function startOAuthConnect(
  input: Extract<ConnectionConnectInput, { authType: "oauth2" }>,
  workspace: ConnectionWorkspace,
): Promise<OAuthConnectStart> {
  const inFlightKey = oauthConnectInFlightKey(input, workspace)
  const inFlight = oauthConnectInFlight.get(inFlightKey)
  if (inFlight) {
    return inFlight
  }
  const request = requestOAuthConnect(input, workspace).finally(() => {
    oauthConnectInFlight.delete(inFlightKey)
  })
  oauthConnectInFlight.set(inFlightKey, request)
  return request
}

async function requestOAuthConnect(
  input: Extract<ConnectionConnectInput, { authType: "oauth2" }>,
  workspace: ConnectionWorkspace,
): Promise<OAuthConnectStart> {
  const service = encodeURIComponent(input.service)
  const path = input.appId ? `/v1/apps/by-id/${encodeURIComponent(input.appId)}/connect` : `/v1/apps/${service}/connect`
  const result = await requestConnector<{ authorizationUrl?: unknown }>(path, workspace, {
    method: "POST",
    body: JSON.stringify({
      returnUri: createConnectorOAuthReturnUri(consoleBaseUrl, connectorOAuthReturnProtocol()),
      extra: input.extra,
      secretExtra: input.secretExtra,
    }),
  })
  const authorizationUrl = asString(result.data.authorizationUrl)
  if (!authorizationUrl) {
    throw new Error("Connector connect request did not return an authorization URL")
  }
  invalidateWorkspaceApps(workspace, "appId" in input ? input.appId : undefined)
  return { authorizationUrl: parseConnectorAuthorizationUrl(authorizationUrl).toString() }
}

export async function listOAuthClientConfigs(): Promise<ConnectionUserOAuthClientConfigSummary[]> {
  if (oauthClientConfigsCache.data && Date.now() - oauthClientConfigsCache.fetchedAt < oauthClientConfigCacheMs) {
    return oauthClientConfigsCache.data
  }
  if (oauthClientConfigsCache.promise) {
    return oauthClientConfigsCache.promise
  }

  const request = requestConnectorGlobal<ConnectionUserOAuthClientConfigSummary[]>("/v1/oauth-client-configs", {
    method: "GET",
  }).then((result) => result.data)
  oauthClientConfigsCache.promise = request
  void request.then(
    (data) => {
      if (oauthClientConfigsCache.promise === request) {
        oauthClientConfigsCache.data = data
        oauthClientConfigsCache.fetchedAt = Date.now()
        oauthClientConfigsCache.promise = null
      }
    },
    () => {
      if (oauthClientConfigsCache.promise === request) {
        oauthClientConfigsCache.promise = null
      }
    },
  )
  return request
}

export async function getOAuthClientConfig(service: string): Promise<ConnectionUserOAuthClientConfigSummary | null> {
  const normalizedService = service.trim()
  if (!normalizedService) {
    return null
  }
  const configs = await listOAuthClientConfigs()
  return configs.find((config) => config.service === normalizedService) ?? null
}

export async function upsertOAuthClientConfig(
  service: string,
  payload: UpsertConnectionOAuthClientConfigPayload,
): Promise<ConnectionUserOAuthClientConfigSummary> {
  const result = await requestConnectorGlobal<ConnectionUserOAuthClientConfigSummary>(
    `/v1/oauth-client-configs/${encodeURIComponent(service)}`,
    {
      method: "PUT",
      body: JSON.stringify(payload),
    },
  )
  clearOAuthClientConfigsCache()
  const encodedService = encodeURIComponent(service)
  invalidateConnectorReadCache(
    (key) => key === "global:/v1/providers" || key === `global:/v1/providers/${encodedService}`,
  )
  return result.data
}

/** 非 oauth 连接（api_key / custom_credential / federated / no_auth）：POST 即完成。 */
export async function connectProvider(input: ConnectionConnectInput, workspace: ConnectionWorkspace): Promise<void> {
  const service = encodeURIComponent(input.service)
  switch (input.authType) {
    case "api_key": {
      const path = input.appId
        ? `/v1/apps/by-id/${encodeURIComponent(input.appId)}/connect/api-key`
        : `/v1/apps/${service}/connect/api-key`
      await requestConnector(path, workspace, {
        method: "POST",
        body: JSON.stringify({ apiKey: input.apiKey, comment: input.comment, extra: input.extra }),
      })
      break
    }
    case "custom_credential": {
      const path = input.appId
        ? `/v1/apps/by-id/${encodeURIComponent(input.appId)}/connect/custom-credential`
        : `/v1/apps/${service}/connect/custom-credential`
      await requestConnector(path, workspace, {
        method: "POST",
        body: JSON.stringify({ values: input.values, comment: input.comment }),
      })
      break
    }
    case "federated": {
      const path = input.appId
        ? `/v1/apps/by-id/${encodeURIComponent(input.appId)}/connect/federated`
        : `/v1/apps/${service}/connect/federated`
      await requestConnector(path, workspace, {
        method: "POST",
        body: JSON.stringify(createFederatedConnectBody(input)),
      })
      break
    }
    case "no_auth": {
      await requestConnector(`/v1/apps/${service}/connect/no-auth`, workspace, { method: "POST" })
      break
    }
    case "oauth2": {
      throw new Error("Use startOAuthConnect for oauth2 providers.")
    }
  }
  invalidateWorkspaceApps(workspace, "appId" in input ? input.appId : undefined)
}

export async function disconnectProvider(service: string, workspace: ConnectionWorkspace): Promise<void> {
  await requestConnector(`/v1/apps/${encodeURIComponent(service)}`, workspace, { method: "DELETE" })
  invalidateWorkspaceApps(workspace)
}

export async function disconnectAccount(appId: string, workspace: ConnectionWorkspace): Promise<void> {
  await requestConnector(`/v1/apps/by-id/${encodeURIComponent(appId)}`, workspace, { method: "DELETE" })
  invalidateWorkspaceApps(workspace, appId)
}

export async function updateAlias(appId: string, alias: string, workspace: ConnectionWorkspace): Promise<void> {
  await requestConnector(`/v1/apps/by-id/${encodeURIComponent(appId)}`, workspace, {
    method: "PATCH",
    body: JSON.stringify({ alias: alias.trim() === "" ? null : alias.trim() }),
  })
  invalidateWorkspaceApps(workspace, appId)
}
