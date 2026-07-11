import type {
  CreateOrganizationRequest,
  Organization,
  OrganizationAppAccess,
  OrganizationMember,
  OrganizationMemberRequest,
  OrganizationOverview,
  OrganizationProviderOption,
  OrganizationUserSearchResult,
  OrganizationUserSummary,
  UpdateOrganizationMembersStatusRequest,
  UpdateOrganizationRequest,
  UploadOrganizationAvatarResponse,
} from "../../electron/organizations/common.ts"

import { apiBaseUrl, connectorBaseUrl, orgControlBaseUrl } from "@/lib/domain"
import { oomolFetch } from "@/lib/oomol-http"

// 组织面板/管理 UI 的全部网络读写在渲染层直接发起：原先这些是渲染业务驱动、却由主进程
// OrganizationsServiceImpl 代发的请求（且其鉴权本就是读会话 cookie）。凭证经 httpOnly 会话 cookie
// 自动附带（oomolFetch 内 credentials:"include"），token 不进渲染层（守 R4）；域名从 @/lib/domain 派生（守 R2）。

interface OrganizationsEnvelope {
  organizations?: unknown
}

interface OrganizationMembersEnvelope {
  members?: unknown
}

interface ConnectorEnvelope<T> {
  data?: T
  errorMessage?: string
  message?: string
  meta?: unknown
  success?: boolean
}

interface RawConnectorApp {
  service?: unknown
  status?: unknown
}

interface RawConnectorProvider {
  displayName?: unknown
  service?: unknown
}

interface RequestOptions extends RequestInit {
  headers?: Record<string, string>
  noResult?: boolean
}

const organizationRequestTimeoutMs = 20_000
const userSummaryBatchSize = 100
const userSummaryBatchConcurrency = 4
const organizationMemberLimitPatterns = [
  "organization member limit exceeded",
  "member limit exceeded",
  "seat limit exceeded",
  "member quota exceeded",
]

export class OrganizationRequestError extends Error {
  readonly apiMessage: string | undefined
  readonly code: string | undefined
  readonly status: number

  constructor({
    apiMessage,
    code,
    status,
    statusText,
  }: {
    apiMessage?: string
    code?: string
    status: number
    statusText: string
  }) {
    super(`HTTP ${status}: ${apiMessage ?? statusText}`)
    this.name = "OrganizationRequestError"
    this.apiMessage = apiMessage
    this.code = code
    this.status = status
  }
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false
  }
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

function normalizeAvatarUrl(value: unknown): string {
  const raw = asString(value)?.trim()
  if (!raw) {
    return ""
  }
  try {
    const url = new URL(raw, apiBaseUrl)
    return url.protocol === "http:" || url.protocol === "https:" ? url.toString() : ""
  } catch {
    return ""
  }
}

function normalizeOrganization(value: unknown): Organization | undefined {
  if (!isPlainObject(value)) {
    return undefined
  }
  const id = asString(value["id"])
  const name = asString(value["name"])
  const creatorUserId = asString(value["creator_user_id"])
  const role = value["role"]
  const writable = value["writable"]
  if (!id || !name || !creatorUserId) {
    return undefined
  }
  return {
    id,
    name,
    avatar: normalizeAvatarUrl(value["avatar"]),
    creator_user_id: creatorUserId,
    ...(role === "creator" || role === "member" ? { role } : {}),
    ...(typeof writable === "boolean" ? { writable } : {}),
  }
}

function normalizeOrganizationList(value: unknown): Organization[] {
  if (!Array.isArray(value)) {
    return []
  }
  return value.map(normalizeOrganization).filter((item): item is Organization => Boolean(item))
}

function normalizeOrganizationMember(value: unknown): OrganizationMember | undefined {
  if (!isPlainObject(value)) {
    return undefined
  }
  const userId = asString(value["user_id"])
  const role = value["role"]
  if (!userId || (role !== "creator" && role !== "member")) {
    return undefined
  }
  return {
    user_id: userId,
    role,
    ...(typeof value["disable"] === "boolean" ? { disable: value["disable"] } : {}),
  }
}

function normalizeOrganizationMembers(value: unknown): OrganizationMember[] {
  if (!Array.isArray(value)) {
    return []
  }
  return value.map(normalizeOrganizationMember).filter((item): item is OrganizationMember => Boolean(item))
}

