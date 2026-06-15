import type { AgentManager } from "../agent/manager.ts"
import type {
  AttachmentPreviewRequest,
  AttachmentPreviewResult,
  ChatMessage,
  ChatService,
  LocalArtifactGroup,
  LocalArtifactItem,
  OpenLocalPathRequest,
  ResolveLocalArtifactsRequest,
  ResolveLocalArtifactsResult,
  SendMessageRequest,
  TranscribeVoiceRequest,
  TranscribeVoiceResult,
} from "./common.ts"
import type { IConnectionService } from "@oomol/connection"

import { ConnectionService } from "@oomol/connection"
import { shell } from "electron"
import { readdir, readFile, stat } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { translateOpencodeEvent } from "../agent/event-translator.ts"
import { voiceAsrBaseUrl } from "../domain.ts"
import {
  extractLocalPathCandidates,
  imageMimeFromPath,
  mimeFromPath,
  normalizeLocalPathCandidate,
} from "./artifacts.ts"
import { ChatService as ChatServiceName } from "./common.ts"

const attachmentPreviewMaxBytes = 16 * 1024 * 1024
const userStopAbortWindowMs = 30_000
const defaultMaxDirectoryItems = 80

function errorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message
  }
  return String(error)
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
  private agent: AgentManager | null
  private voiceAuthToken: string | undefined
  private bridged = false
  private userStoppedSessions = new Map<string, number>()
  private pendingArtifactDirs = new Map<string, string[]>()

  public constructor(agent: AgentManager | null = null) {
    super(ChatServiceName)
    this.agent = agent
  }

  /** 登录 / 登出时由 main 重新装配 agent（旧 agent 的事件流随其 dispose 终止）。 */
  public setAgent(agent: AgentManager | null): void {
    this.agent = agent
    this.bridged = false
    this.userStoppedSessions.clear()
    this.pendingArtifactDirs.clear()
  }

  /** 登录 / 登出时由 main 更新 Studio ASR 需要的 oomol-token。只在主进程内使用，renderer 不可见。 */
  public setVoiceAuthToken(token: string | undefined): void {
    this.voiceAuthToken = token
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
          void emit("generationStopped", { sessionId: translated.data.sessionId })
          continue
        }
        if (translated.event === "messageStarted" && translated.data.role === "assistant") {
          const artifactRoot = this.consumePendingArtifactDir(translated.data.sessionId)
          if (artifactRoot) {
            void emit("messageArtifacts", {
              sessionId: translated.data.sessionId,
              messageId: translated.data.messageId,
              artifactRoot,
            })
          }
        }
        void emit(translated.event, translated.data)
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
    const artifactDir = await this.agent.createArtifactDir(req.sessionId)
    this.enqueuePendingArtifactDir(req.sessionId, artifactDir)
    // promptStreaming 的结果经 SSE 推送；RPC 只确认主进程已接收本轮发送，避免首条消息 UI 等到流式内容已累积后才切换。
    void this.agent
      .promptStreaming(req.sessionId, req.text, { attachments: req.attachments, model: req.model, artifactDir })
      .catch((error: unknown) => {
        this.removePendingArtifactDir(req.sessionId, artifactDir)
        void this.send("agentError", { sessionId: req.sessionId, message: errorMessage(error) })
      })
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
    const maxDirectoryItems = Math.max(1, Math.min(req.maxDirectoryItems ?? defaultMaxDirectoryItems, 200))
    const seen = new Set<string>()
    const groups: LocalArtifactGroup[] = []
    for (const candidate of candidates) {
      const filePath = normalizeLocalPathCandidate(candidate, os.homedir())
      if (!filePath || seen.has(filePath)) {
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
    try {
      await this.agent.abort(sessionId)
    } catch (error) {
      this.userStoppedSessions.delete(sessionId)
      throw error
    }
  }

  public async getMessages(sessionId: string): Promise<ChatMessage[]> {
    if (!this.agent) {
      return []
    }
    return this.agent.getMessages(sessionId)
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
