import type { ChatEmit } from "../agent/event-translator.ts"
import type { AgentManager } from "../agent/manager.ts"
import type { ArtifactRootStore, ArtifactRoots } from "./artifact-roots.ts"
import type {
  AgentRuntimeStatus,
  AttachmentPreviewRequest,
  AttachmentPreviewResult,
  BillingLogItem,
  BillingOverviewRequest,
  BillingOverviewResult,
  BillingSummaryResult,
  BillingSpendStats,
  CreditItem,
  ChatMessage,
  ChatService,
  CreditUsages,
  CreditBalanceResult,
  ChatContextMention,
  LocalArtifactPreviewRequest,
  LocalArtifactPreviewResult,
  LocalArtifactDisplayMode,
  LocalArtifactEntry,
  LocalArtifactEntryRole,
  LocalArtifactGroup,
  LocalArtifactItem,
  LocalArtifactPack,
  LocalArtifactPackKind,
  MessageErrorEvent,
  OpenBillingPageRequest,
  OpenLocalPathRequest,
  OpenSubscriptionCheckoutRequest,
  OpenTopUpCheckoutRequest,
  ResolveLocalArtifactsRequest,
  ResolveLocalArtifactsResult,
  SubscriptionSchedule,
  SubscriptionStatus,
  SendMessageRequest,
  TranscribeVoiceRequest,
  TranscribeVoiceResult,
} from "./common.ts"
import type { StoppedGenerationStore, StoppedGenerations } from "./stopped-generations.ts"
import type { IConnectionService } from "@oomol/connection"

import { ConnectionService } from "@oomol/connection"
import { shell } from "electron"
import { open, readdir, readFile, stat } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { translateOpencodeEvent } from "../agent/event-translator.ts"
import { consoleBaseUrl, consoleServerBaseUrl, insightBaseUrl, voiceAsrBaseUrl } from "../domain.ts"
import { ServiceEvent } from "../service-events.ts"
import { applyArtifactRoots, recordArtifactRoot } from "./artifact-roots.ts"
import {
  extractLocalPathCandidates,
  imageMimeFromPath,
  isBroadLocalArtifactPath,
  mimeFromPath,
  normalizeLocalPathCandidate,
} from "./artifacts.ts"
import { ChatService as ChatServiceName } from "./common.ts"
import { normalizeChatError } from "./error.ts"
import { applyStoppedGenerations, recordStoppedGeneration } from "./stopped-generations.ts"

const attachmentPreviewMaxBytes = 16 * 1024 * 1024
const artifactTextPreviewMaxBytes = 512 * 1024
const artifactManifestFileName = ".lumo-artifact.json"
const userStopAbortWindowMs = 30_000
const defaultMaxDirectoryItems = 80
const billingPath = "/billing"
const dayMs = 24 * 60 * 60 * 1000
const billingRequestTimeoutMs = 12_000
const billingLogsMaxRangeDays = 30
const billingLogsMaxPagesPerRange = 100
const billingSummaryCacheMs = 30_000
const billingOverviewCacheMs = 60_000

function errorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message
  }
  return String(error)
}

function createErrorPartId(): string {
  return `agent-error-${Date.now()}-${crypto.randomUUID()}`
}

function createMessageErrorPayload(sessionId: string, message: string, messageId?: string): MessageErrorEvent {
  const normalized = normalizeChatError(message)
  return {
    sessionId,
    ...(messageId ? { messageId } : {}),
    partId: createErrorPartId(),
    message,
    errorKind: normalized.kind,
    ...(normalized.code ? { errorCode: normalized.code } : {}),
  }
}

function messageErrorSignature(message: string): string {
  return message.trim() || message
}

function quoted(value: string): string {
  return JSON.stringify(value)
}

export function buildContextMentionsSystem(mentions: ChatContextMention[] | undefined): string | undefined {
  if (!mentions || mentions.length === 0) {
    return undefined
  }
  const skills = mentions.filter(
    (mention): mention is Extract<ChatContextMention, { kind: "skill" }> => mention.kind === "skill",
  )
  const connections = mentions.filter(
    (mention): mention is Extract<ChatContextMention, { kind: "connection" }> => mention.kind === "connection",
  )
  const lines = [
    "User-selected context for this turn:",
    "- Treat these selections as explicit intent hints from the user, not as mandatory tool calls.",
    "- Use them only when they are relevant to the user's actual request.",
  ]
  if (skills.length > 0) {
    lines.push("Selected skills:")
    for (const skill of skills) {
      const detail = skill.description ? `; description: ${quoted(skill.description)}` : ""
      lines.push(`- ${quoted(skill.name)}; id: ${quoted(skill.id)}${detail}`)
    }
    lines.push(
      "If a selected skill is relevant, follow its instructions for this turn and mention that you used it only when useful to the user.",
    )
  }
  if (connections.length > 0) {
    lines.push("Selected connections:")
    for (const connection of connections) {
      const details = [
        `service: ${quoted(connection.service)}`,
        connection.appId ? `appId: ${quoted(connection.appId)}` : "",
        connection.accountLabel ? `account: ${quoted(connection.accountLabel)}` : "",
      ].filter(Boolean)
      lines.push(`- ${quoted(connection.displayName)}; ${details.join("; ")}`)
    }
    lines.push(
      "If, after reading the user's request, a Link action is needed, consider the selected connection first. Do not use it for unrelated local files, direct answers, concrete URLs, or general browsing. Still inspect the action schema before calling connector tools.",
    )
  }
  return lines.join("\n")
}

function formatCredits(value: unknown): string | null {
  const amount = typeof value === "string" || typeof value === "number" ? Number(value) : Number.NaN
  if (!Number.isFinite(amount)) {
    return null
  }
  return `$${new Intl.NumberFormat(undefined, { maximumFractionDigits: amount >= 100 ? 0 : 2 }).format(amount)}`
}

function sumCreditValues(values: unknown[]): number {
  return values.reduce<number>((sum, value) => {
    const amount = typeof value === "string" || typeof value === "number" ? Number(value) : Number.NaN
    return Number.isFinite(amount) ? sum + amount : sum
  }, 0)
}

function isGeneralCreditItem(item: unknown): boolean {
  if (!item || typeof item !== "object") {
    return true
  }
  const scope = "serviceScope" in item && typeof item.serviceScope === "string" ? item.serviceScope : ""
  const normalized = scope
    .trim()
    .toLowerCase()
    .replace(/[\s_-]+/g, "")
  if (!normalized) {
    return true
  }
  if (new Set(["all", "common", "default", "general", "global", "universal", "通用"]).has(normalized)) {
    return true
  }
  return !/auth|authorization|authorisation|link|cloud|授权|链接|云任务/.test(normalized)
}

function filterGeneralCreditUsages(usages: CreditUsages): CreditUsages {
  const items = usages.items.filter(isGeneralCreditItem)
  return {
    ...usages,
    items,
    total: {
      originalCredit: String(sumCreditValues(items.map((item) => item.originalCredit))),
      currentCredit: String(sumCreditValues(items.map((item) => item.currentCredit))),
    },
  }
}

