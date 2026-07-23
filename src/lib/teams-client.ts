import type {
  CreateTeamRequest,
  Team,
  TeamAppAccess,
  TeamMember,
  TeamMemberRequest,
  TeamOverview,
  TeamProviderOption,
  TeamUserSearchResult,
  TeamUserSummary,
  UpdateTeamMembersStatusRequest,
  UpdateTeamRequest,
  UploadTeamAvatarResponse,
} from "../../electron/teams/common.ts"

import { getConnectionApps, getConnectionProviders } from "@/lib/connections-client"
import { apiBaseUrl, teamControlBaseUrl } from "@/lib/domain"
import { oomolFetch } from "@/lib/oomol-http"

// 团队面板/管理 UI 的全部网络读写在渲染层直接发起：原先这些是渲染业务驱动、却由主进程
// TeamsServiceImpl 代发的请求（且其鉴权本就是读会话 cookie）。凭证经 httpOnly 会话 cookie
// 自动附带（oomolFetch 内 credentials:"include"），token 不进渲染层（守 R4）；域名从 @/lib/domain 派生（守 R2）。

interface TeamsEnvelope {
  teams?: unknown
}

interface TeamMembersEnvelope {
  members?: unknown
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
  onResponse?: (response: Response) => void
}

const teamRequestTimeoutMs = 20_000
const userSummaryBatchSize = 100
const userSummaryBatchConcurrency = 4
const teamMemberLimitPatterns = [
  "organization member limit exceeded",
  "team member limit exceeded",
  "member limit exceeded",
  "seat limit exceeded",
  "member quota exceeded",
]

export class TeamRequestError extends Error {
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
    this.name = "TeamRequestError"
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

function normalizeTeam(value: unknown): Team | undefined {
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
    ...(role === "creator" || role === "admin" || role === "member" ? { role } : {}),
    ...(typeof writable === "boolean" ? { writable } : {}),
  }
}

function normalizeTeamList(value: unknown, label: string): Team[] {
  if (!Array.isArray(value)) {
    throw new Error(`${label} response is invalid.`)
  }
  const teams = value.map(normalizeTeam)
  if (teams.some((team) => !team)) {
    throw new Error(`${label} response contains an invalid team.`)
  }
  return teams as Team[]
}

function normalizeTeamMember(value: unknown): TeamMember | undefined {
  if (!isPlainObject(value)) {
    return undefined
  }
  const userId = asString(value["user_id"])
  const role = value["role"]
  if (!userId || (role !== "creator" && role !== "admin" && role !== "member")) {
    return undefined
  }
  return {
    user_id: userId,
    role,
    ...(typeof value["disable"] === "boolean" ? { disable: value["disable"] } : {}),
  }
}

function normalizeTeamMembers(value: unknown): TeamMember[] {
  if (!Array.isArray(value)) {
    throw new Error("Team members response is invalid.")
  }
  const members = value.map(normalizeTeamMember)
  if (members.some((member) => !member)) {
    throw new Error("Team members response contains an invalid member.")
  }
  return members as TeamMember[]
}

