import type { ServiceName } from "@oomol/connection"

import { serviceName } from "../branding.ts"

export type ChatRole = "user" | "assistant"
export type ToolStatus = "pending" | "running" | "completed" | "error"

export interface AuthorizationInfo {
  service: string
  displayName: string
  authUrl: string
  /** 上游 connector 的真实错误报文（如 ES 的 security_exception）。授权提示旁透出，避免用户只看到“去授权”却不知原因。 */
  message?: string
}

export interface ToolTiming {
  start?: number
  end?: number
}

// ── ServerEvents 负载（R7 流式：主进程把 OpenCode SSE 转译为这些事件推给渲染层）──
export interface MessageStartedEvent {
  sessionId: string
  messageId: string
  role: ChatRole
}
export interface MessageDeltaEvent {
  sessionId: string
  messageId: string
  partId: string
  /** 该文本 part 的当前累计全文（非增量片段；渲染层按 partId 替换）。 */
  text: string
  /** OpenCode 流式增量；某些 provider 在最终事件前不会持续更新 text。 */
  delta?: string
}
export interface ToolCallStartedEvent {
  sessionId: string
  messageId: string
  partId: string
  callId: string
  tool: string
  input: Record<string, unknown>
  status: "pending" | "running"
  title?: string
  metadata?: Record<string, unknown>
  timing?: ToolTiming
}
export interface ToolCallResultEvent {
  sessionId: string
  messageId: string
  partId: string
  callId: string
  tool: string
  status: "completed" | "error"
  input: Record<string, unknown>
  output?: string
  error?: string
  title?: string
  metadata?: Record<string, unknown>
  timing?: ToolTiming
  attachmentsCount?: number
}
export interface AuthorizationRequiredEvent {
  sessionId: string
  messageId: string
  service: string
  displayName: string
  authUrl: string
}
export interface MessageCompletedEvent {
  sessionId: string
}
export interface AgentErrorEvent {
  sessionId?: string
  message: string
}

// ── 规范化消息（切换会话时加载历史用）──
export interface ChatMessagePart {
  kind: "text" | "tool" | "attachment"
  partId: string
  text?: string
  attachment?: ChatAttachment
  callId?: string
  tool?: string
  status?: ToolStatus
  input?: Record<string, unknown>
  output?: string
  error?: string
  title?: string
  metadata?: Record<string, unknown>
  timing?: ToolTiming
  attachmentsCount?: number
  authorization?: AuthorizationInfo
}
export interface ChatMessage {
  id: string
  role: ChatRole
  parts: ChatMessagePart[]
  createdAt: number
}

export interface SendMessageRequest {
  sessionId: string
  text: string
  attachments?: ChatAttachment[]
}

export interface ChatAttachment {
  id: string
  name: string
  mime: string
  size: number
  path: string
}

export interface TranscribeVoiceRequest {
  audioBase64: string
}

export interface TranscribeVoiceResult {
  text: string
}

export type ChatService = typeof ChatService
export const ChatService = serviceName("chat-service") as ServiceName<{
  ServerEvents: {
    messageStarted: MessageStartedEvent
    messageDelta: MessageDeltaEvent
    toolCallStarted: ToolCallStartedEvent
    toolCallResult: ToolCallResultEvent
    authorizationRequired: AuthorizationRequiredEvent
    messageCompleted: MessageCompletedEvent
    agentError: AgentErrorEvent
  }
  ClientInvokes: {
    sendMessage(req: SendMessageRequest): Promise<void>
    transcribeVoice(req: TranscribeVoiceRequest): Promise<TranscribeVoiceResult>
    stopGeneration(sessionId: string): Promise<void>
    getMessages(sessionId: string): Promise<ChatMessage[]>
    /** Agent sidecar 是否就绪（未配置 OO_API_KEY 时为 false）。 */
    isReady(): Promise<boolean>
  }
}>