function readCreditBalance(payload: unknown): CreditBalanceResult {
  const record = payload && typeof payload === "object" ? (payload as Record<string, unknown>) : {}
  const items = Array.isArray(record["items"]) ? record["items"].filter(isGeneralCreditItem) : []
  const total =
    record["total"] && typeof record["total"] === "object" ? (record["total"] as Record<string, unknown>) : {}
  const rawCurrent =
    items.length > 0
      ? sumCreditValues(
          items.map((item) =>
            item && typeof item === "object" ? (item as Record<string, unknown>)["currentCredit"] : undefined,
          ),
        )
      : total["currentCredit"]
  const amount = typeof rawCurrent === "number" ? rawCurrent : Number(rawCurrent)
  return {
    balance: formatCredits(rawCurrent),
    hasCredits: Number.isFinite(amount) && amount > 0,
  }
}

function readCreditUsages(payload: unknown): CreditUsages {
  const record = payload && typeof payload === "object" ? (payload as Record<string, unknown>) : {}
  const total =
    record["total"] && typeof record["total"] === "object" ? (record["total"] as Record<string, unknown>) : {}
  return {
    items: Array.isArray(record["items"])
      ? (record["items"].filter((item): item is CreditItem =>
          Boolean(item && typeof item === "object"),
        ) as CreditItem[])
      : [],
    ...(typeof record["nextToken"] === "string" ? { nextToken: record["nextToken"] } : {}),
    total: {
      originalCredit: String(total["originalCredit"] ?? "0"),
      currentCredit: String(total["currentCredit"] ?? "0"),
    },
    deficit: String(record["deficit"] ?? "0"),
  }
}

export function readBillingLogs(payload: unknown): BillingLogItem[] {
  const source = unwrapApiData<unknown>(payload)
  if (Array.isArray(source)) {
    return source.filter(isBillingLogItem)
  }
  if (!source || typeof source !== "object") {
    return []
  }
  const record = source as Record<string, unknown>
  const items = [record["items"], record["logs"], record["records"]].find(Array.isArray)
  return Array.isArray(items) ? items.filter(isBillingLogItem) : []
}

function isBillingLogItem(item: unknown): item is BillingLogItem {
  return Boolean(item && typeof item === "object")
}

function ensureHttpUrl(rawUrl: string): string {
  const url = new URL(rawUrl)
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("Only http and https URLs can be opened.")
  }
  return url.toString()
}

function billingUrl(target: OpenBillingPageRequest["target"]): string {
  const url = new URL(billingPath, consoleBaseUrl)
  if (target === "usage") {
    url.searchParams.set("tab", "usage")
  }
  return url.toString()
}

function authRequest(token: string): RequestInit {
  return {
    credentials: "include",
    headers: {
      Accept: "application/json",
      Authorization: `Bearer ${token}`,
      Cookie: `oomol-token=${token}`,
    },
  }
}

function checkoutReturnUrl(): string {
  const target = new URL(consoleBaseUrl)
  if (target.hostname.startsWith("console.")) {
    target.hostname = `chat.${target.hostname.slice("console.".length)}`
  }
  target.pathname = billingPath
  target.search = ""
  target.hash = ""
  return target.toString()
}

function statsRange(days: number): { endTime: number; startTime: number } {
  const normalizedDays = Number.isFinite(days) && days > 0 ? Math.floor(days) : 30
  const endTime = Date.now()
  return { endTime, startTime: endTime - normalizedDays * dayMs }
}

export interface BillingLogRange {
  endTime: number
  startTime: number
}

interface ChatServiceDeps {
  artifactRootStore?: ArtifactRootStore
  stoppedGenerationStore?: StoppedGenerationStore
}

interface BillingCacheEntry<T> {
  accountKey: string
  data: T
  fetchedAt: number
}

interface BillingInFlight<T> {
  accountKey: string
  promise: Promise<T>
}

export function billingLogRanges(days: number, endTime = Date.now()): BillingLogRange[] {
  const normalizedDays = Number.isFinite(days) && days > 0 ? Math.floor(days) : 30
  const ranges: BillingLogRange[] = []
  let remainingDays = normalizedDays
  let rangeEndTime = endTime
  while (remainingDays > 0) {
    const rangeDays = Math.min(remainingDays, billingLogsMaxRangeDays)
    const startTime = rangeEndTime - rangeDays * dayMs
    ranges.push({ endTime: rangeEndTime, startTime })
    rangeEndTime = startTime
    remainingDays -= rangeDays
  }
  return ranges
}

function unwrapConsoleData<T>(payload: unknown): T {
  if (payload && typeof payload === "object" && "success" in payload && "data" in payload) {
    const wrapped = payload as { data: T; message?: unknown; success: unknown }
    if (wrapped.success === false) {
      throw new Error(typeof wrapped.message === "string" ? wrapped.message : "Request failed.")
    }
    return wrapped.data
  }
  return payload as T
}

function unwrapApiData<T>(payload: unknown): T {
  if (payload && typeof payload === "object" && "data" in payload) {
    return (payload as { data: T }).data
  }
  return payload as T
}

function logSettledFailure(label: string, result: PromiseSettledResult<unknown>): void {
  if (result.status === "rejected") {
    console.warn("[lumo] billing overview request failed", { label, error: errorMessage(result.reason) })
  }
}

function createEmptyBillingOverviewResult(): BillingOverviewResult {
  return { balance: null, spend: null, metering: null, logs: [], subscription: null, schedules: [] }
}

export function isAbortErrorMessage(message: string): boolean {
  const normalized = message
    .trim()
    .replace(/[.!。]+$/, "")
    .toLowerCase()
  return (
    normalized === "aborted" ||
    normalized === "aborterror" ||
    normalized.startsWith("aborterror:") ||
    normalized === "abort error" ||
    normalized === "the operation was aborted" ||
    normalized === "this operation was aborted" ||
    normalized.includes("operation was aborted")
  )
}

function attachmentPreviewMime(req: AttachmentPreviewRequest): string | null {
  if (req.mime.toLowerCase().startsWith("image/")) {
    return req.mime
  }
  return imageMimeFromPath(req.path)
}

function isTextArtifactMime(mime: string): boolean {
  return (
    mime.startsWith("text/") ||
    mime === "application/json" ||
    mime === "application/javascript" ||
    mime === "application/x-javascript" ||
    mime === "application/xml" ||
    mime === "application/yaml" ||
    mime === "application/x-yaml"
  )
}

function isProbablyBinary(bytes: Buffer): boolean {
  return bytes.includes(0)
}

