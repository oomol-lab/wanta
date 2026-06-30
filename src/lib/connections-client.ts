import type {
  ConnectionConnectInput,
  ConnectionExecutionLogRequest,
  ConnectionExecutionLogSummary,
  ConnectionProviderDetail,
  ConnectionSummary,
  ConnectionWorkspace,
} from "../../electron/connections/common.ts"
import type { RawApp, RawAppListMeta, RawProvider } from "../../electron/connections/summary.ts"

import { createConnectorOAuthReturnUri, parseConnectorAuthorizationUrl } from "../../electron/connections/domain.ts"
import { normalizeConnectionExecutionLogs } from "../../electron/connections/executions.ts"
import { createFederatedConnectBody } from "../../electron/connections/federated.ts"
import {
  connectionUsageSummaryDays,
  createEmptyConnectionUsageSummary,
} from "../../electron/connections/summary-model.ts"
import {
  mergeConnectionSummary,
  normalizeApiKeyConfig,
  normalizeCustomCredentialConfig,
  normalizeProvider,
} from "../../electron/connections/summary.ts"
import { normalizeUsageSummary } from "../../electron/connections/usage.ts"
import { connectorBaseUrl, consoleBaseUrl } from "@/lib/domain"
import { oomolFetch } from "@/lib/oomol-http"

// 连接器面板的全部 HTTP 在渲染层直接发起：原先这些是渲染业务驱动、却由主进程 ConnectionsServiceImpl
// 代发的请求（且在每 2s 的 oauth 轮询里高频触发，正是"主进程做太多"的典型）。凭证经 httpOnly 会话 cookie
// 自动附带（oomolFetch 内 credentials:"include"），token 不进渲染层（守 R4）；域名从 @/lib/domain 派生（守 R2）。
// oauth2 的"开系统浏览器"与"同步 agent 组织作用域"仍是主进程职责，分别经 openExternalUrl / setAgentOrganization IPC。
// summary/usage/executions/federated/domain 的纯函数复用主进程同款模块。

const connectorRequestTimeoutMs = 20_000
const connectorGetCacheMs = 30_000

const executionLogDefaultLimit = 12
const executionLogMaxLimit = 50

interface ConnectorEnvelope<T> {
  data?: T
  errorMessage?: string
  message?: string
  meta?: unknown
  success?: boolean
}

interface ConnectorCacheEntry {
  data: unknown
  etag?: string
  fetchedAt: number
  lastModified?: string
  meta: unknown
}

const connectorGetCache = new Map<string, ConnectorCacheEntry>()
const connectorGetInFlight = new Map<string, Promise<{ data: unknown; meta: unknown }>>()

export function clearConnectorCache(): void {
  connectorGetCache.clear()
  connectorGetInFlight.clear()
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined
}

function connectionWorkspaceKey(workspace: ConnectionWorkspace): string {
  if (workspace.type !== "organization") {
    return "personal"
  }
  return workspace.organizationId
    ? `organization:${workspace.organizationId}`
    : `organization-name:${workspace.organizationName}`
}

function workspaceHeaders(workspace: ConnectionWorkspace): Record<string, string> {
  if (workspace.type !== "organization") {
    return {}
  }
  return {
    "x-oo-organization-name": workspace.organizationName,
    ...(workspace.organizationId ? { "x-oo-organization-id": workspace.organizationId } : {}),
  }
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

/** 变更类请求（POST/DELETE/PATCH/PUT）：不缓存，cookie 鉴权 + 可选组织头。 */
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
    throw new Error(`Connector ${path} failed: ${extractEnvelopeMessage(payload) ?? `HTTP ${response.status}`}`)
  }
  return unwrapConnectorEnvelope<T>(payload)
}

/** 读类 GET：带 etag/if-modified-since 条件请求 + 30s TTL，按 workspace+path 缓存（沿用主进程行为，省去每次轮询重拉目录）。 */
async function getConnector<T>(
  path: string,
  workspace: ConnectionWorkspace,
  options: { forceRefresh?: boolean } = {},
): Promise<{ data: T; meta: unknown }> {
  const cacheKey = `${connectionWorkspaceKey(workspace)}:${path}`
  const cached = connectorGetCache.get(cacheKey)
  const now = Date.now()
  if (!options.forceRefresh && cached && now - cached.fetchedAt < connectorGetCacheMs) {
    return { data: cached.data as T, meta: cached.meta }
  }
  const inFlight = connectorGetInFlight.get(cacheKey)
  if (!options.forceRefresh && inFlight) {
    return inFlight as Promise<{ data: T; meta: unknown }>
  }

  const request = fetchConnectorGet<T>(path, workspace, cacheKey, cached).finally(() => {
    connectorGetInFlight.delete(cacheKey)
  })
  connectorGetInFlight.set(cacheKey, request as Promise<{ data: unknown; meta: unknown }>)
  return request
}