function normalizeUserSummaryMap(value: unknown): Record<string, TeamUserSummary> {
  if (!isPlainObject(value)) {
    return {}
  }
  const result: Record<string, TeamUserSummary> = {}
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

function normalizeUserSearchResult(value: unknown): TeamUserSearchResult | undefined {
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

function normalizeUserSearchResults(value: unknown): TeamUserSearchResult[] {
  if (!Array.isArray(value)) {
    return []
  }
  return value.map(normalizeUserSearchResult).filter((item): item is TeamUserSearchResult => Boolean(item))
}

function normalizeProviderOptions(apps: RawConnectorApp[], providers: RawConnectorProvider[]): TeamProviderOption[] {
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

function normalizeAppAccess(value: unknown): TeamAppAccess {
  if (!isPlainObject(value) || Object.values(value).some((services) => !isPlainObject(services))) {
    throw new Error("Team app access response is invalid.")
  }
  return value as TeamAppAccess
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

export function isTeamMemberLimitError(error: unknown): boolean {
  const message =
    error instanceof TeamRequestError
      ? `${error.apiMessage ?? ""}\n${error.code ?? ""}\n${error.message}`
      : error instanceof Error
        ? error.message
        : String(error)
  const normalized = message.toLowerCase()
  return teamMemberLimitPatterns.some((pattern) => normalized.includes(pattern))
}

async function requestJson(baseUrl: string, path: string, options: RequestOptions = {}): Promise<unknown> {
  const { headers: optionHeaders, noResult, onResponse, ...init } = options
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
    timeoutMs: teamRequestTimeoutMs,
  })
  onResponse?.(response)
  const payload = await readPayload(response)
  if (!response.ok) {
    throw new TeamRequestError({
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

function requestTeamControlJson(path: string, options: RequestOptions = {}): Promise<unknown> {
  return requestJson(teamControlBaseUrl, path, options)
}

export async function listCreatedTeams(): Promise<Team[]> {
  const result = (await requestTeamControlJson("/v1/teams")) as TeamsEnvelope
  return normalizeTeamList(result.teams, "Created teams")
}

export async function listMyTeams(): Promise<Team[]> {
  const result = (await requestTeamControlJson("/v1/me/teams")) as TeamsEnvelope
  return normalizeTeamList(result.teams, "Joined teams")
}

export async function getTeamOverview(accountId: string): Promise<TeamOverview> {
  const [created, joined] = await Promise.all([listCreatedTeams(), listMyTeams()])
  return { accountId, created, joined, updatedAt: new Date().toISOString() }
}

export async function createTeam(req: CreateTeamRequest): Promise<Team> {
  const teamName = req.teamName.trim()
  if (!teamName) {
    throw new Error("Team name is required.")
  }
  const team = normalizeTeam(
    await requestApiJson("/v1/orgs", {
      method: "POST",
      body: JSON.stringify({ org_name: teamName, ...(req.avatar?.trim() ? { avatar: req.avatar.trim() } : {}) }),
    }),
  )
  if (!team) {
    throw new Error("Team response is invalid.")
  }
  return team
}

export async function updateTeam(req: UpdateTeamRequest): Promise<Team> {
  const teamId = requireIdentifier(req.teamId, "Team id")
  const teamName = req.teamName.trim()
  if (!teamName) {
    throw new Error("Team name is required.")
  }
  const team = normalizeTeam(
    await requestApiJson(`/v1/orgs/${encodePath(teamId)}`, {
      method: "PUT",
      body: JSON.stringify({ org_name: teamName, avatar: req.avatar.trim() }),
    }),
  )
  if (!team) {
    throw new Error("Team response is invalid.")
  }
  return team
}

export async function uploadTeamAvatar(teamId: string, file: File): Promise<UploadTeamAvatarResponse> {
  const id = requireIdentifier(teamId, "Team id")
  const form = new FormData()
  form.set("file", file)
  const result = await requestApiJson(`/v1/orgs/${encodePath(id)}/avatar`, {
    method: "POST",
    body: form,
  })
  const avatar = isPlainObject(result) ? asString(result["avatar"]) : undefined
  const uploadedAvatar = avatar?.trim()
  if (!uploadedAvatar) {
    throw new Error("Team avatar response is invalid.")
  }
  return { avatar: uploadedAvatar }
}

export async function listTeamMembers(teamId: string): Promise<TeamMember[]> {
  const id = requireIdentifier(teamId, "Team id")
  const result = (await requestTeamControlJson(`/v1/teams/${encodePath(id)}/members`)) as TeamMembersEnvelope
  return normalizeTeamMembers(result.members)
}

export async function listUserSummaries(userIds: string[]): Promise<Record<string, TeamUserSummary>> {
  const normalizedIds = Array.from(new Set(userIds.map((userId) => userId.trim()).filter(Boolean))).sort()
  if (normalizedIds.length === 0) {
    return {}
  }

  const batches: string[][] = []
  for (let index = 0; index < normalizedIds.length; index += userSummaryBatchSize) {
    batches.push(normalizedIds.slice(index, index + userSummaryBatchSize))
  }

  const summaries: Record<string, TeamUserSummary> = {}
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
): Promise<TeamUserSearchResult[]> {
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

export async function addTeamMember(req: TeamMemberRequest): Promise<void> {
  const teamId = requireIdentifier(req.teamId, "Team id")
  const userId = requireIdentifier(req.userId, "User id")
  await requestTeamControlJson(`/v1/teams/${encodePath(teamId)}/members`, {
    method: "POST",
    body: JSON.stringify({ user_id: userId, role: "member" }),
    noResult: true,
  })
}

export async function removeTeamMember(req: TeamMemberRequest): Promise<void> {
  const teamId = requireIdentifier(req.teamId, "Team id")
  const userId = requireIdentifier(req.userId, "User id")
  await requestTeamControlJson(`/v1/teams/${encodePath(teamId)}/members/${encodePath(userId)}`, {
    method: "DELETE",
    noResult: true,
  })
}

function normalizedMemberStatusUserIds(userIds: string[]): string[] {
  return Array.from(new Set(userIds.map((userId) => userId.trim()).filter(Boolean)))
}

async function updateTeamMembersStatus(req: UpdateTeamMembersStatusRequest, path: "disable" | "enable"): Promise<void> {
  const teamId = requireIdentifier(req.teamId, "Team id")
  const userIds = normalizedMemberStatusUserIds(req.userIds)
  if (userIds.length === 0) {
    throw new Error("Member user ids are required.")
  }
  await requestTeamControlJson(`/v1/teams/${encodePath(teamId)}/members/${path}`, {
    method: "PUT",
    body: JSON.stringify({ user_ids: userIds }),
    noResult: true,
  })
}

export function enableTeamMembers(req: UpdateTeamMembersStatusRequest): Promise<void> {
  return updateTeamMembersStatus(req, "enable")
}

export function disableTeamMembers(req: UpdateTeamMembersStatusRequest): Promise<void> {
  return updateTeamMembersStatus(req, "disable")
}

export async function getTeamAppAccess(teamId: string): Promise<TeamAppAccess> {
  return (await getTeamAppAccessSnapshot(teamId)).access
}

export interface TeamAppAccessSnapshot {
  access: TeamAppAccess
  etag?: string
}

export async function getTeamAppAccessSnapshot(teamId: string): Promise<TeamAppAccessSnapshot> {
  const id = requireIdentifier(teamId, "Team id")
  let etag: string | undefined
  const access = normalizeAppAccess(
    await requestTeamControlJson(`/v1/teams/${encodePath(id)}/app-access`, {
      onResponse: (response) => {
        etag = response.headers.get("etag") ?? undefined
      },
    }),
  )
  return { access, ...(etag ? { etag } : {}) }
}

export async function updateTeamAppAccess(
  teamId: string,
  access: TeamAppAccess,
  options: { etag?: string } = {},
): Promise<TeamAppAccess> {
  const id = requireIdentifier(teamId, "Team id")
  const updated = normalizeAppAccess(
    await requestTeamControlJson(`/v1/teams/${encodePath(id)}/app-access`, {
      method: "PUT",
      body: JSON.stringify(access),
      ...(options.etag ? { headers: { "if-match": options.etag } } : {}),
    }),
  )
  return updated
}

export async function listTeamProviderOptions(teamName: string): Promise<TeamProviderOption[]> {
  const normalized = teamName.trim()
  if (!normalized) {
    return []
  }
  const [apps, providers] = await Promise.all([getConnectionApps({ teamName: normalized }), getConnectionProviders()])
  return normalizeProviderOptions(
    Array.isArray(apps.data) ? apps.data : [],
    Array.isArray(providers.data) ? providers.data : [],
  )
}