async function readTextPreview(filePath: string, size: number): Promise<{ text: string; truncated: boolean } | null> {
  const length = Math.min(size, artifactTextPreviewMaxBytes)
  if (length <= 0) {
    return { text: "", truncated: false }
  }
  const file = await open(filePath, "r")
  try {
    const bytes = Buffer.alloc(length)
    const { bytesRead } = await file.read(bytes, 0, length, 0)
    const chunk = bytes.subarray(0, bytesRead)
    if (isProbablyBinary(chunk)) {
      return null
    }
    return {
      text: chunk.toString("utf8"),
      truncated: size > bytesRead,
    }
  } finally {
    await file.close()
  }
}

export function createVoiceAsrRequestId(): string {
  return crypto.randomUUID()
}

export function buildVoiceAsrRequest(authToken: string, audioBase64: string, requestId: string): RequestInit {
  return {
    method: "POST",
    credentials: "include",
    headers: {
      Accept: "application/json",
      Authorization: `Bearer ${authToken}`,
      "Content-Type": "application/json",
      Cookie: `oomol-token=${authToken}`,
      "X-Api-Request-Id": requestId,
    },
    body: JSON.stringify({
      user: { uid: requestId },
      audio: { data: audioBase64 },
      request: {
        model_name: "bigmodel",
        enable_itn: true,
        enable_punc: true,
      },
    }),
  }
}

export function parseVoiceAsrTranscript(payload: VoiceAsrResponse | undefined): string {
  const transcript = payload?.result?.text?.trim() ?? ""
  if (!transcript) {
    throw new Error("No speech was recognized.")
  }
  return transcript
}

export function describeVoiceAsrFetchFailure(error: unknown): string {
  const message = errorMessage(error)
  const cause = error instanceof Error ? error.cause : undefined
  const causeCode =
    cause && typeof cause === "object" && "code" in cause && typeof cause.code === "string" ? cause.code : undefined
  const causeMessage =
    cause && typeof cause === "object" && "message" in cause && typeof cause.message === "string"
      ? cause.message
      : undefined
  const details = [causeCode, causeMessage].filter((item): item is string => Boolean(item)).join(": ")
  return details ? `${message} (${details})` : message
}

function localArtifactName(filePath: string): string {
  return path.basename(filePath.replace(/[\\/]+$/, "")) || filePath
}

async function localArtifactItem(filePath: string): Promise<LocalArtifactItem | null> {
  try {
    const info = await stat(filePath)
    const kind = info.isDirectory() ? "directory" : "file"
    return {
      path: filePath,
      name: localArtifactName(filePath),
      kind,
      mime: kind === "directory" ? "inode/directory" : mimeFromPath(filePath),
      ...(kind === "file" ? { size: info.size } : {}),
      modifiedAt: info.mtimeMs,
    }
  } catch {
    return null
  }
}

async function directoryArtifacts(dirPath: string, maxItems: number): Promise<LocalArtifactGroup | null> {
  const root = await localArtifactItem(dirPath)
  if (!root || root.kind !== "directory") {
    return null
  }
  let entries
  try {
    entries = await readdir(dirPath, { withFileTypes: true })
  } catch {
    return { root, items: [], totalItems: 0, truncated: false }
  }
  const sorted = entries
    .filter((entry) => !entry.name.startsWith("."))
    .sort((a, b) => {
      if (a.isDirectory() !== b.isDirectory()) {
        return a.isDirectory() ? -1 : 1
      }
      return a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" })
    })
  const selected = sorted.slice(0, maxItems)
  const items = (await Promise.all(selected.map((entry) => localArtifactItem(path.join(dirPath, entry.name))))).filter(
    (item): item is LocalArtifactItem => Boolean(item),
  )
  return {
    root,
    items,
    totalItems: sorted.length,
    truncated: sorted.length > selected.length,
  }
}

async function fileArtifact(filePath: string): Promise<LocalArtifactGroup | null> {
  const item = await localArtifactItem(filePath)
  if (!item || item.kind !== "file") {
    return null
  }
  return { items: [item], totalItems: 1, truncated: false }
}

const artifactPackKinds = new Set<LocalArtifactPackKind>([
  "image_set",
  "document",
  "spreadsheet",
  "presentation",
  "web_page",
  "code_project",
  "archive",
  "mixed",
])
const artifactDisplayModes = new Set<LocalArtifactDisplayMode>([
  "gallery",
  "document",
  "table",
  "project",
  "file_list",
  "single",
])
const artifactEntryRoles = new Set<LocalArtifactEntryRole>(["primary", "supporting", "summary", "metadata"])

interface ArtifactManifestItem {
  path?: unknown
  title?: unknown
  description?: unknown
  role?: unknown
  order?: unknown
}

interface ArtifactManifest {
  title?: unknown
  kind?: unknown
  display?: unknown
  summary?: unknown
  primary?: unknown
  items?: unknown
  supporting?: unknown
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined
}

function normalizeArtifactPackKind(value: unknown): LocalArtifactPackKind {
  return typeof value === "string" && artifactPackKinds.has(value as LocalArtifactPackKind)
    ? (value as LocalArtifactPackKind)
    : "mixed"
}

function normalizeArtifactDisplayMode(value: unknown): LocalArtifactDisplayMode {
  return typeof value === "string" && artifactDisplayModes.has(value as LocalArtifactDisplayMode)
    ? (value as LocalArtifactDisplayMode)
    : "file_list"
}

function normalizeArtifactEntryRole(value: unknown, fallback: LocalArtifactEntryRole): LocalArtifactEntryRole {
  return typeof value === "string" && artifactEntryRoles.has(value as LocalArtifactEntryRole)
    ? (value as LocalArtifactEntryRole)
    : fallback
}

function manifestItems(value: unknown): ArtifactManifestItem[] {
  if (!Array.isArray(value)) {
    return []
  }
  return value.filter((item): item is ArtifactManifestItem => Boolean(item && typeof item === "object"))
}

function primaryPathItems(value: unknown): ArtifactManifestItem[] {
  if (!Array.isArray(value)) {
    return []
  }
  return value
    .filter((item): item is string => typeof item === "string")
    .map((item, index) => ({ path: item, role: "primary", order: index + 1 }))
}

function resolveArtifactManifestPath(rootDir: string, value: unknown): string | null {
  const relativePath = optionalString(value)
  if (!relativePath || path.isAbsolute(relativePath) || relativePath.startsWith("~")) {
    return null
  }
  const root = path.resolve(rootDir)
  const resolved = path.resolve(root, relativePath)
  if (resolved !== root && !resolved.startsWith(`${root}${path.sep}`)) {
    return null
  }
  return resolved
}

async function artifactManifestEntry(
  rootDir: string,
  raw: ArtifactManifestItem,
  fallbackRole: LocalArtifactEntryRole,
  fallbackOrder: number,
  seen: Set<string>,
): Promise<LocalArtifactEntry | null> {
  const filePath = resolveArtifactManifestPath(rootDir, raw.path)
  if (!filePath || seen.has(filePath)) {
    return null
  }
  const item = await localArtifactItem(filePath)
  if (!item) {
    return null
  }
  seen.add(filePath)
  const order = typeof raw.order === "number" && Number.isFinite(raw.order) ? raw.order : fallbackOrder
  return {
    ...item,
    role: normalizeArtifactEntryRole(raw.role, fallbackRole),
    order,
    ...(optionalString(raw.title) ? { title: optionalString(raw.title) } : {}),
    ...(optionalString(raw.description) ? { description: optionalString(raw.description) } : {}),
  }
}

