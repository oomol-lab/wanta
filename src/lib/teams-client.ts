import type { ConnectionAppSummary } from "../../electron/connections/common.ts"
import type {
  CreateTeamRequest,
  EditableTeamMemberRole,
  Team,
  TeamAppAccess,
  TeamMember,
  TeamMemberRequest,
  TeamOverview,
  TeamUserSearchResult,
  TeamUserSummary,
  UpdateTeamMembersStatusRequest,
  UpdateTeamMemberRoleRequest,
  UpdateTeamRequest,
  UploadTeamAvatarResponse,
} from "../../electron/teams/common.ts"

import { normalizeApp } from "../../electron/connections/summary.ts"
import { getConnectionApps } from "@/lib/connections-client"
import { apiBaseUrl, teamControlBaseUrl } from "@/lib/domain"
import { oomolFetch } from "@/lib/oomol-http"
import { reportRendererHandledError } from "@/lib/renderer-diagnostics"
import { sortSystemCreatedTeamFirst } from "@/lib/team-overview"

// 团队面板/管理 UI 的全部网络读写在渲染层直接发起：原先这些是渲染业务驱动、却由主进程
// TeamsServiceImpl 代发的请求（且其鉴权本就是读会话 cookie）。凭证经 httpOnly 会话 cookie
// 自动附带（oomolFetch 内 credentials:"include"），token 不进渲染层（守 R4）；域名从 @/lib/domain 派生（守 R2）。

interface TeamsEnvelope {
  teams?: unknown
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
  const systemCreated = value["system_created"]
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
    ...(typeof systemCreated === "boolean" ? { system_created: systemCreated } : {}),
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

class TeamMembersValidationError extends Error {}

function responseValueType(value: unknown): string {
  if (value === undefined) return "missing"
  if (value === null) return "null"
  return Array.isArray(value) ? "array" : typeof value
}

function normalizeTeamMembers(value: unknown): TeamMember[] {
  if (!Array.isArray(value)) {
    throw new TeamMembersValidationError(
      `Team members response is invalid. Expected members array; received ${responseValueType(value)}.`,
    )
  }
  return value.map((value, index) => {
    const member = normalizeTeamMember(value)
    if (member) return member
    const reason = !isPlainObject(value)
      ? `expected object; received ${responseValueType(value)}`
      : !asString(value["user_id"])
        ? `user_id must be a non-empty string; received ${responseValueType(value["user_id"])}`
        : "role must be creator, admin, or member"
    throw new TeamMembersValidationError(
      `Team members response contains an invalid member. members[${index}]: ${reason}.`,
    )
  })
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
  return sortSystemCreatedTeamFirst(normalizeTeamList(result.teams, "Created teams"))
}

export async function listMyTeams(): Promise<Team[]> {
  const result = (await requestTeamControlJson("/v1/me/teams")) as TeamsEnvelope
  return sortSystemCreatedTeamFirst(normalizeTeamList(result.teams, "Joined teams"))
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
    await requestApiJson("/v1/teams", {
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
    await requestApiJson(`/v1/teams/${encodePath(teamId)}`, {
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
  const result = await requestApiJson(`/v1/teams/${encodePath(id)}/avatar`, {
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
  const path = `/v1/teams/${encodePath(id)}/members`
  const startedAt = Date.now()
  let status: number | undefined
  let requestId: string | undefined
  let stage: "request" | "response_body" | "validation" = "request"
  try {
    const result = await requestTeamControlJson(path, {
      onResponse: (response) => {
        status = response.status
        stage = "response_body"
        const value = response.headers.get("x-request-id") ?? response.headers.get("request-id")
        if (value && /^[a-zA-Z0-9._:-]{1,128}$/.test(value)) requestId = value
      },
    })
    stage = "validation"
    if (!isPlainObject(result)) {
      throw new TeamMembersValidationError(
        `Team members response is invalid. Expected JSON object; received ${responseValueType(result)}.`,
      )
    }
    return normalizeTeamMembers(result["members"])
  } catch (cause) {
    const interrupted = cause instanceof Error && (cause.name === "TimeoutError" || cause.name === "AbortError")
    const category = interrupted
      ? "timeout_or_cancelled"
      : cause instanceof TeamMembersValidationError
        ? "invalid_response"
        : status && (status < 200 || status >= 300)
          ? "http_error"
          : status
            ? "response_read_error"
            : "network_error"
    // Only generated explanations are shared; raw bodies and exception messages may contain credentials or personal data.
    const reason =
      cause instanceof TeamMembersValidationError
        ? cause.message
        : interrupted
          ? cause.name === "TimeoutError"
            ? `Request exceeded the ${teamRequestTimeoutMs} ms deadline.`
            : "Request was cancelled before completion."
          : category === "http_error"
            ? `Server returned HTTP ${status}. Use the request ID and timestamp to check server logs.`
            : category === "response_read_error"
              ? "Response headers arrived, but reading the response body failed."
              : "No HTTP response was available. The browser cannot distinguish DNS, TLS, proxy, CORS, or connection failures here."
    const error = Object.assign(
      new Error(
        [
          "Team members read failed",
          `reason=${reason}`,
          `stage=${stage}`,
          `GET ${teamControlBaseUrl}${path}`,
          `time=${new Date(startedAt).toISOString()}`,
          `status=${status ?? "unavailable"}; category=${category}; elapsedMs=${Date.now() - startedAt}`,
          `requestId=${requestId ?? "unavailable"}`,
          `platform=${globalThis.wanta?.platform ?? "unknown"}`,
          `version=${globalThis.wanta?.version ?? "unknown"}; commit=${globalThis.wanta?.appCommit ?? "unknown"}`,
        ].join("\n"),
      ),
      { status },
    )
    reportRendererHandledError("team-members", "Member list request failed", error.message)
    throw error
  }
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

export async function updateTeamMemberRole(req: UpdateTeamMemberRoleRequest): Promise<TeamMember> {
  const teamId = requireIdentifier(req.teamId, "Team id")
  const userId = requireIdentifier(req.userId, "User id")
  const role: EditableTeamMemberRole = req.role
  const member = normalizeTeamMember(
    await requestTeamControlJson(`/v1/teams/${encodePath(teamId)}/members/${encodePath(userId)}`, {
      method: "PUT",
      body: JSON.stringify({ role }),
    }),
  )
  if (!member) {
    throw new Error("Team member role response is invalid.")
  }
  return member
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

export async function listTeamConnectionApps(
  teamName: string,
  options: { forceRefresh?: boolean } = {},
): Promise<ConnectionAppSummary[]> {
  const normalized = teamName.trim()
  if (!normalized) return []
  const result = await getConnectionApps({ manageable: true, teamName: normalized }, options)
  return result.data
    .map(normalizeApp)
    .filter((app): app is ConnectionAppSummary => Boolean(app))
    .sort((left, right) => left.service.localeCompare(right.service) || left.id.localeCompare(right.id))
}
