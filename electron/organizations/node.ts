import type { AuthManager } from "../auth/node.ts"
import type {
  CreateOrganizationRequest,
  Organization,
  OrganizationAppAccess,
  OrganizationMember,
  OrganizationMemberRequest,
  OrganizationOverview,
  OrganizationProviderOption,
  OrganizationProviderOptionsRequest,
  OrganizationsService,
  OrganizationUserSearchRequest,
  OrganizationUserSearchResult,
  OrganizationUsersRequest,
  OrganizationUserSummary,
  UpdateOrganizationAppAccessRequest,
} from "./common.ts"
import type { IConnectionService } from "@oomol/connection"

import { ConnectionService } from "@oomol/connection"
import { apiBaseUrl, connectorBaseUrl, orgControlBaseUrl } from "../domain.ts"
import { OrganizationsService as OrganizationsServiceName } from "./common.ts"

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

function normalizeOrganization(value: unknown): Organization | undefined {
  if (!isPlainObject(value)) {
    return undefined
  }

  const id = asString(value["id"])
  const name = asString(value["name"])
  const creatorUserId = asString(value["creator_user_id"])
  if (!id || !name || !creatorUserId) {
    return undefined
  }

  return {
    id,
    name,
    avatar: asString(value["avatar"]) ?? "",
    creator_user_id: creatorUserId,
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

  return { user_id: userId, role }
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
    .map((service) => ({
      service,
      label: providerLabelByService.get(service) ?? service,
    }))
    .sort((left, right) => left.label.localeCompare(right.label))
}

function normalizeAppAccess(value: unknown): OrganizationAppAccess {
  return isPlainObject(value) ? (value as OrganizationAppAccess) : {}
}

function encodePath(value: string): string {
  return encodeURIComponent(value)
}

export class OrganizationsServiceImpl
  extends ConnectionService<OrganizationsService>
  implements IConnectionService<OrganizationsService>
{
  private readonly authManager: AuthManager

  public constructor(authManager: AuthManager) {
    super(OrganizationsServiceName)
    this.authManager = authManager
  }

  public isReady(): Promise<boolean> {
    return Promise.resolve(Boolean(this.authManager.activeAccount()))
  }

  public async getOrganizationOverview(): Promise<OrganizationOverview> {
    const account = this.requireAccount()
    const [created, joined] = await Promise.all([this.listCreatedOrganizations(), this.listMyOrganizations()])
    return {
      accountId: account.id,
      created,
      joined,
      updatedAt: new Date().toISOString(),
    }
  }

  public async createOrganization(req: CreateOrganizationRequest): Promise<Organization> {
    const orgName = req.orgName.trim()
    if (!orgName) {
      throw new Error("Organization name is required.")
    }

    const organization = normalizeOrganization(
      await this.requestApiJson("/v1/orgs", {
        method: "POST",
        body: JSON.stringify({
          org_name: orgName,
          ...(req.avatar?.trim() ? { avatar: req.avatar.trim() } : {}),
        }),
      }),
    )
    if (!organization) {
      throw new Error("Organization response is invalid.")
    }

    await this.emitOrganizationChanged()
    return organization
  }

  public async listCreatedOrganizations(): Promise<Organization[]> {
    const result = (await this.requestOrgControlJson("/v1/organizations")) as OrganizationsEnvelope
    return normalizeOrganizationList(result.organizations)
  }

  public async listMyOrganizations(): Promise<Organization[]> {
    const result = (await this.requestOrgControlJson("/v1/me/organizations")) as OrganizationsEnvelope
    return normalizeOrganizationList(result.organizations)
  }

  public async listOrganizationMembers(req: { orgId: string }): Promise<OrganizationMember[]> {
    const result = (await this.requestOrgControlJson(
      `/v1/organizations/${encodePath(req.orgId)}/members`,
    )) as OrganizationMembersEnvelope
    return normalizeOrganizationMembers(result.members)
  }

  public async listUserSummaries(req: OrganizationUsersRequest): Promise<Record<string, OrganizationUserSummary>> {
    const searchParams = new URLSearchParams()
    for (const userId of req.userIds) {
      const trimmed = userId.trim()
      if (trimmed) {
        searchParams.append("user_ids", trimmed)
      }
    }
    if (!searchParams.toString()) {
      return {}
    }

    return normalizeUserSummaryMap(await this.requestApiJson(`/v1/users/summaries?${searchParams.toString()}`))
  }

  public async searchUsers(req: OrganizationUserSearchRequest): Promise<OrganizationUserSearchResult[]> {
    const keyword = req.keyword.trim()
    if (!keyword) {
      return []
    }

    return normalizeUserSearchResults(
      await this.requestApiJson(`/v1/users?${new URLSearchParams({ keyword }).toString()}`),
    )
  }

  public async addOrganizationMember(req: OrganizationMemberRequest): Promise<void> {
    await this.requestOrgControlJson(`/v1/organizations/${encodePath(req.orgId)}/members`, {
      method: "POST",
      body: JSON.stringify({ user_id: req.userId.trim(), role: "member" }),
      noResult: true,
    })
    await this.emitOrganizationChanged()
  }

  public async removeOrganizationMember(req: OrganizationMemberRequest): Promise<void> {
    await this.requestOrgControlJson(`/v1/organizations/${encodePath(req.orgId)}/members/${encodePath(req.userId)}`, {
      method: "DELETE",
      noResult: true,
    })
    await this.emitOrganizationChanged()
  }

  public async getOrganizationAppAccess(req: { orgId: string }): Promise<OrganizationAppAccess> {
    return normalizeAppAccess(await this.requestOrgControlJson(`/v1/organizations/${encodePath(req.orgId)}/app-access`))
  }

  public async updateOrganizationAppAccess(req: UpdateOrganizationAppAccessRequest): Promise<OrganizationAppAccess> {
    const access = normalizeAppAccess(
      await this.requestOrgControlJson(`/v1/organizations/${encodePath(req.orgId)}/app-access`, {
        method: "PUT",
        body: JSON.stringify(req.access),
      }),
    )
    await this.emitOrganizationChanged()
    return access
  }

  public async listOrganizationProviderOptions(
    req: OrganizationProviderOptionsRequest,
  ): Promise<OrganizationProviderOption[]> {
    const organizationName = req.organizationName.trim()
    if (!organizationName) {
      return []
    }

    const [apps, providers] = await Promise.all([
      this.requestConnectorJson<RawConnectorApp[]>("/v1/apps", {
        headers: { "x-oo-organization-name": organizationName },
      }),
      this.requestConnectorJson<RawConnectorProvider[]>("/v1/providers"),
    ])
    return normalizeProviderOptions(Array.isArray(apps) ? apps : [], Array.isArray(providers) ? providers : [])
  }

  private requireAccount() {
    const account = this.authManager.activeAccount()
    if (!account) {
      throw new Error("Organizations not available (sign in first)")
    }
    return account
  }

  private requestApiJson(path: string, options: RequestOptions = {}): Promise<unknown> {
    return this.requestJson(apiBaseUrl, path, options)
  }

  private requestOrgControlJson(path: string, options: RequestOptions = {}): Promise<unknown> {
    return this.requestJson(orgControlBaseUrl, path, options)
  }

  private async requestConnectorJson<T>(path: string, options: RequestOptions = {}): Promise<T> {
    return normalizeConnectorEnvelope<T>(await this.requestJson(connectorBaseUrl, path, options))
  }

  private async requestJson(baseUrl: string, path: string, options: RequestOptions = {}): Promise<unknown> {
    const account = this.requireAccount()
    const headers: Record<string, string> = {
      Accept: "application/json, text/plain, */*",
      Authorization: `Bearer ${account.apiKey}`,
      ...options.headers,
    }

    if (options.body !== undefined && !headers["content-type"]) {
      headers["content-type"] = "application/json"
    }

    const response = await fetch(new URL(path, baseUrl), {
      ...options,
      headers,
      signal: options.signal ?? AbortSignal.timeout(20_000),
    })
    const payload = await readPayload(response)
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${readErrorMessage(payload) ?? response.statusText}`)
    }
    if (options.noResult || response.status === 204) {
      return undefined
    }
    return payload
  }

  private async emitOrganizationChanged(): Promise<void> {
    await this.send("organizationChanged", { updatedAt: new Date().toISOString() }).catch(() => undefined)
  }
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