async function readArtifactPack(rootDir: string): Promise<LocalArtifactPack | null> {
  const root = await localArtifactItem(rootDir)
  if (!root || root.kind !== "directory") {
    return null
  }
  let manifest: ArtifactManifest
  try {
    manifest = JSON.parse(await readFile(path.join(rootDir, artifactManifestFileName), "utf-8")) as ArtifactManifest
  } catch {
    return null
  }
  if (!manifest || typeof manifest !== "object") {
    return null
  }
  const seen = new Set<string>()
  const primaryRawItems = manifestItems(manifest.items)
  const fallbackPrimaryItems = primaryRawItems.length > 0 ? [] : primaryPathItems(manifest.primary)
  const supportingRawItems = manifestItems(manifest.supporting)
  const resolvedItems = await Promise.all(
    [...primaryRawItems, ...fallbackPrimaryItems].map((item, index) =>
      artifactManifestEntry(rootDir, item, "primary", index + 1, seen),
    ),
  )
  const primaryItems = resolvedItems
    .filter((item): item is LocalArtifactEntry => Boolean(item))
    .filter((item) => item.role === "primary")
    .sort((a, b) => a.order - b.order || a.name.localeCompare(b.name, undefined, { numeric: true }))
  const secondaryFromItems = resolvedItems
    .filter((item): item is LocalArtifactEntry => Boolean(item))
    .filter((item) => item.role !== "primary")
  const resolvedSupporting = await Promise.all(
    supportingRawItems.map((item, index) => artifactManifestEntry(rootDir, item, "supporting", index + 1, seen)),
  )
  const supportingItems = [
    ...secondaryFromItems,
    ...resolvedSupporting.filter((item): item is LocalArtifactEntry => Boolean(item)),
  ].sort((a, b) => a.order - b.order || a.name.localeCompare(b.name, undefined, { numeric: true }))
  if (primaryItems.length === 0 && supportingItems.length === 0) {
    return null
  }
  return {
    root,
    title: optionalString(manifest.title) ?? root.name,
    kind: normalizeArtifactPackKind(manifest.kind),
    display: normalizeArtifactDisplayMode(manifest.display),
    ...(optionalString(manifest.summary) ? { summary: optionalString(manifest.summary) } : {}),
    items: primaryItems,
    supporting: supportingItems,
    totalItems: primaryItems.length,
    truncated: false,
  }
}

export class ChatServiceImpl extends ConnectionService<ChatService> implements IConnectionService<ChatService> {
  public readonly sessionActivity = new ServiceEvent<{ sessionId: string; usedAt: number }>()

  private agent: AgentManager | null
  private voiceAuthToken: string | undefined
  private billingUserId: string | undefined
  private readonly billingCache = new Map<string, BillingCacheEntry<BillingOverviewResult>>()
  private readonly billingInFlight = new Map<string, BillingInFlight<BillingOverviewResult>>()
  private bridged = false
  private userStoppedSessions = new Map<string, number>()
  private emittedMessageErrors = new Map<string, Set<string>>()
  private pendingArtifactDirs = new Map<string, string[]>()
  private activeAssistantMessages = new Map<string, string>()
  private activeToolParts = new Map<string, Set<string>>()
  private readonly deps: ChatServiceDeps
  private agentStatus: AgentRuntimeStatus = { status: "signed_out" }
  private artifactRoots: ArtifactRoots = new Map()
  private artifactRootsLoaded = false
  private artifactRootsLoadPromise: Promise<void> | null = null
  private stoppedGenerations: StoppedGenerations = new Map()
  private stoppedGenerationsLoaded = false
  private stoppedGenerationsLoadPromise: Promise<void> | null = null

  public constructor(agent: AgentManager | null = null, deps: ChatServiceDeps = {}) {
    super(ChatServiceName)
    this.agent = agent
    this.deps = deps
  }

  /** 登录 / 登出时由 main 重新装配 agent（旧 agent 的事件流随其 dispose 终止）。 */
  public setAgent(agent: AgentManager | null): void {
    this.agent = agent
    this.bridged = false
    this.userStoppedSessions.clear()
    this.emittedMessageErrors.clear()
    this.pendingArtifactDirs.clear()
    this.activeAssistantMessages.clear()
    this.activeToolParts.clear()
    this.artifactRoots.clear()
    this.artifactRootsLoaded = false
    this.artifactRootsLoadPromise = null
    this.stoppedGenerations.clear()
    this.stoppedGenerationsLoaded = false
    this.stoppedGenerationsLoadPromise = null
  }

  public setAgentStatus(status: AgentRuntimeStatus): void {
    this.agentStatus = status
    void this.send("agentStatusChanged", { status }).catch(() => undefined)
  }

  public hasActiveGeneration(): boolean {
    return this.activeAssistantMessages.size > 0 || this.pendingArtifactDirs.size > 0
  }

  /** 登录 / 登出时由 main 更新 Studio ASR 需要的 oomol-token。只在主进程内使用，renderer 不可见。 */
  public setVoiceAuthToken(token: string | undefined): void {
    if (this.voiceAuthToken !== token) {
      this.clearBillingCache()
    }
    this.voiceAuthToken = token
  }

  /** 登录 / 登出时由 main 更新额度中心所需上下文。凭证只留在主进程内。 */
  public setBillingAccountContext(context: { token?: string; userId?: string }): void {
    const previousAccountKey = this.billingAccountKey()
    this.voiceAuthToken = context.token
    this.billingUserId = context.userId
    if (this.billingAccountKey() !== previousAccountKey) {
      this.clearBillingCache()
    }
  }

