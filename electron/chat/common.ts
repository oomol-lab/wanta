import type { ModelChoice } from "../models/common.ts"
import type { ChatErrorKind } from "./error.ts"
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
export interface MessageReasoningDeltaEvent {
  sessionId: string
  messageId: string
  partId: string
  /** OpenCode 暴露的 reasoning/processing part 当前累计内容。 */
  text: string
  delta?: string
}
export interface MessageAttachmentEvent {
  sessionId: string
  messageId: string
  partId: string
  attachment: ChatAttachment
}
export interface MessageArtifactsEvent {
  sessionId: string
  messageId: string
  artifactRoot: string
}
export type AssistantActivityPhase = "thinking" | "finalizing" | "retrying"

export interface AssistantActivityEvent {
  sessionId: string
  messageId?: string
  phase: AssistantActivityPhase
  message?: string
  attempt?: number
  nextRetryAt?: number
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
export interface MessagePartRemovedEvent {
  sessionId: string
  messageId: string
  partId: string
}
export interface MessageErrorEvent {
  sessionId: string
  messageId?: string
  partId: string
  message: string
  errorKind?: ChatErrorKind
  errorCode?: string
}
export interface GenerationStoppedEvent {
  sessionId: string
}
export interface AgentErrorEvent {
  sessionId?: string
  message: string
}

// ── 规范化消息（切换会话时加载历史用）──
export interface ChatMessagePart {
  kind: "text" | "reasoning" | "tool" | "attachment" | "error"
  partId: string
  text?: string
  errorText?: string
  errorKind?: ChatErrorKind
  errorCode?: string
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
  cancelled?: boolean
}
export interface ChatMessage {
  id: string
  /** UI 身份：不同于服务端 id，乐观消息绑定到真实消息后仍保持稳定。 */
  clientId?: string
  role: ChatRole
  parts: ChatMessagePart[]
  createdAt: number
  artifactRoot?: string
}

export interface SendMessageRequest {
  sessionId: string
  text: string
  attachments?: ChatAttachment[]
  model?: ModelChoice
}

export interface ChatAttachment {
  id: string
  name: string
  mime: string
  size: number
  path: string
  kind?: "file" | "directory"
}

export interface TranscribeVoiceRequest {
  audioBase64: string
}

export interface TranscribeVoiceResult {
  text: string
}

export interface AttachmentPreviewRequest {
  path: string
  mime: string
}

export interface AttachmentPreviewResult {
  dataUrl: string | null
}

export type LocalArtifactKind = "file" | "directory"

export interface LocalArtifactItem {
  path: string
  name: string
  kind: LocalArtifactKind
  mime: string
  size?: number
  modifiedAt?: number
}

export interface LocalArtifactGroup {
  root?: LocalArtifactItem
  items: LocalArtifactItem[]
  totalItems: number
  truncated: boolean
}

export interface ResolveLocalArtifactsRequest {
  text?: string
  artifactRoot?: string
  maxDirectoryItems?: number
}

export interface ResolveLocalArtifactsResult {
  groups: LocalArtifactGroup[]
}

export interface OpenLocalPathRequest {
  path: string
}

export type BillingPageTarget = "recharge" | "usage"
export type RechargePrice = "5_USD" | "20_USD" | "100_USD"
export type BillingPeriodDays = 7 | 30 | 90
export type SubscriptionPlanTag = "ai_pro" | "ai_max"

export interface OpenBillingPageRequest {
  target: BillingPageTarget
}

export interface OpenTopUpCheckoutRequest {
  price: RechargePrice
}

export interface CreditBalanceResult {
  balance: string | null
  hasCredits: boolean
}

export interface CreditItem {
  id: string
  sourceType: string
  paymentAmount?: number
  currency?: string
  originalCredit: string
  currentCredit: string
  available: boolean
  serviceScope: string
  orderNumber?: string
  expiresAt?: number
  promoCode?: string
  createdAt: number
}

export interface CreditUsages {
  items: CreditItem[]
  nextToken?: string
  total: {
    originalCredit: string
    currentCredit: string
  }
  deficit: string
}

export interface BillingStatsItem {
  source: string
  subject: string
  time: number
  totalCredit?: string
  totalUsage?: string
  eventCount?: number
}

export interface BillingSpendStats {
  items: BillingStatsItem[]
  sourceTotals: Record<string, { totalCredit?: string; eventCount?: number; totalUsage?: string }>
  total: { totalCredit?: string; eventCount?: number; totalUsage?: string }
}

export interface BillingLogItem {
  debitCredit: string
  eventID: string
  userID: string
  source: string
  subject: string
  sourceType: string
  serviceScope: string
  traceID: string
  payload: Record<string, unknown>
  createdAt: number
}

export interface SubscriptionStatus {
  plans: string[]
  plan: string | null
  features: string[]
  platforms: Record<string, string[]>
}

export interface SubscriptionSchedule {
  plan: string
  scheduled: boolean
  reason?: "cancel" | "update"
  targetPlan?: string
  cancelAt?: number
  currentPeriodEnd?: number
}

export interface BillingOverviewRequest {
  days: BillingPeriodDays
  forceRefresh?: boolean
}

export interface BillingOverviewResult {
  balance: CreditUsages | null
  spend: BillingSpendStats | null
  metering: BillingSpendStats | null
  logs: BillingLogItem[]
  subscription: SubscriptionStatus | null
  schedules: SubscriptionSchedule[]
}

export type BillingSummaryResult = BillingOverviewResult

export interface OpenSubscriptionCheckoutRequest {
  plan: SubscriptionPlanTag
}

export type ChatService = typeof ChatService
export const ChatService = serviceName("chat-service") as ServiceName<{
  ServerEvents: {
    messageStarted: MessageStartedEvent
    messageDelta: MessageDeltaEvent
    messageReasoningDelta: MessageReasoningDeltaEvent
    messageAttachment: MessageAttachmentEvent
    messageArtifacts: MessageArtifactsEvent
    assistantActivity: AssistantActivityEvent
    toolCallStarted: ToolCallStartedEvent
    toolCallResult: ToolCallResultEvent
    authorizationRequired: AuthorizationRequiredEvent
    messageCompleted: MessageCompletedEvent
    messagePartRemoved: MessagePartRemovedEvent
    messageError: MessageErrorEvent
    generationStopped: GenerationStoppedEvent
    agentError: AgentErrorEvent
  }
  ClientInvokes: {
    sendMessage(req: SendMessageRequest): Promise<void>
    getAttachmentPreview(req: AttachmentPreviewRequest): Promise<AttachmentPreviewResult>
    resolveLocalArtifacts(req: ResolveLocalArtifactsRequest): Promise<ResolveLocalArtifactsResult>
    openLocalPath(req: OpenLocalPathRequest): Promise<void>
    openBillingPage(req: OpenBillingPageRequest): Promise<void>
    openTopUpCheckout(req: OpenTopUpCheckoutRequest): Promise<void>
    openSubscriptionCheckout(req: OpenSubscriptionCheckoutRequest): Promise<void>
    openSubscriptionPortal(): Promise<void>
    getBillingSummary(req: BillingOverviewRequest): Promise<BillingSummaryResult>
    getBillingOverview(req: BillingOverviewRequest): Promise<BillingOverviewResult>
    getCreditBalance(): Promise<CreditBalanceResult>
    transcribeVoice(req: TranscribeVoiceRequest): Promise<TranscribeVoiceResult>
    stopGeneration(sessionId: string): Promise<void>
    getMessages(sessionId: string): Promise<ChatMessage[]>
    /** Agent sidecar 是否就绪（未配置 OO_API_KEY 时为 false）。 */
    isReady(): Promise<boolean>
  }
}>
