import type { WantaAgentMode } from "../agent/mode.ts"
import type { WantaReasoningLevel } from "../agent/reasoning.ts"
import type { AppLocale } from "../app-locale.ts"
import type { ModelChoice } from "../models/common.ts"
import type { RuntimeCapabilities } from "../runtime/common.ts"
import type { SessionScope } from "../session/common.ts"
import type { ChatErrorKind } from "./error.ts"
import type { ServiceName } from "@oomol/connection"

import { serviceName } from "../branding.ts"

export type ChatRole = "user" | "assistant"
export type ToolStatus = "pending" | "running" | "completed" | "error"
export type ReasoningLevel = WantaReasoningLevel
export type AgentMode = WantaAgentMode
export type AgentPermissionMode = "default" | "full_access"

export const BUG_REPORT_COMMAND = "/bug-report"

export interface AuthorizationInfo {
  service: string
  connectionName?: string
  displayName: string
  action?: string
  /** Backend-aware destination for external authorization flows such as OpenConnector. */
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
  /** OpenCode assistant message 的终止原因；流式更新和历史加载共用。 */
  finishReason?: string
  completedAt?: number
}
export interface MessageDeltaEvent {
  sessionId: string
  messageId: string
  partId: string
  /** 该文本 part 的当前累计全文（非增量片段；渲染层按 partId 替换）。 */
  text: string
  /** OpenCode 流式增量；某些 provider 在最终事件前不会持续更新 text。 */
  delta?: string
  /** OpenCode 为文件读取等内部展开生成的上下文；不得当作用户输入展示。 */
  synthetic?: boolean
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
export interface ArtifactBundleUpdatedEvent {
  sessionId: string
  messageId: string
}
export interface TurnOutputUpdatedEvent {
  sessionId: string
  messageId: string
}
export type AssistantActivityPhase = "thinking" | "finalizing" | "retrying"

export interface AssistantActivityEvent {
  sessionId: string
  messageId?: string
  phase: AssistantActivityPhase
  /** step-finish.reason；用于在 message.updated 到达前保留本步语义。 */
  finishReason?: string
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
export interface ChatQuestionOption {
  label: string
  description?: string
}
export interface ChatQuestionInfo {
  question: string
  header: string
  options: ChatQuestionOption[]
  multiple?: boolean
  custom?: boolean
}
export interface ChatQuestionRequest {
  id: string
  sessionId: string
  questions: ChatQuestionInfo[]
  tool?: {
    messageId: string
    callId: string
  }
}
export interface QuestionAskedEvent {
  sessionId: string
  request: ChatQuestionRequest
}
export interface QuestionResolvedEvent {
  sessionId: string
  requestId: string
  answers?: string[][]
}
export interface AnswerQuestionRequest {
  sessionId: string
  requestId: string
  answers: string[][]
}
export interface RejectQuestionRequest {
  sessionId: string
  requestId: string
}
export type ChatPermissionReply = "once" | "always" | "reject"
export interface ChatPermissionRequest {
  id: string
  sessionId: string
  action: string
  resources: string[]
  save?: string[]
  metadata?: Record<string, unknown>
  tool?: {
    messageId: string
    callId: string
  }
}
export interface PermissionAskedEvent {
  sessionId: string
  request: ChatPermissionRequest
}
export interface PermissionResolvedEvent {
  sessionId: string
  requestId: string
}
export interface AnswerPermissionRequest {
  sessionId: string
  requestId: string
  reply: ChatPermissionReply
}
export interface SetChatPermissionModeRequest {
  sessionId: string
  permissionMode: AgentPermissionMode
  version?: number
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
  messageId?: string
  partIds?: string[]
  stoppedAt?: number
}
export type GenerationInterruptedReason =
  | "connection_failed"
  | "generation_stale"
  | "runtime_failed"
  | "runtime_restarted"
  | "runtime_error"
  | "start_timeout"
  | "submit_timeout"

export interface GenerationInterruptedEvent {
  sessionId: string
  messageId?: string
  partIds?: string[]
  interruptedAt: number
  reason: GenerationInterruptedReason
  message: string
}
export type GenerationNoticeKind = "generation_stale" | "tool_running_without_output"
export interface GenerationNoticeEvent {
  sessionId: string
  messageId?: string
  partIds?: string[]
  createdAt: number
  kind: GenerationNoticeKind
}
export type ChatRunPhase =
  | "sending"
  | "submitted"
  | "thinking"
  | "tool_running"
  | "answering"
  | "awaiting_permission"
  | "awaiting_question"

export type ChatRunWorkspace = SessionScope

export interface ChatActiveRun {
  activeAssistantMessageId?: string
  activeToolPartIds: string[]
  blockingRequestIds: string[]
  generationId: string
  phase: ChatRunPhase
  runId: string
  sessionId: string
  startedAt: number
  updatedAt: number
  workspace: ChatRunWorkspace
}

export interface ActiveRunUpdatedEvent {
  endedAt?: number
  endedRunId?: string
  run: ChatActiveRun | null
  sessionId: string
}
export interface AgentConnectionChangedEvent {
  sessionId: string
  messageId?: string
  status: "reconnecting" | "reconnected" | "failed" | "runtime_restarting" | "runtime_recovered" | "runtime_failed"
  attempt?: number
  maxAttempts?: number
  message?: string
  createdAt: number
}
export interface AgentErrorEvent {
  sessionId?: string
  message: string
}
export type AgentRuntimeStatus =
  | { status: "model_required" }
  | { status: "starting" }
  | { status: "ready" }
  | { status: "error"; message: string }

export interface AgentStatusChangedEvent {
  status: AgentRuntimeStatus
}

export interface RuntimeCapabilitiesChangedEvent {
  capabilities: RuntimeCapabilities
}

// ── 规范化消息（切换会话时加载历史用）──
export interface ChatMessagePart {
  kind: "text" | "reasoning" | "tool" | "attachment" | "error" | "status"
  partId: string
  text?: string
  statusType?:
    | "reconnecting"
    | "reconnected"
    | "connectionFailed"
    | "generationStale"
    | "runtimeRestarting"
    | "runtimeRecovered"
    | "runtimeFailed"
    | "toolRunningWithoutOutput"
  attempt?: number
  maxAttempts?: number
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
  /** OpenCode assistant message 的 finish 字段。 */
  finishReason?: string
  completedAt?: number
  tokenUsage?: ChatTokenUsage
}

export interface ChatTokenUsage {
  total?: number
  input: number
  output: number
  reasoning: number
  cache: {
    read: number
    write: number
  }
}

export interface SendMessageRequest {
  sessionId: string
  text: string
  appLocale?: AppLocale
  attachments?: ChatAttachment[]
  contextMentions?: ChatContextMention[]
  teamSkills?: ChatTeamSkillContext[]
  projectContext?: ChatProjectContext
  scope: SessionScope
  model?: ModelChoice
  permissionMode?: AgentPermissionMode
  permissionModeVersion?: number
  reasoningLevel?: ReasoningLevel
  mode?: AgentMode
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

export interface ChatTeamSkillContext {
  description?: string
  icon?: string
  id: string
  name: string
  packageName?: string
  skillName?: string
  version?: string
}

export type ChatContextMention =
  | {
      description?: string
      icon?: string
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
  | {
      id: string
      kind: "knowledge"
      name: string
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
  resourceExpiresAt?: number
  resourceUrl?: string
}

export interface LocalImageRequest {
  path: string
}

export interface SaveLocalImageAsResult {
  path?: string
  saved: boolean
}

export interface LocalArtifactThumbnailRequest {
  path: string
}

export interface LocalArtifactThumbnailResult {
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
  workbook?: LocalArtifactSpreadsheetSheetPreview[]
}

export interface LocalArtifactSpreadsheetSheetPreview {
  columnCount: number
  name: string
  rows: string[][]
  rowCount: number
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
  resourceUrl?: string
  resourceExpiresAt?: number
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
export type ArtifactBundleKind = LocalArtifactPackKind
export type ArtifactBundleDisplay = LocalArtifactDisplayMode
export type ArtifactBundleStatus = "ready" | "partial" | "failed"
export type ArtifactBundleFailure =
  | "generated_preview_not_persisted"
  | "project_output_publish_failed"
  | "project_output_publish_partial"
export type ArtifactItemStatus = "ready"
export type ArtifactItemOrigin = "managed_output" | "assistant_attachment" | "assistant_preview" | "recovered_output"

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

export interface ArtifactBundle {
  id: string
  sessionId: string
  messageId: string
  rootPath: string
  status: ArtifactBundleStatus
  kind: ArtifactBundleKind
  display: ArtifactBundleDisplay
  items: ArtifactItem[]
  totalItems: number
  truncated: boolean
  createdAt: number
  completedAt?: number
  failure?: ArtifactBundleFailure
}

export interface ArtifactItem extends LocalArtifactItem {
  id: string
  status: ArtifactItemStatus
  origin: ArtifactItemOrigin
}

export interface ArtifactBundlesRequest {
  sessionId: string
  messageIds: string[]
}

export type TurnOutputFileRole = "process" | "project_change"
export type TurnOutputChangeKind = "added" | "modified" | "deleted"
export type TurnOutputDiffKind = "text" | "binary" | "missing" | "too_large"

export interface TurnOutputSummary {
  processFileCount: number
  changedFileCount: number
  additions: number
  deletions: number
}

export interface TurnOutputFile {
  path: string
  name: string
  role: TurnOutputFileRole
  changeKind: TurnOutputChangeKind
  mime: string
  additions: number
  deletions: number
  binary?: boolean
  size?: number
  truncated?: boolean
}

export interface TurnOutputRecord {
  sessionId: string
  messageId: string
  processRoot?: string
  projectRoot?: string
  createdAt: number
  completedAt?: number
  files: TurnOutputFile[]
  projectChangesTruncated?: boolean
  summary: TurnOutputSummary
}

export interface TurnOutputRequest {
  sessionId: string
  messageId: string
}

export interface TurnOutputsRequest {
  sessionId: string
  messageIds: string[]
}

export interface TurnFileDiffRequest extends TurnOutputRequest {
  path: string
}

export interface TurnFileDiffResult {
  kind: TurnOutputDiffKind
  path: string
  mime: string
  additions: number
  deletions: number
  patch?: string
  truncated?: boolean
}

export interface ChatSessionSnapshot {
  activeRun: ChatActiveRun | null
  messages: ChatMessage[]
  pendingPermissions: ChatPermissionRequest[]
  pendingQuestions: ChatQuestionRequest[]
  sessionId: string
}

export interface ResolveLocalArtifactsRequest {
  artifactRoot: string
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

export interface SetAgentTeamRequest {
  teamName: string
}

export type RechargePrice = "5_USD" | "20_USD" | "100_USD"
// Capped at 30: insight's V2 team stats route (/v2/stats/team/:teamId/*) rejects daily windows
// wider than STATS_V2_USER_DAILY_MAX_DAYS (30) with HTTP 400 — do not add a value above 30 here.
export type BillingPeriodDays = 7 | 30
export type SubscriptionPlanTag = "ai_pro" | "ai_max"
export type TeamSubscriptionPlan = "team_plus" | "team_pro"

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

export interface SubscriptionStatus {
  plans: string[]
  plan: string | null
  features: string[]
  platforms: Record<string, string[]>
  team?: TeamAdditionalSeatsData
}

export interface TeamAdditionalSeatsData {
  additionalSeats: number
  updatedAt: number | null
  cached: boolean
}

export interface TeamSubscriptionChangePayload {
  additional_seats?: number
  plan?: TeamSubscriptionPlan | null
}

export interface TeamSubscriptionPreviewResult {
  amountDue: number
  changeTiming: "immediate" | "next_cycle"
  currency: string | null
  mode: "create" | "update"
  targetAdditionalSeats: number
  targetPlan: TeamSubscriptionPlan | null
  total: number
}

export interface TeamSubscriptionUpdateResult {
  subscriptionID: string
  status: string
  plan: TeamSubscriptionPlan | null
  additionalSeats: number
  targetPlan: TeamSubscriptionPlan | null
  targetAdditionalSeats: number
  currentPeriodEnd: number
  latestInvoiceID: string | null
  paymentRequired: boolean
  paymentURL: string | null
  invoiceStatus: string | null
  amountRemaining: number | null
  currency: string | null
  pendingUpdate: boolean
  pendingUpdateExpiresAt: number | null
  scheduledUpdate: boolean
  scheduledEffectiveAt: number | null
}

export interface TeamPendingPaymentResult {
  subscriptionID: string | null
  status: string | null
  plan: TeamSubscriptionPlan | null
  additionalSeats: number
  currentPeriodEnd: number | null
  latestInvoiceID: string | null
  paymentRequired: boolean
  paymentURL: string | null
  invoiceStatus: string | null
  amountRemaining: number | null
  currency: string | null
  pendingUpdate: boolean
  pendingUpdateExpiresAt: number | null
}

export interface BillingOverviewResult {
  balance: CreditUsages | null
  spend: BillingSpendStats | null
  metering: BillingSpendStats | null
  usageSubscription: SubscriptionStatus | null
  usageSubscriptionAvailable: boolean
  subscription: SubscriptionStatus | null
  subscriptionAvailable: boolean
  teamPendingPayment: TeamPendingPaymentResult | null
  teamPendingPaymentAvailable: boolean
}

export type ChatService = typeof ChatService
export const ChatService = serviceName("chat-service") as ServiceName<{
  ServerEvents: {
    messageStarted: MessageStartedEvent
    messageDelta: MessageDeltaEvent
    messageReasoningDelta: MessageReasoningDeltaEvent
    messageAttachment: MessageAttachmentEvent
    artifactBundleUpdated: ArtifactBundleUpdatedEvent
    turnOutputUpdated: TurnOutputUpdatedEvent
    assistantActivity: AssistantActivityEvent
    toolCallStarted: ToolCallStartedEvent
    toolCallResult: ToolCallResultEvent
    questionAsked: QuestionAskedEvent
    questionReplied: QuestionResolvedEvent
    questionRejected: QuestionResolvedEvent
    permissionAsked: PermissionAskedEvent
    permissionReplied: PermissionResolvedEvent
    messageCompleted: MessageCompletedEvent
    messagePartRemoved: MessagePartRemovedEvent
    messageError: MessageErrorEvent
    generationStopped: GenerationStoppedEvent
    generationInterrupted: GenerationInterruptedEvent
    generationNotice: GenerationNoticeEvent
    activeRunUpdated: ActiveRunUpdatedEvent
    agentConnectionChanged: AgentConnectionChangedEvent
    agentError: AgentErrorEvent
    agentStatusChanged: AgentStatusChangedEvent
    runtimeCapabilitiesChanged: RuntimeCapabilitiesChangedEvent
  }
  ClientInvokes: {
    sendMessage(req: SendMessageRequest): Promise<void>
    getAttachmentPreview(req: AttachmentPreviewRequest): Promise<AttachmentPreviewResult>
    copyLocalImage(req: LocalImageRequest): Promise<void>
    saveLocalImageAs(req: LocalImageRequest): Promise<SaveLocalImageAsResult>
    getLocalArtifactPreview(req: LocalArtifactPreviewRequest): Promise<LocalArtifactPreviewResult>
    getLocalArtifactThumbnail(req: LocalArtifactThumbnailRequest): Promise<LocalArtifactThumbnailResult>
    getTurnOutputs(req: TurnOutputsRequest): Promise<TurnOutputRecord[]>
    getTurnFileDiff(req: TurnFileDiffRequest): Promise<TurnFileDiffResult>
    resolveLocalArtifacts(req: ResolveLocalArtifactsRequest): Promise<ResolveLocalArtifactsResult>
    getArtifactBundles(req: ArtifactBundlesRequest): Promise<ArtifactBundle[]>
    openLocalPath(req: OpenLocalPathRequest): Promise<void>
    showLocalPathInFolder(req: ShowLocalPathInFolderRequest): Promise<void>
    /** 用系统浏览器打开一个 http/https URL（额度中心等渲染层已自行解析好 URL 后调用；主进程仅校验+外开）。 */
    openExternalUrl(req: OpenExternalUrlRequest): Promise<void>
    /** 同步 agent 的团队作用域（连接器请求已在渲染层带团队头；agent 仍由主进程持有，需单独告知）。 */
    setAgentTeam(req: SetAgentTeamRequest): Promise<void>
    stopGeneration(sessionId: string): Promise<void>
    getActiveRuns(): Promise<ChatActiveRun[]>
    getActiveRun(sessionId: string): Promise<ChatActiveRun | null>
    getSessionSnapshot(sessionId: string): Promise<ChatSessionSnapshot>
    getMessages(sessionId: string): Promise<ChatMessage[]>
    getPendingQuestions(sessionId: string): Promise<ChatQuestionRequest[]>
    answerQuestion(req: AnswerQuestionRequest): Promise<void>
    rejectQuestion(req: RejectQuestionRequest): Promise<void>
    getPendingPermissions(sessionId: string): Promise<ChatPermissionRequest[]>
    answerPermission(req: AnswerPermissionRequest): Promise<void>
    setPermissionMode(req: SetChatPermissionModeRequest): Promise<void>
    getAgentStatus(): Promise<AgentRuntimeStatus>
    getRuntimeCapabilities(): Promise<RuntimeCapabilities>
    /** Agent sidecar 是否就绪；本地模式缺少 custom model 时为 false。 */
    isReady(): Promise<boolean>
  }
}>