  /** agent 就绪后调用：订阅 OpenCode SSE，转译为 ServerEvents 广播给渲染层。 */
  public startEventBridge(): void {
    if (!this.agent || this.bridged) {
      return
    }
    this.bridged = true
    const emit = this.send.bind(this) as (event: string, data: unknown) => Promise<void>
    this.agent.subscribe((event) => {
      for (const translated of translateOpencodeEvent(event)) {
        if (
          translated.event === "agentError" &&
          translated.data.sessionId &&
          this.consumeUserStopAbort(translated.data.sessionId, translated.data.message)
        ) {
          this.activeAssistantMessages.delete(translated.data.sessionId)
          this.activeToolParts.delete(translated.data.sessionId)
          this.emitSessionActivity(translated.data.sessionId)
          void emit("generationStopped", { sessionId: translated.data.sessionId })
          continue
        }
        if (this.shouldSuppressUserStoppedEvent(translated)) {
          continue
        }
        if (translated.event === "messageStarted") {
          this.emitSessionActivity(translated.data.sessionId)
        }
        if (translated.event === "messageStarted" && translated.data.role === "assistant") {
          this.activeAssistantMessages.set(translated.data.sessionId, translated.data.messageId)
          this.activeToolParts.set(translated.data.sessionId, new Set())
          const artifactRoot = this.consumePendingArtifactDir(translated.data.sessionId)
          if (artifactRoot) {
            void emit("messageArtifacts", {
              sessionId: translated.data.sessionId,
              messageId: translated.data.messageId,
              artifactRoot,
            })
            void this.rememberArtifactRoot(translated.data.sessionId, translated.data.messageId, artifactRoot).catch(
              (error: unknown) => {
                console.warn("[lumo] failed to record artifact root", error)
              },
            )
          }
        }
        if (translated.event === "toolCallStarted") {
          this.activeAssistantMessages.set(translated.data.sessionId, translated.data.messageId)
          const partIds = this.activeToolParts.get(translated.data.sessionId) ?? new Set<string>()
          partIds.add(translated.data.partId)
          this.activeToolParts.set(translated.data.sessionId, partIds)
        }
        if (translated.event === "toolCallResult") {
          const partIds = this.activeToolParts.get(translated.data.sessionId)
          partIds?.delete(translated.data.partId)
          if (partIds?.size === 0) {
            this.activeToolParts.delete(translated.data.sessionId)
          }
        }
        if (translated.event === "agentError" && translated.data.sessionId) {
          const messageId = this.activeAssistantMessages.get(translated.data.sessionId)
          this.activeAssistantMessages.delete(translated.data.sessionId)
          this.activeToolParts.delete(translated.data.sessionId)
          this.emitSessionActivity(translated.data.sessionId)
          this.emitMessageError(emit, translated.data.sessionId, translated.data.message, messageId)
          continue
        }
        void emit(translated.event, translated.data)
        if (translated.event === "messageCompleted") {
          this.activeAssistantMessages.delete(translated.data.sessionId)
          this.activeToolParts.delete(translated.data.sessionId)
          this.emitSessionActivity(translated.data.sessionId)
        }
      }
    })
  }

  private enqueuePendingArtifactDir(sessionId: string, artifactDir: string): void {
    const queue = this.pendingArtifactDirs.get(sessionId) ?? []
    queue.push(artifactDir)
    this.pendingArtifactDirs.set(sessionId, queue)
  }

  private consumePendingArtifactDir(sessionId: string): string | undefined {
    const queue = this.pendingArtifactDirs.get(sessionId)
    const artifactDir = queue?.shift()
    if (!queue || queue.length === 0) {
      this.pendingArtifactDirs.delete(sessionId)
    }
    return artifactDir
  }

  private removePendingArtifactDir(sessionId: string, artifactDir: string): void {
    const queue = this.pendingArtifactDirs.get(sessionId)
    if (!queue) {
      return
    }
    const next = queue.filter((item) => item !== artifactDir)
    if (next.length === 0) {
      this.pendingArtifactDirs.delete(sessionId)
      return
    }
    this.pendingArtifactDirs.set(sessionId, next)
  }

  private clearMessageErrorSignatures(sessionId: string): void {
    this.emittedMessageErrors.delete(sessionId)
  }

  private rememberMessageError(sessionId: string, message: string): boolean {
    const signature = messageErrorSignature(message)
    const sessionErrors = this.emittedMessageErrors.get(sessionId) ?? new Set<string>()
    if (sessionErrors.has(signature)) {
      return false
    }
    sessionErrors.add(signature)
    this.emittedMessageErrors.set(sessionId, sessionErrors)
    return true
  }

  private emitMessageError(
    emit: (event: string, data: unknown) => Promise<void>,
    sessionId: string,
    message: string,
    messageId?: string,
  ): void {
    if (!this.rememberMessageError(sessionId, message)) {
      return
    }
    void emit("messageError", createMessageErrorPayload(sessionId, message, messageId))
  }

  private markUserStopped(sessionId: string): void {
    const expiresAt = Date.now() + userStopAbortWindowMs
    this.userStoppedSessions.set(sessionId, expiresAt)
    const timer = setTimeout(() => {
      if (this.userStoppedSessions.get(sessionId) === expiresAt) {
        this.userStoppedSessions.delete(sessionId)
      }
    }, userStopAbortWindowMs)
    timer.unref?.()
  }

  private consumeUserStopAbort(sessionId: string, message: string): boolean {
    const expiresAt = this.userStoppedSessions.get(sessionId)
    if (!expiresAt) {
      return false
    }
    if (Date.now() > expiresAt) {
      this.userStoppedSessions.delete(sessionId)
      return false
    }
    if (!isAbortErrorMessage(message)) {
      return false
    }
    return true
  }

  private hasActiveUserStop(sessionId: string | undefined): boolean {
    if (!sessionId) {
      return false
    }
    const expiresAt = this.userStoppedSessions.get(sessionId)
    if (!expiresAt) {
      return false
    }
    if (Date.now() <= expiresAt) {
      return true
    }
    this.userStoppedSessions.delete(sessionId)
    return false
  }

  private shouldSuppressUserStoppedEvent(translated: ChatEmit): boolean {
    if (!this.hasActiveUserStop(translated.data.sessionId)) {
      return false
    }
    return translated.event !== "messageCompleted"
  }

  public async isReady(): Promise<boolean> {
    return this.agentStatus.status === "ready" && (this.agent?.isReady() ?? false)
  }

  public async getAgentStatus(): Promise<AgentRuntimeStatus> {
    return this.agentStatus
  }

  public async sendMessage(req: SendMessageRequest): Promise<void> {
    if (!this.agent) {
      throw new Error("Agent not configured (sign in first)")
    }
    this.userStoppedSessions.delete(req.sessionId)
    this.clearMessageErrorSignatures(req.sessionId)
    this.emitSessionActivity(req.sessionId)
    const artifactDir = await this.agent.createArtifactDir(req.sessionId)
    this.enqueuePendingArtifactDir(req.sessionId, artifactDir)
    // promptStreaming 的结果经 SSE 推送；RPC 只确认主进程已接收本轮发送，避免首条消息 UI 等到流式内容已累积后才切换。
    void this.agent
      .promptStreaming(req.sessionId, req.text, {
        attachments: req.attachments,
        artifactDir,
        model: req.model,
        system: buildContextMentionsSystem(req.contextMentions),
      })
      .catch((error: unknown) => {
        this.removePendingArtifactDir(req.sessionId, artifactDir)
        const messageId = this.activeAssistantMessages.get(req.sessionId)
        this.activeAssistantMessages.delete(req.sessionId)
        this.emitMessageError(
          this.send.bind(this) as (event: string, data: unknown) => Promise<void>,
          req.sessionId,
          errorMessage(error),
          messageId,
        )
      })
  }

  private emitSessionActivity(sessionId: string): void {
    this.sessionActivity.emit({ sessionId, usedAt: Date.now() })
  }