async function fetchConnectorGet<T>(
  path: string,
  workspace: ConnectionWorkspace,
  cacheKey: string,
  cached: ConnectorCacheEntry | undefined,
): Promise<{ data: T; meta: unknown }> {
  const response = await oomolFetch(`${connectorBaseUrl}${path}`, {
    headers: {
      ...workspaceHeaders(workspace),
      ...(cached?.etag ? { "if-none-match": cached.etag } : {}),
      ...(cached?.lastModified ? { "if-modified-since": cached.lastModified } : {}),
    },
    timeoutMs: connectorRequestTimeoutMs,
  })

  if (response.status === 304 && cached) {
    cached.fetchedAt = Date.now()
    return { data: cached.data as T, meta: cached.meta }
  }

  const payload = await readConnectorPayload(response)
  if (!response.ok) {
    throw new Error(`Connector request failed with status ${response.status}`)
  }

  const result = unwrapConnectorEnvelope<T>(payload)
  connectorGetCache.set(cacheKey, {
    data: result.data,
    etag: asString(response.headers.get("etag")),
    fetchedAt: Date.now(),
    lastModified: asString(response.headers.get("last-modified")),
    meta: result.meta,
  })
  return result
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

export async function getConnectionSummary(
  workspace: ConnectionWorkspace,
  options: { forceRefresh?: boolean } = {},
): Promise<ConnectionSummary> {
  const usageResultsRequest = Promise.allSettled([
    getConnector<unknown>(`/v1/usage/daily?days=${connectionUsageSummaryDays}`, workspace, options),
    getConnector<unknown>(`/v1/usage/services?days=${connectionUsageSummaryDays}`, workspace, options),
  ])
  const [appsResult, providersResult, usageResults] = await Promise.all([
    getConnector<RawApp[]>("/v1/apps", workspace, options),
    getConnector<RawProvider[]>("/v1/providers", workspace, options),
    usageResultsRequest,
  ])
  return mergeConnectionSummary({
    apps: appsResult.data,
    meta: appsResult.meta as RawAppListMeta | null,
    providers: providersResult.data,
    usage: normalizeOptionalUsageSummary(usageResults),
    workspace,
  })
}

export async function isProviderConnectionActive(service: string, workspace: ConnectionWorkspace): Promise<boolean> {
  const appsResult = await getConnector<RawApp[]>("/v1/apps", workspace, { forceRefresh: true })
  return appsResult.data.some((app) => app.service === service && app.status === "active")
}

export async function getConnectionProviderDetail(
  service: string,
  workspace: ConnectionWorkspace,
): Promise<ConnectionProviderDetail> {
  const [summary, providerResult] = await Promise.all([
    getConnectionSummary(workspace),
    getConnector<RawProvider>(`/v1/providers/${encodeURIComponent(service)}`, workspace),
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

/** oauth2 连接：POST 取授权 URL（渲染层随后经 openExternalUrl IPC 交系统浏览器打开）。 */
export async function startOAuthConnect(
  input: Extract<ConnectionConnectInput, { authType: "oauth2" }>,
  workspace: ConnectionWorkspace,
): Promise<OAuthConnectStart> {
  const service = encodeURIComponent(input.service)
  const path = input.appId ? `/v1/apps/by-id/${encodeURIComponent(input.appId)}/connect` : `/v1/apps/${service}/connect`
  const result = await requestConnector<{ authorizationUrl?: unknown }>(path, workspace, {
    method: "POST",
    body: JSON.stringify({ returnUri: createConnectorOAuthReturnUri(consoleBaseUrl) }),
  })
  const authorizationUrl = asString(result.data.authorizationUrl)
  if (!authorizationUrl) {
    throw new Error("Connector connect request did not return an authorization URL")
  }
  clearConnectorCache()
  return { authorizationUrl: parseConnectorAuthorizationUrl(authorizationUrl).toString() }
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
        body: JSON.stringify({ apiKey: input.apiKey, label: input.label, extra: input.extra }),
      })
      break
    }
    case "custom_credential": {
      const path = input.appId
        ? `/v1/apps/by-id/${encodeURIComponent(input.appId)}/connect/custom-credential`
        : `/v1/apps/${service}/connect/custom-credential`
      await requestConnector(path, workspace, {
        method: "POST",
        body: JSON.stringify({ values: input.values, label: input.label }),
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
  clearConnectorCache()
}

export async function disconnectProvider(service: string, workspace: ConnectionWorkspace): Promise<void> {
  await requestConnector(`/v1/apps/${encodeURIComponent(service)}`, workspace, { method: "DELETE" })
  clearConnectorCache()
}

export async function disconnectAccount(appId: string, workspace: ConnectionWorkspace): Promise<void> {
  await requestConnector(`/v1/apps/by-id/${encodeURIComponent(appId)}`, workspace, { method: "DELETE" })
  clearConnectorCache()
}

export async function updateAlias(appId: string, alias: string, workspace: ConnectionWorkspace): Promise<void> {
  await requestConnector(`/v1/apps/by-id/${encodeURIComponent(appId)}`, workspace, {
    method: "PATCH",
    body: JSON.stringify({ alias: alias.trim() === "" ? null : alias.trim() }),
  })
  clearConnectorCache()
}

export async function setDefaultAccount(service: string, appId: string, workspace: ConnectionWorkspace): Promise<void> {
  await requestConnector(`/v1/apps/services/${encodeURIComponent(service)}/default`, workspace, {
    method: "PUT",
    body: JSON.stringify({ appId }),
  })
  clearConnectorCache()
}