function normalizeUserSummaryMap(value: unknown): Record<string, OrganizationUserSummary> {
  if (!isPlainObject(value)) {
    return {}
  }
  const result: Record<string, OrganizationUserSummary> = {}
  for (const [userId, summary] of Object.entries(value)) {
    if (!isPlainObject(summary)) {
      continue
    }
    result[userId] = {
      nickname: asString(summary["nickname"]) ?? "",
      ...(asString(summary["role"]) ? { role: asString(summary["role"]) } : {}),
      ...(asString(summary["url"]) ? { url: asString(summary["url"]) } : {}),
      username: asString(summary["username"]) ?? userId,
    }
  }
  return result
}

function normalizeUserSearchResult(value: unknown): OrganizationUserSearchResult | undefined {
  if (!isPlainObject(value)) {
    return undefined
  }
  const userId = asString(value["user_id"])
  const username = asString(value["username"])
  if (!userId || !username) {
    return undefined
  }
  return {
    avatar: asString(value["avatar"]) ?? "",
    nickname: asString(value["nickname"]) ?? "",
    user_id: userId,
    username,
  }
}

function normalizeUserSearchResults(value: unknown): OrganizationUserSearchResult[] {
  if (!Array.isArray(value)) {
    return []
  }
  return value.map(normalizeUserSearchResult).filter((item): item is OrganizationUserSearchResult => Boolean(item))
}

function normalizeConnectorEnvelope<T>(payload: unknown): T {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return payload as T
  }
  const envelope = payload as ConnectorEnvelope<T>
  if (envelope.success === false) {
    throw new Error(envelope.errorMessage || envelope.message || "Connector request failed")
  }
  if ("data" in envelope) {
    return envelope.data as T
  }
  return payload as T
}

function normalizeProviderOptions(
  apps: RawConnectorApp[],
  providers: RawConnectorProvider[],
): OrganizationProviderOption[] {
  const providerLabelByService = new Map(
    providers
      .map((provider) => {
        const service = asString(provider.service)
        return service ? ([service, asString(provider.displayName) ?? service] as const) : undefined
      })
      .filter((item): item is readonly [string, string] => Boolean(item)),
  )
  const connectedServices = new Set<string>()
  for (const app of apps) {
    const service = asString(app.service)
    if (service && app.status !== "disconnected") {
      connectedServices.add(service)
    }
  }
  return Array.from(connectedServices)
    .map((service) => ({ service, label: providerLabelByService.get(service) ?? service }))
    .sort((left, right) => left.label.localeCompare(right.label))
}

function normalizeAppAccess(value: unknown): OrganizationAppAccess {
  return isPlainObject(value) ? (value as OrganizationAppAccess) : {}
}

function isFormDataBody(body: unknown): body is FormData {
  return typeof FormData !== "undefined" && body instanceof FormData
}

function encodePath(value: string): string {
  return encodeURIComponent(value)
}

function requireIdentifier(value: string, label: string): string {
  const normalized = value.trim()
  if (!normalized) {
    throw new Error(`${label} is required.`)
  }
  return normalized
}