  private async ensureStoppedGenerationsLoaded(): Promise<void> {
    if (this.stoppedGenerationsLoaded) {
      return
    }
    if (this.stoppedGenerationsLoadPromise) {
      return this.stoppedGenerationsLoadPromise
    }
    this.stoppedGenerationsLoadPromise = (async () => {
      this.stoppedGenerations = (await this.deps.stoppedGenerationStore?.read()) ?? new Map()
      this.stoppedGenerationsLoaded = true
      this.stoppedGenerationsLoadPromise = null
    })()
    return this.stoppedGenerationsLoadPromise
  }

  private async ensureArtifactRootsLoaded(): Promise<void> {
    if (this.artifactRootsLoaded) {
      return
    }
    if (this.artifactRootsLoadPromise) {
      return this.artifactRootsLoadPromise
    }
    this.artifactRootsLoadPromise = (async () => {
      this.artifactRoots = (await this.deps.artifactRootStore?.read()) ?? new Map()
      this.artifactRootsLoaded = true
      this.artifactRootsLoadPromise = null
    })()
    return this.artifactRootsLoadPromise
  }

  private async rememberArtifactRoot(sessionId: string, messageId: string, artifactRoot: string): Promise<void> {
    await this.ensureArtifactRootsLoaded()
    if (!recordArtifactRoot(this.artifactRoots, sessionId, messageId, artifactRoot)) {
      return
    }
    await this.deps.artifactRootStore?.write(this.artifactRoots)
  }

  private async rememberStoppedGeneration(sessionId: string, messageId: string, partIds: string[]): Promise<void> {
    await this.ensureStoppedGenerationsLoaded()
    if (!recordStoppedGeneration(this.stoppedGenerations, sessionId, messageId, partIds)) {
      return
    }
    await this.deps.stoppedGenerationStore?.write(this.stoppedGenerations)
  }

  public async getAttachmentPreview(req: AttachmentPreviewRequest): Promise<AttachmentPreviewResult> {
    const mime = attachmentPreviewMime(req)
    if (!mime) {
      return { dataUrl: null }
    }
    try {
      const info = await stat(req.path)
      if (!info.isFile() || info.size > attachmentPreviewMaxBytes) {
        return { dataUrl: null }
      }
      const bytes = await readFile(req.path)
      return { dataUrl: `data:${mime};base64,${bytes.toString("base64")}` }
    } catch (error) {
      console.error("[lumo] getAttachmentPreview failed", { path: req.path, error: errorMessage(error) })
      return { dataUrl: null }
    }
  }

  public async getLocalArtifactPreview(req: LocalArtifactPreviewRequest): Promise<LocalArtifactPreviewResult> {
    const item = await localArtifactItem(req.path)
    if (!item || item.kind !== "file") {
      return { kind: "unsupported", mime: "application/octet-stream" }
    }

    const size = item.size ?? 0
    if (item.mime.toLowerCase().startsWith("image/")) {
      if (size > attachmentPreviewMaxBytes) {
        return { kind: "unsupported", mime: item.mime, size }
      }
      try {
        const bytes = await readFile(item.path)
        return {
          kind: "image",
          mime: item.mime,
          size,
          dataUrl: `data:${item.mime};base64,${bytes.toString("base64")}`,
        }
      } catch (error) {
        console.error("[lumo] getLocalArtifactPreview image failed", { path: req.path, error: errorMessage(error) })
        return { kind: "unsupported", mime: item.mime, size }
      }
    }

    if (item.mime.toLowerCase().startsWith("audio/") || item.mime.toLowerCase().startsWith("video/")) {
      if (size > attachmentPreviewMaxBytes) {
        return { kind: "unsupported", mime: item.mime, size }
      }
      try {
        const bytes = await readFile(item.path)
        return {
          kind: "media",
          mime: item.mime,
          size,
          dataUrl: `data:${item.mime};base64,${bytes.toString("base64")}`,
        }
      } catch (error) {
        console.error("[lumo] getLocalArtifactPreview media failed", { path: req.path, error: errorMessage(error) })
        return { kind: "unsupported", mime: item.mime, size }
      }
    }

    if (!isTextArtifactMime(item.mime)) {
      return { kind: "unsupported", mime: item.mime, size }
    }

    try {
      const preview = await readTextPreview(item.path, size)
      if (!preview) {
        return { kind: "unsupported", mime: item.mime, size }
      }
      return {
        kind: "text",
        mime: item.mime,
        size,
        text: preview.text,
        truncated: preview.truncated,
      }
    } catch (error) {
      console.error("[lumo] getLocalArtifactPreview text failed", { path: req.path, error: errorMessage(error) })
      return { kind: "unsupported", mime: item.mime, size }
    }
  }

  public async resolveLocalArtifacts(req: ResolveLocalArtifactsRequest): Promise<ResolveLocalArtifactsResult> {
    const candidates = req.artifactRoot ? [req.artifactRoot] : extractLocalPathCandidates(req.text ?? "")
    const fromText = !req.artifactRoot
    const maxDirectoryItems = Math.max(1, Math.min(req.maxDirectoryItems ?? defaultMaxDirectoryItems, 200))
    const seen = new Set<string>()
    const groups: LocalArtifactGroup[] = []
    let pack: LocalArtifactPack | undefined
    for (const candidate of candidates) {
      const filePath = normalizeLocalPathCandidate(candidate, os.homedir())
      if (!filePath || seen.has(filePath)) {
        continue
      }
      if (fromText && isBroadLocalArtifactPath(filePath, os.homedir())) {
        continue
      }
      seen.add(filePath)
      const item = await localArtifactItem(filePath)
      if (!item) {
        continue
      }
      if (!pack && item.kind === "directory") {
        pack = (await readArtifactPack(filePath)) ?? undefined
      }
      const group =
        item.kind === "directory" ? await directoryArtifacts(filePath, maxDirectoryItems) : await fileArtifact(filePath)
      if (group && (group.root || group.items.length > 0)) {
        groups.push(group)
      }
    }
    return { groups, ...(pack ? { pack } : {}) }
  }

  public async openLocalPath(req: OpenLocalPathRequest): Promise<void> {
    const item = await localArtifactItem(req.path)
    if (!item) {
      throw new Error("File does not exist.")
    }
    try {
      const result = await shell.openPath(item.path)
      if (result) {
        throw new Error(result)
      }
    } catch (error) {
      throw new Error(`Failed to open local path: ${errorMessage(error)}`)
    }
  }

  public async openBillingPage(req: OpenBillingPageRequest): Promise<void> {
    await shell.openExternal(ensureHttpUrl(billingUrl(req.target)))
  }

