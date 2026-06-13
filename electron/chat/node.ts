import type { AgentManager } from "../agent/manager.ts"
import type {
  AttachmentPreviewRequest,
  AttachmentPreviewResult,
  ChatMessage,
  ChatService,
  SendMessageRequest,
  TranscribeVoiceRequest,
  TranscribeVoiceResult,
} from "./common.ts"
import type { IConnectionService } from "@oomol/connection"

import { ConnectionService } from "@oomol/connection"
import { readFile, stat } from "node:fs/promises"
import { translateOpencodeEvent } from "../agent/event-translator.ts"
import { voiceAsrBaseUrl } from "../domain.ts"
import { ChatService as ChatServiceName } from "./common.ts"

const attachmentPreviewMaxBytes = 16 * 1024 * 1024

function errorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message
  }
  return String(error)
}

function imageMimeFromPath(filePath: string): string | null {
  const extension = filePath.split(/[\\/]/).pop()?.split(".").pop()?.toLowerCase()
  switch (extension) {
    case "avif":
      return "image/avif"
    case "bmp":
      return "image/bmp"
    case "gif":
      return "image/gif"
    case "jpg":
    case "jpeg":
      return "image/jpeg"
    case "png":
      return "image/png"
    case "svg":
      return "image/svg+xml"
    case "webp":
      return "image/webp"
    default:
      return null
  }
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

export function buildVoiceAsrRequest(apiKey: string, audioBase64: string, requestId: string): RequestInit {
  return {
    method: "POST",
    credentials: "include",
    headers: {
      Accept: "application/json",
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
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

export class ChatServiceImpl extends ConnectionService<ChatService> implements IConnectionService<ChatService> {
  private agent: AgentManager | null
  private voiceAuthToken: string | undefined
  private bridged = false

  public constructor(agent: AgentManager | null = null) {
    super(ChatServiceName)
    this.agent = agent
  }

  /** 登录 / 登出时由 main 重新装配 agent（旧 agent 的事件流随其 dispose 终止）。 */
  public setAgent(agent: AgentManager | null): void {
    this.agent = agent
    this.bridged = false
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
        void emit(translated.event, translated.data)
      }
    })
  }

  public async isReady(): Promise<boolean> {
    return this.agent?.isReady() ?? false
  }

  public async sendMessage(req: SendMessageRequest): Promise<void> {
    if (!this.agent) {
      throw new Error("Agent not configured (sign in first)")
    }
    // promptStreaming 的结果经 SSE 推送；RPC 只确认主进程已接收本轮发送，避免首条消息 UI 等到流式内容已累积后才切换。
    void this.agent
      .promptStreaming(req.sessionId, req.text, { attachments: req.attachments })
      .catch((error: unknown) => {
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
    } catch {
      return { dataUrl: null }
    }
  }

  public async transcribeVoice(req: TranscribeVoiceRequest): Promise<TranscribeVoiceResult> {
    if (!this.voiceAuthToken) {
      throw new Error("Voice transcription requires a fresh sign-in. Please sign out and sign in again.")
    }
    const requestId = createVoiceAsrRequestId()
    const response = await fetch(voiceAsrBaseUrl, {
      ...buildVoiceAsrRequest(this.voiceAuthToken, req.audioBase64, requestId),
      signal: AbortSignal.timeout(60_000),
    })
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
    await this.agent.abort(sessionId)
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