async function readPayload(response: Response): Promise<unknown> {
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

function readErrorMessage(payload: unknown): string | undefined {
  if (typeof payload === "string") {
    return payload
  }
  if (!isPlainObject(payload)) {
    return undefined
  }
  return (
    asString(payload["errorMessage"]) ??
    asString(payload["message"]) ??
    asString(payload["detail"]) ??
    asString(payload["error"]) ??
    asString(payload["code"])
  )
}

function readErrorCode(payload: unknown): string | undefined {
  if (!isPlainObject(payload)) {
    return undefined
  }
  return asString(payload["code"]) ?? asString(payload["errorCode"]) ?? asString(payload["error_code"])
}

export function isOrganizationMemberLimitError(error: unknown): boolean {
  const message =
    error instanceof OrganizationRequestError
      ? `${error.apiMessage ?? ""}\n${error.code ?? ""}\n${error.message}`
      : error instanceof Error
        ? error.message
        : String(error)
  const normalized = message.toLowerCase()
  return organizationMemberLimitPatterns.some((pattern) => normalized.includes(pattern))
}

async function requestJson(baseUrl: string, path: string, options: RequestOptions = {}): Promise<unknown> {
  const { headers: optionHeaders, noResult, ...init } = options
  const headers: Record<string, string> = {
    Accept: "application/json, text/plain, */*",
    ...optionHeaders,
  }
  if (init.body !== undefined && !headers["content-type"] && !isFormDataBody(init.body)) {
    headers["content-type"] = "application/json"
  }
  const response = await oomolFetch(new URL(path, baseUrl), {
    ...init,
    headers,
    timeoutMs: organizationRequestTimeoutMs,
  })
  const payload = await readPayload(response)
  if (!response.ok) {
    throw new OrganizationRequestError({
      apiMessage: readErrorMessage(payload),
      code: readErrorCode(payload),
      status: response.status,
      statusText: response.statusText,
    })
  }
  if (noResult || response.status === 204) {
    return undefined
  }
  return payload
}

function requestApiJson(path: string, options: RequestOptions = {}): Promise<unknown> {
  return requestJson(apiBaseUrl, path, options)
}

function requestOrgControlJson(path: string, options: RequestOptions = {}): Promise<unknown> {
  return requestJson(orgControlBaseUrl, path, options)
}

async function requestConnectorJson<T>(path: string, options: RequestOptions = {}): Promise<T> {
  return normalizeConnectorEnvelope<T>(await requestJson(connectorBaseUrl, path, options))
}

export async function listCreatedOrganizations(): Promise<Organization[]> {
  const result = (await requestOrgControlJson("/v1/organizations")) as OrganizationsEnvelope
  return normalizeOrganizationList(result.organizations)
}

export async function listMyOrganizations(): Promise<Organization[]> {
  const result = (await requestOrgControlJson("/v1/me/organizations")) as OrganizationsEnvelope
  return normalizeOrganizationList(result.organizations)
}

export async function getOrganizationOverview(accountId: string): Promise<OrganizationOverview> {
  const [created, joined] = await Promise.all([listCreatedOrganizations(), listMyOrganizations()])
  return { accountId, created, joined, updatedAt: new Date().toISOString() }
}

export async function createOrganization(req: CreateOrganizationRequest): Promise<Organization> {
  const orgName = req.orgName.trim()
  if (!orgName) {
    throw new Error("Organization name is required.")
  }
  const organization = normalizeOrganization(
    await requestApiJson("/v1/orgs", {
      method: "POST",
      body: JSON.stringify({ org_name: orgName, ...(req.avatar?.trim() ? { avatar: req.avatar.trim() } : {}) }),
    }),
  )
  if (!organization) {
    throw new Error("Organization response is invalid.")
  }
  return organization
}

export async function updateOrganization(req: UpdateOrganizationRequest): Promise<Organization> {
  const orgId = requireIdentifier(req.orgId, "Organization id")
  const orgName = req.orgName.trim()
  if (!orgName) {
    throw new Error("Organization name is required.")
  }
  const organization = normalizeOrganization(
    await requestApiJson(`/v1/orgs/${encodePath(orgId)}`, {
      method: "PUT",
      body: JSON.stringify({ org_name: orgName, avatar: req.avatar.trim() }),
    }),
  )
  if (!organization) {
    throw new Error("Organization response is invalid.")
  }
  return organization
}

export async function uploadOrganizationAvatar(orgId: string, file: File): Promise<UploadOrganizationAvatarResponse> {
  const id = requireIdentifier(orgId, "Organization id")
  const form = new FormData()
  form.set("file", file)
  const result = await requestApiJson(`/v1/orgs/${encodePath(id)}/avatar`, {
    method: "POST",
    body: form,
  })
  const avatar = isPlainObject(result) ? asString(result["avatar"]) : undefined
  const uploadedAvatar = avatar?.trim()
  if (!uploadedAvatar) {
    throw new Error("Organization avatar response is invalid.")
  }
  return { avatar: uploadedAvatar }
}

export async function listOrganizationMembers(orgId: string): Promise<OrganizationMember[]> {
  const id = requireIdentifier(orgId, "Organization id")
  const result = (await requestOrgControlJson(
    `/v1/organizations/${encodePath(id)}/members`,
  )) as OrganizationMembersEnvelope
  return normalizeOrganizationMembers(result.members)
}

export async function listUserSummaries(userIds: string[]): Promise<Record<string, OrganizationUserSummary>> {
  const normalizedIds = Array.from(new Set(userIds.map((userId) => userId.trim()).filter(Boolean))).sort()
  if (normalizedIds.length === 0) {
    return {}
  }

  const batches: string[][] = []
  for (let index = 0; index < normalizedIds.length; index += userSummaryBatchSize) {
    batches.push(normalizedIds.slice(index, index + userSummaryBatchSize))
  }

  const summaries: Record<string, OrganizationUserSummary> = {}
  let nextBatchIndex = 0
  const workerCount = Math.min(userSummaryBatchConcurrency, batches.length)
  await Promise.all(
    Array.from({ length: workerCount }, async () => {
      while (nextBatchIndex < batches.length) {
        const batch = batches[nextBatchIndex]
        nextBatchIndex += 1
        if (!batch) {
          continue
        }
        const searchParams = new URLSearchParams()
        for (const userId of batch) {
          searchParams.append("user_ids", userId)
        }
        Object.assign(
          summaries,
          normalizeUserSummaryMap(await requestApiJson(`/v1/users/summaries?${searchParams.toString()}`)),
        )
      }
    }),
  )
  return summaries
}

export async function searchUsers(
  keyword: string,
  options: { signal?: AbortSignal } = {},
): Promise<OrganizationUserSearchResult[]> {
  const normalized = keyword.trim()
  if (!normalized) {
    return []
  }
  return normalizeUserSearchResults(
    await requestApiJson(`/v1/users?${new URLSearchParams({ keyword: normalized }).toString()}`, {
      signal: options.signal,
    }),
  )
}

export async function addOrganizationMember(req: OrganizationMemberRequest): Promise<void> {
  const orgId = requireIdentifier(req.orgId, "Organization id")
  const userId = requireIdentifier(req.userId, "User id")
  await requestOrgControlJson(`/v1/organizations/${encodePath(orgId)}/members`, {
    method: "POST",
    body: JSON.stringify({ user_id: userId, role: "member" }),
    noResult: true,
  })
}

export async function removeOrganizationMember(req: OrganizationMemberRequest): Promise<void> {
  const orgId = requireIdentifier(req.orgId, "Organization id")
  const userId = requireIdentifier(req.userId, "User id")
  await requestOrgControlJson(`/v1/organizations/${encodePath(orgId)}/members/${encodePath(userId)}`, {
    method: "DELETE",
    noResult: true,
  })
}

function normalizedMemberStatusUserIds(userIds: string[]): string[] {
  return Array.from(new Set(userIds.map((userId) => userId.trim()).filter(Boolean)))
}

async function updateOrganizationMembersStatus(
  req: UpdateOrganizationMembersStatusRequest,
  path: "disable" | "enable",
): Promise<void> {
  const orgId = requireIdentifier(req.orgId, "Organization id")
  const userIds = normalizedMemberStatusUserIds(req.userIds)
  if (userIds.length === 0) {
    throw new Error("Member user ids are required.")
  }
  await requestOrgControlJson(`/v1/organizations/${encodePath(orgId)}/members/${path}`, {
    method: "PUT",
    body: JSON.stringify({ user_ids: userIds }),
    noResult: true,
  })
}

export function enableOrganizationMembers(req: UpdateOrganizationMembersStatusRequest): Promise<void> {
  return updateOrganizationMembersStatus(req, "enable")
}

export function disableOrganizationMembers(req: UpdateOrganizationMembersStatusRequest): Promise<void> {
  return updateOrganizationMembersStatus(req, "disable")
}

export async function getOrganizationAppAccess(orgId: string): Promise<OrganizationAppAccess> {
  const id = requireIdentifier(orgId, "Organization id")
  return normalizeAppAccess(await requestOrgControlJson(`/v1/organizations/${encodePath(id)}/app-access`))
}

export async function updateOrganizationAppAccess(
  orgId: string,
  access: OrganizationAppAccess,
): Promise<OrganizationAppAccess> {
  const id = requireIdentifier(orgId, "Organization id")
  const updated = normalizeAppAccess(
    await requestOrgControlJson(`/v1/organizations/${encodePath(id)}/app-access`, {
      method: "PUT",
      body: JSON.stringify(access),
    }),
  )
  return updated
}

export async function listOrganizationProviderOptions(organizationName: string): Promise<OrganizationProviderOption[]> {
  const normalized = organizationName.trim()
  if (!normalized) {
    return []
  }
  const [apps, providers] = await Promise.all([
    requestConnectorJson<RawConnectorApp[]>("/v1/apps", { headers: { "x-oo-organization-name": normalized } }),
    requestConnectorJson<RawConnectorProvider[]>("/v1/providers"),
  ])
  return normalizeProviderOptions(Array.isArray(apps) ? apps : [], Array.isArray(providers) ? providers : [])
}