  public async openTopUpCheckout(req: OpenTopUpCheckoutRequest): Promise<void> {
    if (!this.voiceAuthToken) {
      await this.openBillingPage({ target: "recharge" })
      return
    }
    const url = new URL("/api/user/web_top_up_url", consoleServerBaseUrl)
    url.searchParams.set("price", req.price)
    url.searchParams.set("redirect", checkoutReturnUrl())
    const checkoutUrl = unwrapConsoleData<string>(await this.fetchConsoleJson(url))
    if (!checkoutUrl) {
      throw new Error("Top-up URL response is invalid.")
    }
    await shell.openExternal(ensureHttpUrl(checkoutUrl))
  }

  public async openSubscriptionCheckout(req: OpenSubscriptionCheckoutRequest): Promise<void> {
    if (!this.voiceAuthToken) {
      await this.openBillingPage({ target: "recharge" })
      return
    }
    const url = new URL("/api/user/subscriptions/page", consoleServerBaseUrl)
    url.searchParams.set("payment_type", "subscription")
    url.searchParams.set("redirect", checkoutReturnUrl())
    url.searchParams.set("source_page", checkoutReturnUrl())
    url.searchParams.set("client_platform", "chat-web")
    url.searchParams.set("plan", req.plan)
    if (this.billingUserId) {
      url.searchParams.set("user_id", this.billingUserId)
    }
    await shell.openExternal(ensureHttpUrl(url.toString()))
  }

  public async openSubscriptionPortal(): Promise<void> {
    if (!this.voiceAuthToken) {
      await this.openBillingPage({ target: "recharge" })
      return
    }
    const url = new URL("/api/stripe/portal", consoleServerBaseUrl)
    url.searchParams.set("product", "ai")
    const portalUrl = unwrapConsoleData<string>(await this.fetchConsoleJson(url))
    if (!portalUrl) {
      throw new Error("Subscription portal URL response is invalid.")
    }
    await shell.openExternal(ensureHttpUrl(portalUrl))
  }

  public async getBillingSummary(req: BillingOverviewRequest): Promise<BillingSummaryResult> {
    if (!this.voiceAuthToken) {
      return createEmptyBillingOverviewResult()
    }
    return this.getCachedBillingResult(`summary:${req.days}`, billingSummaryCacheMs, Boolean(req.forceRefresh), () =>
      this.fetchBillingSummary(req.days),
    )
  }

  public async getBillingOverview(req: BillingOverviewRequest): Promise<BillingOverviewResult> {
    if (!this.voiceAuthToken) {
      return createEmptyBillingOverviewResult()
    }
    return this.getCachedBillingResult(`overview:${req.days}`, billingOverviewCacheMs, Boolean(req.forceRefresh), () =>
      this.fetchBillingOverview(req.days),
    )
  }

  private async fetchBillingSummary(days: number): Promise<BillingSummaryResult> {
    const [balance, spend, metering] = await Promise.allSettled([
      this.getAllCreditUsages(),
      this.getCreditSpendStats(days),
      this.getCreditMeteringStats(days),
    ])
    logSettledFailure("balance", balance)
    logSettledFailure("spend", spend)
    logSettledFailure("metering", metering)
    const criticalResults = [balance, spend, metering]
    const allCriticalFailed = criticalResults.every((result) => result.status === "rejected")
    if (allCriticalFailed && balance.status === "rejected") {
      throw balance.reason
    }
    return {
      balance: balance.status === "fulfilled" ? filterGeneralCreditUsages(balance.value) : null,
      spend: spend.status === "fulfilled" ? spend.value : null,
      metering: metering.status === "fulfilled" ? metering.value : null,
      logs: [],
      subscription: null,
      schedules: [],
    }
  }

  private async fetchBillingOverview(days: number): Promise<BillingOverviewResult> {
    const [balance, spend, metering, logs, subscription, schedules] = await Promise.allSettled([
      this.getAllCreditUsages(),
      this.getCreditSpendStats(days),
      this.getCreditMeteringStats(days),
      this.getBillingLogs(days),
      this.getSubscriptionStatus(),
      this.getSubscriptionSchedules(),
    ])
    logSettledFailure("balance", balance)
    logSettledFailure("spend", spend)
    logSettledFailure("metering", metering)
    logSettledFailure("logs", logs)
    logSettledFailure("subscription", subscription)
    logSettledFailure("schedules", schedules)
    const criticalResults = [balance, spend, metering]
    const allCriticalFailed = criticalResults.every((result) => result.status === "rejected")
    if (allCriticalFailed && balance.status === "rejected") {
      throw balance.reason
    }
    return {
      balance: balance.status === "fulfilled" ? filterGeneralCreditUsages(balance.value) : null,
      spend: spend.status === "fulfilled" ? spend.value : null,
      metering: metering.status === "fulfilled" ? metering.value : null,
      logs: logs.status === "fulfilled" ? logs.value : [],
      subscription: subscription.status === "fulfilled" ? subscription.value : null,
      schedules: schedules.status === "fulfilled" ? schedules.value : [],
    }
  }

  private async getCachedBillingResult(
    key: string,
    ttlMs: number,
    forceRefresh: boolean,
    load: () => Promise<BillingOverviewResult>,
  ): Promise<BillingOverviewResult> {
    const accountKey = this.billingAccountKey()
    if (!accountKey) {
      return createEmptyBillingOverviewResult()
    }

    const cached = this.billingCache.get(key)
    const now = Date.now()
    if (!forceRefresh && cached?.accountKey === accountKey && now - cached.fetchedAt < ttlMs) {
      return cached.data
    }

    const inFlight = this.billingInFlight.get(key)
    if (!forceRefresh && inFlight?.accountKey === accountKey) {
      return inFlight.promise
    }

    const request = load()
      .then((data) => {
        if (this.billingAccountKey() === accountKey) {
          this.billingCache.set(key, { accountKey, data, fetchedAt: Date.now() })
        }
        return data
      })
      .catch((error: unknown) => {
        if (cached?.accountKey === accountKey) {
          console.warn("[lumo] using stale billing cache after refresh failed", { key, error: errorMessage(error) })
          return cached.data
        }
        throw error
      })
      .finally(() => {
        if (this.billingInFlight.get(key)?.promise === request) {
          this.billingInFlight.delete(key)
        }
      })

    this.billingInFlight.set(key, { accountKey, promise: request })
    return request
  }

  private billingAccountKey(): string | undefined {
    return this.billingUserId ?? this.voiceAuthToken
  }

  private clearBillingCache(): void {
    this.billingCache.clear()
    this.billingInFlight.clear()
  }

  public async getCreditBalance(): Promise<CreditBalanceResult> {
    if (!this.voiceAuthToken) {
      return { balance: null, hasCredits: false }
    }
    const response = await fetch(new URL("/v1/balance/available", insightBaseUrl), authRequest(this.voiceAuthToken))
    const text = await response.text()
    if (!response.ok) {
      throw new Error(`Failed to get credit balance: ${response.status}`)
    }
    let payload: unknown
    try {
      payload = JSON.parse(text)
    } catch {
      payload = undefined
    }
    return readCreditBalance(payload)
  }

