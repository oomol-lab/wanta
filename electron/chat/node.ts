import type { AgentManager } from "../agent/manager.ts"
import type {
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
  LocalArtifactGroup,
  LocalArtifactItem,
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
import { readdir, readFile, stat } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { translateOpencodeEvent } from "../agent/event-translator.ts"
import { consoleBaseUrl, consoleServerBaseUrl, insightBaseUrl, voiceAsrBaseUrl } from "../domain.ts"
import { ServiceEvent } from "../service-events.ts"
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

export class ChatServiceImpl extends ConnectionService<ChatService> implements IConnectionService<ChatService> {
  public readonly sessionActivity = new ServiceEvent<{ sessionId: string; usedAt: number }>()

  private agent: AgentManager | null
  private voiceAuthToken: string | undefined
  private billingUserId: string | undefined
  private readonly billingCache = new Map<string, BillingCacheEntry<BillingOverviewResult>>()
  private readonly billingInFlight = new Map<string, BillingInFlight<BillingOverviewResult>>()
  private bridged = false
  private userStoppedSessions = new Map<string, number>()
  private pendingArtifactDirs = new Map<string, string[]>()
  private activeAssistantMessages = new Map<string, string>()
  private activeToolParts = new Map<string, Set<string>>()
  private readonly deps: ChatServiceDeps
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
    this.pendingArtifactDirs.clear()
    this.activeAssistantMessages.clear()
    this.activeToolParts.clear()
    this.stoppedGenerations.clear()
    this.stoppedGenerationsLoaded = false
    this.stoppedGenerationsLoadPromise = null
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
          void emit(
            "messageError",
            createMessageErrorPayload(translated.data.sessionId, translated.data.message, messageId),
          )
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
    this.userStoppedSessions.delete(sessionId)
    return true
  }

  public async isReady(): Promise<boolean> {
    return this.agent?.isReady() ?? false
  }

  public async sendMessage(req: SendMessageRequest): Promise<void> {
    if (!this.agent) {
      throw new Error("Agent not configured (sign in first)")
    }
    this.emitSessionActivity(req.sessionId)
    const artifactDir = await this.agent.createArtifactDir(req.sessionId)
    this.enqueuePendingArtifactDir(req.sessionId, artifactDir)
    // promptStreaming 的结果经 SSE 推送；RPC 只确认主进程已接收本轮发送，避免首条消息 UI 等到流式内容已累积后才切换。
    void this.agent
      .promptStreaming(req.sessionId, req.text, { attachments: req.attachments, model: req.model, artifactDir })
      .catch((error: unknown) => {
        this.removePendingArtifactDir(req.sessionId, artifactDir)
        const messageId = this.activeAssistantMessages.get(req.sessionId)
        this.activeAssistantMessages.delete(req.sessionId)
        void this.send("messageError", createMessageErrorPayload(req.sessionId, errorMessage(error), messageId))
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

  public async resolveLocalArtifacts(req: ResolveLocalArtifactsRequest): Promise<ResolveLocalArtifactsResult> {
    const candidates = req.artifactRoot ? [req.artifactRoot] : extractLocalPathCandidates(req.text ?? "")
    const fromText = !req.artifactRoot
    const maxDirectoryItems = Math.max(1, Math.min(req.maxDirectoryItems ?? defaultMaxDirectoryItems, 200))
    const seen = new Set<string>()
    const groups: LocalArtifactGroup[] = []
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
      const group =
        item.kind === "directory" ? await directoryArtifacts(filePath, maxDirectoryItems) : await fileArtifact(filePath)
      if (group && (group.root || group.items.length > 0)) {
        groups.push(group)
      }
    }
    return { groups }
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
  }

  public async getMessages(sessionId: string): Promise<ChatMessage[]> {
    if (!this.agent) {
      return []
    }
    const messages = await this.agent.getMessages(sessionId)
    await this.ensureStoppedGenerationsLoaded()
    return applyStoppedGenerations(messages, this.stoppedGenerations.get(sessionId))
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
