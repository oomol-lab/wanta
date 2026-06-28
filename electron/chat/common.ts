import type { ModelChoice } from "../models/common.ts"
import type { ChatErrorKind } from "./error.ts"
import type { ServiceName } from "@oomol/connection"

import { serviceName } from "../branding.ts"

export type ChatRole = "user" | "assistant"
export type ToolStatus = "pending" | "running" | "completed" | "error"

export interface AuthorizationInfo {
  service: string
  displayName: string
  action?: string
  /** 仅作为旧版/调试兜底；Wanta 授权统一走应用内 Connections 面板。 */
  authUrl?: string
  errorCode?: string
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
  authorization?: AuthorizationInfo
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
export type AgentRuntimeStatus =
  | { status: "signed_out" }
  | { status: "starting" }
  | { status: "ready" }
  | { status: "error"; message: string }

export interface AgentStatusChangedEvent {
  status: AgentRuntimeStatus
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
  /** Wanta 侧展示元数据：本轮发送时显式选择的 skill / connection 上下文。 */
  contextMentions?: ChatContextMention[]
  role: ChatRole
  parts: ChatMessagePart[]
  createdAt: number
  artifactRoot?: string
}

export interface SendMessageRequest {
  sessionId: string
  text: string
  attachments?: ChatAttachment[]
  contextMentions?: ChatContextMention[]
  organizationSkills?: ChatOrganizationSkillContext[]
  projectContext?: ChatProjectContext
  model?: ModelChoice
}

export interface ChatProjectContext {
  git?: {
    repositoryRoot: string
    currentBranch?: string
    detachedHead?: string
    dirty?: boolean
  }
  id: string
  name: string
  path: string
}

export interface ChatOrganizationSkillContext {
  description?: string
  id: string
  name: string
  packageName?: string
  version?: string
}

export type ChatContextMention =
  | {
      description?: string
      id: string
      kind: "skill"
      name: string
    }
  | {
      accountLabel?: string
      appId?: string
      displayName: string
      kind: "connection"
      service: string
    }

export interface ChatAttachment {
  id: string
  name: string
  mime: string
  size: number
  path: string
  kind?: "file" | "directory"
  /** 可选 agent 输入优化副本；UI 仍展示 path/name/mime/size 指向的原始附件。 */
  agentPath?: string
  agentName?: string
  agentMime?: string
  agentSize?: number
}

export interface AttachmentPreviewRequest {
  path: string
  mime: string
}

export interface AttachmentPreviewResult {
  dataUrl: string | null
}

export type LocalArtifactPreviewKind =
  | "archive"
  | "document"
  | "image"
  | "media"
  | "pdf"
  | "spreadsheet"
  | "text"
  | "unsupported"
export type LocalArtifactPreviewUnavailableReason = "missing" | "read_failed" | "too_large" | "unsupported_type"

export interface LocalArtifactSpreadsheetPreview {
  activeSheet: string
  columnCount: number
  rows: string[][]
  rowCount: number
  sheets: string[]
}

export interface LocalArtifactArchiveEntry {
  compressedSize?: number
  kind: "directory" | "file"
  modifiedAt?: number
  path: string
  size?: number
}

export interface LocalArtifactArchivePreview {
  entries: LocalArtifactArchiveEntry[]
  format: "tar" | "zip"
  totalEntries: number
}

export interface LocalArtifactPreviewRequest {
  path: string
}

export interface LocalArtifactPreviewResult {
  kind: LocalArtifactPreviewKind
  mime: string
  size?: number
  archive?: LocalArtifactArchivePreview
  dataUrl?: string
  documentFormat?: "docx"
  reason?: LocalArtifactPreviewUnavailableReason
  spreadsheet?: LocalArtifactSpreadsheetPreview
  text?: string
  truncated?: boolean
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

export type LocalArtifactPackKind =
  | "image_set"
  | "document"
  | "spreadsheet"
  | "presentation"
  | "web_page"
  | "code_project"
  | "archive"
  | "mixed"

export type LocalArtifactDisplayMode = "gallery" | "document" | "table" | "project" | "file_list" | "single"

export type LocalArtifactEntryRole = "primary" | "supporting" | "summary" | "metadata"

export interface LocalArtifactEntry extends LocalArtifactItem {
  title?: string
  description?: string
  role: LocalArtifactEntryRole
  order: number
}

export interface LocalArtifactPack {
  root: LocalArtifactItem
  title: string
  kind: LocalArtifactPackKind
  display: LocalArtifactDisplayMode
  summary?: string
  items: LocalArtifactEntry[]
  supporting: LocalArtifactEntry[]
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
  pack?: LocalArtifactPack
}

export interface OpenLocalPathRequest {
  path: string
}

export interface ShowLocalPathInFolderRequest {
  path: string
}

export interface OpenExternalUrlRequest {
  url: string
}

export interface SetAgentOrganizationRequest {
  organizationName?: string
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
    messageCompleted: MessageCompletedEvent
    messagePartRemoved: MessagePartRemovedEvent
    messageError: MessageErrorEvent
    generationStopped: GenerationStoppedEvent
    agentError: AgentErrorEvent
    agentStatusChanged: AgentStatusChangedEvent
  }
  ClientInvokes: {
    sendMessage(req: SendMessageRequest): Promise<void>
    getAttachmentPreview(req: AttachmentPreviewRequest): Promise<AttachmentPreviewResult>
    getLocalArtifactPreview(req: LocalArtifactPreviewRequest): Promise<LocalArtifactPreviewResult>
    resolveLocalArtifacts(req: ResolveLocalArtifactsRequest): Promise<ResolveLocalArtifactsResult>
    openLocalPath(req: OpenLocalPathRequest): Promise<void>
    showLocalPathInFolder(req: ShowLocalPathInFolderRequest): Promise<void>
    /** 用系统浏览器打开一个 http/https URL（额度中心等渲染层已自行解析好 URL 后调用；主进程仅校验+外开）。 */
    openExternalUrl(req: OpenExternalUrlRequest): Promise<void>
    /** 同步 agent 的组织作用域（连接器请求已在渲染层带组织头；agent 仍由主进程持有，需单独告知）。 */
    setAgentOrganization(req: SetAgentOrganizationRequest): Promise<void>
    stopGeneration(sessionId: string): Promise<void>
    getMessages(sessionId: string): Promise<ChatMessage[]>
    getAgentStatus(): Promise<AgentRuntimeStatus>
    /** Agent sidecar 是否就绪（未配置 OO_API_KEY 时为 false）。 */
    isReady(): Promise<boolean>
  }
}>