  private async fetchConsoleJson(url: URL): Promise<unknown> {
    if (!this.voiceAuthToken) {
      throw new Error("Sign in is required.")
    }
    const response = await fetch(url, {
      ...authRequest(this.voiceAuthToken),
      signal: AbortSignal.timeout(billingRequestTimeoutMs),
    })
    const text = await response.text()
    if (!response.ok) {
      throw new Error(text || `Request failed with status ${response.status}`)
    }
    return text ? (JSON.parse(text) as unknown) : undefined
  }

  private async fetchInsightJson(url: URL): Promise<unknown> {
    if (!this.voiceAuthToken) {
      throw new Error("Sign in is required.")
    }
    const response = await fetch(url, {
      ...authRequest(this.voiceAuthToken),
      signal: AbortSignal.timeout(billingRequestTimeoutMs),
    })
    const text = await response.text()
    if (!response.ok) {
      throw new Error(text || `Request failed with status ${response.status}`)
    }
    return text ? (JSON.parse(text) as unknown) : undefined
  }

  private async getAllCreditUsages(): Promise<CreditUsages> {
    const firstPage = await this.getCreditUsages()
    const items = [...firstPage.items]
    let nextToken = firstPage.nextToken
    while (nextToken) {
      const nextPage = await this.getCreditUsages(nextToken)
      items.push(...nextPage.items)
      nextToken = nextPage.nextToken
    }
    return { ...firstPage, items, nextToken: undefined }
  }

  private async getCreditUsages(nextToken?: string): Promise<CreditUsages> {
    const url = new URL("/v1/balance/available", insightBaseUrl)
    if (nextToken) {
      url.searchParams.set("nextToken", nextToken)
    }
    return readCreditUsages(unwrapApiData<unknown>(await this.fetchInsightJson(url)))
  }

  private async getCreditSpendStats(days: number): Promise<BillingSpendStats> {
    const { endTime, startTime } = statsRange(days)
    const url = new URL("/v1/stats/billing", insightBaseUrl)
    url.searchParams.set("granularity", "daily")
    url.searchParams.set("startTime", String(startTime))
    url.searchParams.set("endTime", String(endTime))
    return unwrapApiData<BillingSpendStats>(await this.fetchInsightJson(url))
  }

  private async getCreditMeteringStats(days: number): Promise<BillingSpendStats> {
    const { endTime, startTime } = statsRange(days)
    const url = new URL("/v1/stats/metering", insightBaseUrl)
    url.searchParams.set("granularity", "daily")
    url.searchParams.set("startTime", String(startTime))
    url.searchParams.set("endTime", String(endTime))
    return unwrapApiData<BillingSpendStats>(await this.fetchInsightJson(url))
  }

  private async getBillingLogs(days: number): Promise<BillingLogItem[]> {
    const ranges = billingLogRanges(days)
    const pages = await Promise.all(ranges.map((range) => this.getAllBillingLogsInRange(range)))
    return pages.flat().sort((left, right) => Number(right.createdAt) - Number(left.createdAt))
  }

  private async getAllBillingLogsInRange(range: BillingLogRange): Promise<BillingLogItem[]> {
    const items: BillingLogItem[] = []
    for (let page = 1; page <= billingLogsMaxPagesPerRange; page += 1) {
      const pageItems = await this.getBillingLogsPage(range, page)
      if (pageItems.length === 0) {
        break
      }
      items.push(...pageItems)
    }
    return items
  }

  private async getBillingLogsPage({ endTime, startTime }: BillingLogRange, page: number): Promise<BillingLogItem[]> {
    const url = new URL("/v1/logs/billing", insightBaseUrl)
    url.searchParams.set("from", String(startTime))
    url.searchParams.set("to", String(endTime))
    url.searchParams.set("page", String(page))
    return readBillingLogs(await this.fetchInsightJson(url))
  }

  private async getSubscriptionStatus(): Promise<SubscriptionStatus> {
    const url = new URL("/api/user/subscriptions", consoleServerBaseUrl)
    return unwrapConsoleData<SubscriptionStatus>(await this.fetchConsoleJson(url))
  }

  private async getSubscriptionSchedules(): Promise<SubscriptionSchedule[]> {
    const url = new URL("/api/user/subscriptions/schedulers", consoleServerBaseUrl)
    return unwrapConsoleData<SubscriptionSchedule[]>(await this.fetchConsoleJson(url))
  }

  public async transcribeVoice(req: TranscribeVoiceRequest): Promise<TranscribeVoiceResult> {
    if (!this.voiceAuthToken) {
      throw new Error("Voice transcription requires a fresh sign-in. Please sign out and sign in again.")
    }
    const requestId = createVoiceAsrRequestId()
    let response: Response
    try {
      response = await fetch(voiceAsrBaseUrl, {
        ...buildVoiceAsrRequest(this.voiceAuthToken, req.audioBase64, requestId),
        signal: AbortSignal.timeout(60_000),
      })
    } catch (error) {
      const message = describeVoiceAsrFetchFailure(error)
      console.error("[lumo] voice transcription fetch failed", { endpoint: voiceAsrBaseUrl, requestId, error: message })
      throw new Error(`Voice transcription request failed: ${message}`)
    }
    const text = await response.text()
    let payload: VoiceAsrResponse | undefined
    if (text) {
      try {
        payload = JSON.parse(text) as VoiceAsrResponse
      } catch {
        payload = undefined
      }
    }
    if (!response.ok) {
      throw new Error(`Voice transcription failed with status ${response.status}: ${text || response.statusText}`)
    }
    return { text: parseVoiceAsrTranscript(payload) }
  }

  public async stopGeneration(sessionId: string): Promise<void> {
    if (!this.agent) {
      return
    }
    this.markUserStopped(sessionId)
    const messageId = this.activeAssistantMessages.get(sessionId)
    const partIds = [...(this.activeToolParts.get(sessionId) ?? [])]
    try {
      await this.agent.abort(sessionId)
    } catch (error) {
      this.userStoppedSessions.delete(sessionId)
      throw error
    }
    if (messageId) {
      await this.rememberStoppedGeneration(sessionId, messageId, partIds).catch((error: unknown) => {
        console.warn("[lumo] failed to record stopped generation", error)
      })
    }
    this.activeAssistantMessages.delete(sessionId)
    this.activeToolParts.delete(sessionId)
    await this.send("generationStopped", { sessionId }).catch(() => undefined)
  }

  public async getMessages(sessionId: string): Promise<ChatMessage[]> {
    if (!this.agent) {
      return []
    }
    const messages = await this.agent.getMessages(sessionId)
    await this.ensureArtifactRootsLoaded()
    await this.ensureStoppedGenerationsLoaded()
    return applyStoppedGenerations(
      applyArtifactRoots(messages, this.artifactRoots.get(sessionId)),
      this.stoppedGenerations.get(sessionId),
    )
  }
}

export interface VoiceAsrResponse {
  audio_info?: {
    duration?: number
  }
  result?: {
    text?: string
    utterances?: unknown[]
  }
}
