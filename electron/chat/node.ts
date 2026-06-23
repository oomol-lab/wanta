import type { ChatEmit } from "../agent/event-translator.ts"
import type { AgentManager } from "../agent/manager.ts"
import type { ArtifactRootStore, ArtifactRoots } from "./artifact-roots.ts"
import type {
  AgentRuntimeStatus,
  AttachmentPreviewRequest,
  AttachmentPreviewResult,
  ChatMessage,
  ChatService,
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
  OpenExternalUrlRequest,
  OpenLocalPathRequest,
  ResolveLocalArtifactsRequest,
  ResolveLocalArtifactsResult,
  SendMessageRequest,
  SetAgentOrganizationRequest,
} from "./common.ts"
import type { StoppedGenerationStore, StoppedGenerations } from "./stopped-generations.ts"
import type { IConnectionService } from "@oomol/connection"

import { ConnectionService } from "@oomol/connection"
import { shell } from "electron"
import { open, readdir, readFile, realpath, stat } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { translateOpencodeEvent } from "../agent/event-translator.ts"
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
const artifactManifestFileName = ".wanta-artifact.json"
const userStopAbortWindowMs = 30_000
const defaultMaxDirectoryItems = 80

function errorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message
  }
  return String(error)
}

/** 仅放行 http/https 的外开 URL，避免渲染层诱导主进程打开 file:// 或自定义协议。 */
function ensureExternalHttpUrl(rawUrl: string): string {
  const url = new URL(rawUrl)
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("Only http and https URLs can be opened.")
  }
  return url.toString()
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

interface ChatServiceDeps {
  artifactRootStore?: ArtifactRootStore
  stoppedGenerationStore?: StoppedGenerationStore
  /** 渲染层切换组织 workspace 时，同步 agent 的组织作用域（main 持有 agent 与 activeAgentOrganizationName）。 */
  onSetAgentOrganization?: (organizationName: string | undefined) => void
}

interface SessionGeneration {
  controller: AbortController
  id: string
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

async function resolveArtifactManifestPath(rootDir: string, value: unknown): Promise<string | null> {
  const relativePath = optionalString(value)
  if (!relativePath || path.isAbsolute(relativePath) || relativePath.startsWith("~")) {
    return null
  }
  const root = path.resolve(rootDir)
  const resolved = path.resolve(root, relativePath)
  if (resolved !== root && !resolved.startsWith(`${root}${path.sep}`)) {
    return null
  }
  try {
    const [realRoot, realResolved] = await Promise.all([realpath(root), realpath(resolved)])
    if (realResolved !== realRoot && !realResolved.startsWith(`${realRoot}${path.sep}`)) {
      return null
    }
  } catch {
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
  const filePath = await resolveArtifactManifestPath(rootDir, raw.path)
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

function artifactPackVisibleCount(primaryItems: LocalArtifactEntry[], supportingItems: LocalArtifactEntry[]): number {
  const supportingVisibleCount = supportingItems.filter((item) => item.role !== "metadata").length
  return primaryItems.length + supportingVisibleCount
}

function normalizeArtifactManifestEntries(
  primaryItems: LocalArtifactEntry[],
  supportingItems: LocalArtifactEntry[],
): { primaryItems: LocalArtifactEntry[]; supportingItems: LocalArtifactEntry[] } {
  if (primaryItems.length > 0) {
    return { primaryItems, supportingItems }
  }
  const visibleSupportingItems = supportingItems.filter((item) => item.role !== "metadata")
  if (visibleSupportingItems.length !== 1) {
    return { primaryItems, supportingItems }
  }
  const promoted = { ...visibleSupportingItems[0], role: "primary" as const, order: 1 }
  return {
    primaryItems: [promoted],
    supportingItems: supportingItems.filter((item) => item.path !== promoted.path),
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
  const normalized = normalizeArtifactManifestEntries(primaryItems, supportingItems)
  if (normalized.primaryItems.length === 0 && normalized.supportingItems.length === 0) {
    return null
  }
  return {
    root,
    title: optionalString(manifest.title) ?? root.name,
    kind: normalizeArtifactPackKind(manifest.kind),
    display: normalizeArtifactDisplayMode(manifest.display),
    ...(optionalString(manifest.summary) ? { summary: optionalString(manifest.summary) } : {}),
    items: normalized.primaryItems,
    supporting: normalized.supportingItems,
    totalItems: artifactPackVisibleCount(normalized.primaryItems, normalized.supportingItems),
    truncated: false,
  }
}

export class ChatServiceImpl extends ConnectionService<ChatService> implements IConnectionService<ChatService> {
  public readonly sessionActivity = new ServiceEvent<{ sessionId: string; usedAt: number }>()

  private agent: AgentManager | null
  private bridged = false
  private userStoppedSessions = new Map<string, number>()
  private emittedMessageErrors = new Map<string, Set<string>>()
  private sessionGenerations = new Map<string, SessionGeneration>()
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
    this.abortSessionGenerations()
    this.sessionGenerations.clear()
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
    return (
      this.activeAssistantMessages.size > 0 || this.pendingArtifactDirs.size > 0 || this.sessionGenerations.size > 0
    )
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
          this.clearSessionGeneration(translated.data.sessionId)
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
                console.warn("[wanta] failed to record artifact root", error)
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
          this.clearSessionGeneration(translated.data.sessionId)
          this.activeAssistantMessages.delete(translated.data.sessionId)
          this.activeToolParts.delete(translated.data.sessionId)
          this.emitSessionActivity(translated.data.sessionId)
          this.emitMessageError(emit, translated.data.sessionId, translated.data.message, messageId)
          continue
        }
        void emit(translated.event, translated.data)
        if (translated.event === "messageCompleted") {
          this.clearSessionGeneration(translated.data.sessionId)
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

  private beginSessionGeneration(sessionId: string): SessionGeneration {
    this.sessionGenerations.get(sessionId)?.controller.abort()
    const generation = { controller: new AbortController(), id: crypto.randomUUID() }
    this.sessionGenerations.set(sessionId, generation)
    return generation
  }

  private abortSessionGenerations(): void {
    for (const generation of this.sessionGenerations.values()) {
      generation.controller.abort()
    }
  }

  private isCurrentGeneration(sessionId: string, generationId: string): boolean {
    return this.sessionGenerations.get(sessionId)?.id === generationId
  }

  private clearSessionGeneration(sessionId: string, generationId?: string): void {
    if (generationId && !this.isCurrentGeneration(sessionId, generationId)) {
      return
    }
    this.sessionGenerations.delete(sessionId)
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
    const generation = this.beginSessionGeneration(req.sessionId)
    this.userStoppedSessions.delete(req.sessionId)
    this.clearMessageErrorSignatures(req.sessionId)
    this.emitSessionActivity(req.sessionId)
    let artifactDir: string
    try {
      artifactDir = await this.agent.createArtifactDir(req.sessionId)
    } catch (error) {
      this.clearSessionGeneration(req.sessionId, generation.id)
      throw error
    }
    if (!this.isCurrentGeneration(req.sessionId, generation.id) || generation.controller.signal.aborted) {
      return
    }
    this.enqueuePendingArtifactDir(req.sessionId, artifactDir)
    // promptStreaming 的结果经 SSE 推送；RPC 只确认主进程已接收本轮发送，避免首条消息 UI 等到流式内容已累积后才切换。
    void this.agent
      .promptStreaming(req.sessionId, req.text, {
        attachments: req.attachments,
        artifactDir,
        model: req.model,
        signal: generation.controller.signal,
        system: buildContextMentionsSystem(req.contextMentions),
      })
      .catch((error: unknown) => {
        this.removePendingArtifactDir(req.sessionId, artifactDir)
        if (!this.isCurrentGeneration(req.sessionId, generation.id) || generation.controller.signal.aborted) {
          return
        }
        const messageId = this.activeAssistantMessages.get(req.sessionId)
        this.clearSessionGeneration(req.sessionId, generation.id)
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
      console.error("[wanta] getAttachmentPreview failed", { path: req.path, error: errorMessage(error) })
      return { dataUrl: null }
    }
  }

  public async getLocalArtifactPreview(req: LocalArtifactPreviewRequest): Promise<LocalArtifactPreviewResult> {
    const item = await localArtifactItem(req.path)
    if (!item || item.kind !== "file") {
      return { kind: "unsupported", mime: "application/octet-stream", reason: "missing" }
    }

    const size = item.size ?? 0
    if (item.mime.toLowerCase().startsWith("image/")) {
      if (size > attachmentPreviewMaxBytes) {
        return { kind: "unsupported", mime: item.mime, size, reason: "too_large" }
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
        console.error("[wanta] getLocalArtifactPreview image failed", { path: req.path, error: errorMessage(error) })
        return { kind: "unsupported", mime: item.mime, size, reason: "read_failed" }
      }
    }

    if (item.mime.toLowerCase().startsWith("audio/") || item.mime.toLowerCase().startsWith("video/")) {
      if (size > attachmentPreviewMaxBytes) {
        return { kind: "unsupported", mime: item.mime, size, reason: "too_large" }
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
        console.error("[wanta] getLocalArtifactPreview media failed", { path: req.path, error: errorMessage(error) })
        return { kind: "unsupported", mime: item.mime, size, reason: "read_failed" }
      }
    }

    if (!isTextArtifactMime(item.mime)) {
      return { kind: "unsupported", mime: item.mime, size, reason: "unsupported_type" }
    }

    try {
      const preview = await readTextPreview(item.path, size)
      if (!preview) {
        return { kind: "unsupported", mime: item.mime, size, reason: "read_failed" }
      }
      return {
        kind: "text",
        mime: item.mime,
        size,
        text: preview.text,
        truncated: preview.truncated,
      }
    } catch (error) {
      console.error("[wanta] getLocalArtifactPreview text failed", { path: req.path, error: errorMessage(error) })
      return { kind: "unsupported", mime: item.mime, size, reason: "read_failed" }
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

  public async openExternalUrl(req: OpenExternalUrlRequest): Promise<void> {
    // 渲染层（额度中心等）已自行解析好目标 URL；主进程只校验 http/https 后外开，绝不在窗口内导航。
    await shell.openExternal(ensureExternalHttpUrl(req.url))
  }

  public async setAgentOrganization(req: SetAgentOrganizationRequest): Promise<void> {
    const organizationName = req.organizationName?.trim() ? req.organizationName.trim() : undefined
    this.deps.onSetAgentOrganization?.(organizationName)
  }

  public async stopGeneration(sessionId: string): Promise<void> {
    if (!this.agent) {
      return
    }
    const generation = this.sessionGenerations.get(sessionId)
    generation?.controller.abort()
    this.markUserStopped(sessionId)
    const messageId = this.activeAssistantMessages.get(sessionId)
    const partIds = [...(this.activeToolParts.get(sessionId) ?? [])]
    try {
      await this.agent.abort(sessionId)
    } catch (error) {
      if (messageId || !generation) {
        this.userStoppedSessions.delete(sessionId)
        throw error
      }
      console.warn("[wanta] pending generation abort failed:", error)
    }
    if (messageId) {
      await this.rememberStoppedGeneration(sessionId, messageId, partIds).catch((error: unknown) => {
        console.warn("[wanta] failed to record stopped generation", error)
      })
    }
    this.clearSessionGeneration(sessionId, generation?.id)
    this.pendingArtifactDirs.delete(sessionId)
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
