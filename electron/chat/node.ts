import type { AgentConnectionStatus } from "../agent/contract/event.ts"
import type { ExternalAgentKind } from "../agent/contract/profile.ts"
import type { ChatEmit } from "../agent/event-translator.ts"
import type { ExternalAgentAdapter } from "../agent/external/adapter-base.ts"
import type { ExternalAgentRuntimeStatus } from "../agent/external/probe.ts"
import type { OpencodeAgentAdapter } from "../agent/opencode-adapter.ts"
import type { GitTurnBaseline } from "../git/turn-diff.ts"
import type { ActiveLinkRuntime } from "../link-runtime/common.ts"
import type { RuntimeCapabilities } from "../runtime/common.ts"
import type { SessionProjectStore } from "../session/project-store.ts"
import type { ArtifactBundleStore, ArtifactBundles } from "./artifact-bundles.ts"
import type { AuthorizationOverlayStore } from "./authorization.ts"
import type {
  AgentRuntimeStatus,
  AgentPermissionMode,
  ArtifactBundle,
  ArtifactBundlesRequest,
  AnswerPermissionRequest,
  AnswerQuestionRequest,
  AttachmentPreviewRequest,
  AttachmentPreviewResult,
  AuthorizationInfo,
  ChatActiveRun,
  ChatAttachment,
  ChatMessage,
  ChatPermissionRequest,
  ChatQuestionRequest,
  ChatRunWorkspace,
  ChatSessionSnapshot,
  ChatService,
  ChatProjectContext,
  GenerationInterruptedReason,
  GenerationNoticeKind,
  LocalArtifactPreviewRequest,
  LocalArtifactPreviewResult,
  LocalArtifactThumbnailRequest,
  LocalArtifactThumbnailResult,
  LocalArtifactGroup,
  LocalImageRequest,
  LocalArtifactPack,
  MessageErrorEvent,
  OpenExternalUrlRequest,
  OpenLocalPathRequest,
  RejectQuestionRequest,
  ResolveLocalArtifactsRequest,
  ResolveLocalArtifactsResult,
  SendMessageRequest,
  SaveLocalImageAsResult,
  SetChatPermissionModeRequest,
  SetExternalSessionEffortRequest,
  SetExternalSessionModelRequest,
  SetAgentTeamRequest,
  ShowLocalPathInFolderRequest,
  ToolCallResultEvent,
  ToolCallStartedEvent,
  TurnFileDiffRequest,
  TurnFileDiffResult,
  TurnOutputRecord,
  TurnOutputsRequest,
} from "./common.ts"
import type { SessionGeneration } from "./generation-registry.ts"
import type { StoppedGenerationStore } from "./stopped-generations.ts"
import type { StoredTurnOutputRecord, TurnOutputRecords, TurnOutputStore } from "./turn-outputs.ts"
import type { UserAttachmentStore } from "./user-attachments.ts"
import type { IConnectionService } from "@oomol/connection"

import { ConnectionService } from "@oomol/connection"
import { clipboard, dialog, nativeImage, shell } from "electron"
import { copyFile, readFile, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { ActivityMetrics } from "../activity-metrics.ts"
import { externalAgentKindForSessionId } from "../agent/external/session-id.ts"
import { createOpencodeMessageId } from "../agent/opencode-id.ts"
import { logDiagnostic } from "../diagnostics-log.ts"
import { captureGitTurnBaseline } from "../git/turn-diff.ts"
import { resolveRuntimeCapabilities } from "../runtime/common.ts"
import { ServiceEvent } from "../service-events.ts"
import { normalizeSessionScopeValue } from "../session/common.ts"
import { ActiveRunRegistry } from "./active-run-registry.ts"
import { captureArtifactSessionBaseline } from "./artifact-bundles.ts"
import { normalizeLocalPathCandidate } from "./artifacts.ts"
import { applyAuthorizationOverlays } from "./authorization.ts"
import {
  BUG_REPORT_FILE_NAME,
  bugReportModelLabel,
  buildBugReportSystemPrompt,
  parseBugReportCommand,
} from "./bug-report.ts"
import { ChatService as ChatServiceName } from "./common.ts"
import {
  buildContextMentionsSystem as buildContextMentionsSystemPrompt,
  buildPermissionModeSystem,
  buildProjectContextSystem,
  buildResponseLanguageSystem,
  buildTeamSkillsSystem,
  mergeSystemPrompts,
} from "./context-system.ts"
import { normalizeChatError } from "./error.ts"
import { GenerationRegistry } from "./generation-registry.ts"
import {
  evaluateLocalAccessRequest,
  localAccessGrantForRequest,
  localAccessPromptReason,
} from "./local-access-policy.ts"
import { directoryArtifacts, fileArtifact, localArtifactItem, readArtifactPack } from "./local-artifacts.ts"
import { OutputPersistence } from "./output-persistence.ts"
import { PermissionDiagnostics } from "./permission-diagnostics.ts"
import { PermissionState } from "./permission-state.ts"
import { attachmentPreview, localArtifactPreview } from "./previews.ts"
import { detectResponseLanguage } from "./response-language.ts"
import { applyStoppedGenerations } from "./stopped-generations.ts"
import { ChatStreamEventBuffer } from "./stream-event-buffer.ts"
import { SubagentSessions } from "./subagent-sessions.ts"
import { TrustedLocalAccess } from "./trusted-local-access.ts"
import { resolveChatTurnExecution } from "./turn-execution.ts"
import {
  generationNoticeKindForInactivity,
  inactivityWatchdogActionForEvent,
  terminalConnectionInterruption,
} from "./turn-lifecycle.ts"
import { isPathInside, normalizeProjectPath } from "./turn-output-files.ts"
import { finalizeTurnOutput as finalizeTurnOutputArtifacts } from "./turn-output-finalizer.ts"
import { TurnOutputRegistry } from "./turn-output-registry.ts"
import { publicTurnOutputRecord } from "./turn-outputs.ts"
import { applyUserAttachmentRecords } from "./user-attachments.ts"
import { UserStopTracker } from "./user-stop-tracker.ts"

export { buildContextMentionsSystem } from "./context-system.ts"
export { isAbortErrorMessage } from "./user-stop-tracker.ts"

const generationSubmitTimeoutMs = 45_000
const generationStartAckTimeoutMs = 45_000
const generationInactivityTimeoutMs = 2 * 60_000
const generationActiveToolInactivityTimeoutMs = 10 * 60_000
const questionRejectTimeoutMs = 5_000
const automaticPermissionRetryDelayMs = 75
const completionRetryInitialDelayMs = 50
const completionRetryMaxDelayMs = 2_000
const completionRetryMaxAttempts = 20
const defaultMaxDirectoryItems = 80
const startedMessageLimit = 5_000

function errorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message
  }
  return String(error)
}

async function removeUnsubmittedTurnDirectories(
  artifactDir: string | undefined,
  processDir: string | undefined,
): Promise<void> {
  await Promise.all(
    [artifactDir, processDir]
      .filter((directory): directory is string => Boolean(directory))
      .map((directory) => rm(directory, { force: true, recursive: true })),
  ).catch((error: unknown) => {
    console.warn("[wanta] failed to clean unsubmitted turn directories", error)
  })
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

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      reject(new Error(`Timed out (${label}, ${timeoutMs}ms)`))
    }, timeoutMs)
    timer.unref?.()
  })
  return Promise.race([promise, timeout]).finally(() => {
    if (timer) {
      clearTimeout(timer)
    }
  })
}

function createMessageErrorPayload(
  sessionId: string,
  message: string,
  runtimeMode: RuntimeCapabilities["mode"],
  messageId?: string,
): MessageErrorEvent {
  const normalized = normalizeChatError(message, { runtimeMode })
  return {
    sessionId,
    ...(messageId ? { messageId } : {}),
    partId: createErrorPartId(),
    message,
    errorKind: normalized.kind,
    ...(normalized.code ? { errorCode: normalized.code } : {}),
  }
}

function teamNameFromRequest(req: SendMessageRequest): string | undefined {
  const teamName = req.scope.kind === "team" ? req.scope.teamName.trim() : ""
  return teamName ? teamName : undefined
}

function runWorkspaceFromRequest(req: SendMessageRequest): ChatRunWorkspace {
  const scope = normalizeSessionScopeValue(req.scope)
  if (!scope) throw new Error("Workspace scope is invalid")
  return scope
}

function messageErrorSignature(message: string): string {
  return message.trim() || message
}

function metadataString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined
}

function taskChildSessionId(data: ToolCallStartedEvent | ToolCallResultEvent): string | undefined {
  // Task fan-out is a kernel mechanism: the child ids live in the kernel's
  // session space and feed kernel-only knowledge-scope APIs. External adapter
  // events flow through the same pipeline, so they must never claim a pair.
  if (data.tool !== "task" || externalAgentKindForSessionId(data.sessionId)) {
    return undefined
  }
  const metadata = data.metadata
  const parentSessionId =
    metadataString(metadata?.parentSessionId) ?? metadataString(metadata?.parentSessionID) ?? data.sessionId
  const childSessionId = metadataString(metadata?.sessionId) ?? metadataString(metadata?.sessionID)
  if (!childSessionId || childSessionId === data.sessionId || parentSessionId !== data.sessionId) {
    return undefined
  }
  return childSessionId
}

interface ChatServiceDeps {
  browserAvailable?: () => boolean
  createArtifactResourceUrl?: (item: { mime: string; modifiedAt: number; path: string; size: number }) => {
    expiresAt: number
    url: string
  }
  createSpreadsheetPreview?: (path: string, mime: string, size: number) => Promise<LocalArtifactPreviewResult>
  createArtifactThumbnail?: (path: string) => Promise<LocalArtifactThumbnailResult>
  artifactBundleStore?: ArtifactBundleStore
  authorizationOverlayStore?: AuthorizationOverlayStore
  projectStore?: Pick<SessionProjectStore, "read">
  stoppedGenerationStore?: StoppedGenerationStore
  trustedAttachmentPaths?: Iterable<string> & Pick<Set<string>, "clear" | "delete"> & { readonly revision?: number }
  turnOutputStore?: TurnOutputStore
  userAttachmentStore?: UserAttachmentStore
  bugReportRuntime?: {
    appCommit: string
    appVersion: string
    platform: NodeJS.Platform
  }
  /** 渲染层切换团队 workspace 时，同步 agent 的团队作用域（main 持有 agent 与 activeAgentTeamName）。 */
  onSetAgentTeam?: (teamName: string | undefined) => Promise<void> | void
  /** OOMOL runtime 的模型/工具请求收到 401 时使全局 session 失效；local provider 401 不调用。 */
  onOomolAuthRequired?: () => Promise<void> | void
  /** 权限模式由 ChatService 统一提交，避免 renderer 分别写运行态与会话元数据。 */
  onPermissionModeChanged?: (sessionId: string, permissionMode: AgentPermissionMode) => Promise<void> | void
  /** 正常完成且产物已收尾后通知主进程 attention 域；停止和错误路径不触发。 */
  onSessionCompleted?: (input: { teamId: string; runId: string; sessionId: string }) => Promise<void> | void
}

interface StopSessionGenerationOptions {
  abortAgent: boolean
  reason: "system" | "user"
  throwOnAbortFailure: boolean
}

export class ChatServiceImpl extends ConnectionService<ChatService> implements IConnectionService<ChatService> {
  public readonly sessionActivity = new ServiceEvent<{ sessionId: string; usedAt: number }>()

  private agent: OpencodeAgentAdapter | null
  private bridged = false
  private agentUnsubscribe: (() => void) | null = null
  /** External (BYOA) adapters, app-lifetime, keyed by agent kind. */
  private externalAgents: ReadonlyMap<ExternalAgentKind, ExternalAgentAdapter> = new Map()
  private externalAgentUnsubscribes: Array<() => void> = []
  private readonly userStops = new UserStopTracker()
  private emittedMessageErrors = new Map<string, Set<string>>()
  private readonly generations = new GenerationRegistry()
  private readonly activeRuns = new ActiveRunRegistry(({ ended, run, sessionId }) => {
    this.sendBestEffort(this.send.bind(this) as (event: string, data: unknown) => Promise<void>, "activeRunUpdated", {
      ...ended,
      run,
      sessionId,
    })
  })
  private readonly turnOutputs: TurnOutputRegistry
  private activeAssistantMessages = new Map<string, string>()
  private activeToolParts = new Map<string, Set<string>>()
  private internalMessageIds = new Set<string>()
  private compactingSessions = new Set<string>()
  private connectionFailedSessions = new Set<string>()
  private readonly trustedAccess: TrustedLocalAccess
  private readonly subagentSessions: SubagentSessions
  private readonly permissions = new PermissionState()
  private readonly permissionDiagnostics = new PermissionDiagnostics()
  private readonly deps: ChatServiceDeps
  private agentStatus: AgentRuntimeStatus = { status: "model_required" }
  private runtimeCapabilities: RuntimeCapabilities = resolveRuntimeCapabilities({
    mode: "local",
    localAgentAvailable: false,
    linkRuntimeAvailable: false,
  })
  private activeLinkRuntime: ActiveLinkRuntime = "none"
  private readonly outputPersistence: OutputPersistence
  private scopeMutationQueue: Promise<void> = Promise.resolve()
  private desiredWorkspaceTeamName: string | undefined
  private streamEventBuffer: ChatStreamEventBuffer | null = null
  private startedMessages = new Set<string>()
  private readonly completionChecks = new Set<string>()
  private readonly completionRetryAttempts = new Map<string, number>()
  private readonly completionRetryTimers = new Map<string, NodeJS.Timeout>()
  private readonly managedUserMessageIds = new Set<string>()
  private readonly internalAttachmentPathsByMessage = new Map<string, Set<string>>()
  private readonly managedUserMessageIdsBySession = new Map<string, Set<string>>()
  private readonly eventMetrics = new ActivityMetrics((snapshot) => {
    logDiagnostic("performance", "chat event activity", { ...snapshot }, "trace")
  })

  public constructor(agent: OpencodeAgentAdapter | null = null, deps: ChatServiceDeps = {}) {
    super(ChatServiceName)
    this.agent = agent
    this.deps = deps
    this.trustedAccess = new TrustedLocalAccess({
      loadAdditionalRoots: () => this.loadAdditionalTrustedRoots(),
      ...(deps.trustedAttachmentPaths ? { trustedAttachmentPaths: deps.trustedAttachmentPaths } : {}),
    })
    this.subagentSessions = new SubagentSessions(this.permissions, this.trustedAccess)
    this.turnOutputs = new TurnOutputRegistry({
      generationIdForSession: (sessionId) => this.generations.get(sessionId)?.id,
      onRootsChanged: () => this.invalidateTrustedLocalPathRoots(),
    })
    this.outputPersistence = new OutputPersistence(
      {
        artifactBundle: deps.artifactBundleStore,
        authorization: deps.authorizationOverlayStore,
        stoppedGeneration: deps.stoppedGenerationStore,
        turnOutput: deps.turnOutputStore,
      },
      () => this.invalidateTrustedLocalPathRoots(),
    )
  }

  public override dispose(): void {
    this.streamEventBuffer?.clear()
    this.streamEventBuffer = null
    this.clearAllCompletionRetries()
    this.eventMetrics.dispose()
    super.dispose()
  }

  /** 登录 / 登出时由 main 重新装配 agent（旧 agent 的事件流随其 dispose 终止）。 */
  public setAgent(agent: OpencodeAgentAdapter | null): void {
    this.streamEventBuffer?.clear()
    this.streamEventBuffer = null
    this.agentUnsubscribe?.()
    this.agentUnsubscribe = null
    this.agent = agent
    this.bridged = false
    this.userStops.clear()
    this.emittedMessageErrors.clear()
    this.activeRuns.clear()
    this.generations.reset()
    this.turnOutputs.clear()
    this.activeAssistantMessages.clear()
    this.activeToolParts.clear()
    this.connectionFailedSessions.clear()
    this.trustedAccess.clear()
    this.subagentSessions.clear()
    this.permissions.clear()
    this.outputPersistence.reset()
    this.desiredWorkspaceTeamName = undefined
    this.startedMessages.clear()
    this.internalMessageIds.clear()
    this.compactingSessions.clear()
    this.completionChecks.clear()
    this.clearAllCompletionRetries()
    this.managedUserMessageIds.clear()
    this.internalAttachmentPathsByMessage.clear()
    this.managedUserMessageIdsBySession.clear()
    this.deps.trustedAttachmentPaths?.clear()
    this.scopeMutationQueue = Promise.resolve()
  }

  /**
   * Register app-lifetime external (BYOA) adapters. Their events run through
   * the same bridge pipeline as the kernel; connection-status events stay
   * per-adapter and never touch the kernel's global agent status.
   */
  public setExternalAgents(agents: ReadonlyMap<ExternalAgentKind, ExternalAgentAdapter>): void {
    for (const unsubscribe of this.externalAgentUnsubscribes) {
      unsubscribe()
    }
    this.externalAgentUnsubscribes = []
    this.externalAgents = agents
    const emit = this.send.bind(this) as (event: string, data: unknown) => Promise<void>
    for (const adapter of agents.values()) {
      this.externalAgentUnsubscribes.push(
        adapter.onEvent((event) => {
          if (event.event === "connectionStatus") {
            return
          }
          this.processAgentEvent(emit, event)
        }),
      )
    }
  }

  public async getExternalAgents(): Promise<ExternalAgentRuntimeStatus[]> {
    const statuses = await Promise.all(
      [...this.externalAgents.values()].map(async (adapter) => {
        try {
          return await adapter.runtimeStatus()
        } catch (error) {
          logDiagnostic("chat-service", "external agent probe failed", { error, kind: adapter.kind }, "warn")
          return null
        }
      }),
    )
    return statuses.filter((status): status is ExternalAgentRuntimeStatus => Boolean(status))
  }

  public async setExternalSessionModel(req: SetExternalSessionModelRequest): Promise<void> {
    await this.externalAdapterFor(req.sessionId).send({
      type: "set-model",
      sessionId: req.sessionId,
      ...(req.modelId ? { modelId: req.modelId } : {}),
    })
  }

  public async setExternalSessionEffort(req: SetExternalSessionEffortRequest): Promise<void> {
    await this.externalAdapterFor(req.sessionId).send({
      type: "set-effort",
      sessionId: req.sessionId,
      ...(req.effortId ? { effortId: req.effortId } : {}),
    })
  }

  public async getExternalSessionSelection(sessionId: string): Promise<{ modelId?: string; effortId?: string }> {
    return this.externalAdapterFor(sessionId).sessionSelection(sessionId)
  }

  public async warmExternalAgent(kind: ExternalAgentKind): Promise<void> {
    await this.externalAgents.get(kind)?.warmCatalog()
  }

  private externalAdapterFor(sessionId: string): ExternalAgentAdapter {
    const kind = externalAgentKindForSessionId(sessionId)
    const adapter = kind ? this.externalAgents.get(kind) : undefined
    if (!adapter) {
      throw new Error("This operation only applies to external agent sessions.")
    }
    return adapter
  }

  /** Resolve the backend that owns a session id (kernel or an external adapter). */
  private chatBackendFor(sessionId: string): OpencodeAgentAdapter | ExternalAgentAdapter | null {
    const kind = externalAgentKindForSessionId(sessionId)
    if (kind) {
      return this.externalAgents.get(kind) ?? null
    }
    return this.agent
  }

  /**
   * Best-effort projection of a permission mode onto the session's adapter.
   * Backends without the capability (the kernel) are a silent no-op; failures
   * never block the caller because enforcement stays agent-side anyway.
   */
  private async projectPermissionMode(sessionId: string, mode: AgentPermissionMode): Promise<void> {
    const backend = this.chatBackendFor(sessionId)
    if (!backend || !("applyPermissionMode" in backend) || !backend.applyPermissionMode) {
      return
    }
    try {
      await backend.applyPermissionMode(sessionId, mode)
    } catch (error) {
      logDiagnostic(
        "chat-service",
        "failed to project permission mode onto external agent",
        { error, kind: externalAgentKindForSessionId(sessionId), sessionId },
        "warn",
      )
    }
  }

  public setAgentStatus(status: AgentRuntimeStatus): void {
    this.agentStatus = status
    void this.send("agentStatusChanged", { status }).catch((error: unknown) => {
      console.warn("[wanta] failed to emit agent status:", error)
      logDiagnostic("chat-service", "failed to emit agent status", { error, status: status.status }, "warn")
    })
  }

  public setRuntimeCapabilities(capabilities: RuntimeCapabilities): void {
    this.runtimeCapabilities = capabilities
    void this.send("runtimeCapabilitiesChanged", { capabilities }).catch((error: unknown) => {
      console.warn("[wanta] failed to emit runtime capabilities:", error)
      logDiagnostic("chat-service", "failed to emit runtime capabilities", { error, mode: capabilities.mode }, "warn")
    })
  }

  public setLinkRuntime(runtime: ActiveLinkRuntime): void {
    this.activeLinkRuntime = runtime
  }

  public hasActiveGeneration(): boolean {
    return this.activeAssistantMessages.size > 0 || this.turnOutputs.size > 0 || this.generations.size > 0
  }

  /** 会话永久删除后释放运行态索引，并删除授权/停止 overlay。 */
  public async forgetSession(sessionId: string): Promise<void> {
    this.turnOutputs.delete(sessionId)
    this.turnOutputs.clearPending(sessionId)
    this.clearSessionGeneration(sessionId)
    this.activeAssistantMessages.delete(sessionId)
    this.activeToolParts.delete(sessionId)
    this.connectionFailedSessions.delete(sessionId)
    this.userStops.delete(sessionId)
    this.emittedMessageErrors.delete(sessionId)
    this.clearInternalMessages(sessionId)
    this.compactingSessions.delete(sessionId)
    this.permissions.deleteSession(sessionId)
    this.trustedAccess.deleteSession(sessionId)
    const messageIds = this.managedUserMessageIdsBySession.get(sessionId)
    for (const messageId of messageIds ?? []) {
      this.managedUserMessageIds.delete(messageId)
      this.internalAttachmentPathsByMessage.delete(messageId)
    }
    this.managedUserMessageIdsBySession.delete(sessionId)
    await this.outputPersistence.removeSession(sessionId)
  }

  /** agent 就绪后调用：订阅 OpenCode SSE，转译为 ServerEvents 广播给渲染层。 */
  public startEventBridge(): void {
    if (!this.agent || this.bridged) {
      return
    }
    this.bridged = true
    const emit = this.send.bind(this) as (event: string, data: unknown) => Promise<void>
    this.streamEventBuffer = new ChatStreamEventBuffer((buffered) => {
      this.sendBestEffort(emit, buffered.event, buffered.data, { sessionId: buffered.data.sessionId })
    })
    this.agentUnsubscribe = this.agent.onEvent((event) => {
      if (event.event === "connectionStatus") {
        this.handleAgentConnectionStatus(emit, event.data)
        return
      }
      this.processAgentEvent(emit, event)
    })
  }

  /** Run one normalized agent event through the bridge pipeline (filtering, folding, watchdogs, broadcast). */
  private processAgentEvent(emit: (event: string, data: unknown) => Promise<void>, translated: ChatEmit): void {
    if (translated.event === "usageUpdated") {
      // Already folded into the adapter transcript; the usage meter reads it
      // off messages on reload, mirroring the kernel history path.
      return
    }
    const sourceSessionId = translated.data.sessionId
    const generationSessionId = sourceSessionId ? this.generationWatchdogSessionId(sourceSessionId) : null
    const failedSessionId = generationSessionId ?? sourceSessionId
    if (failedSessionId && this.connectionFailedSessions.has(failedSessionId)) {
      return
    }
    const userStoppedSessionId =
      translated.event === "agentError" && sourceSessionId
        ? [sourceSessionId, generationSessionId]
            .filter((sessionId): sessionId is string => Boolean(sessionId))
            .find((sessionId) => this.userStops.consumeAbort(sessionId, translated.data.message))
        : undefined
    if (translated.event === "agentError" && userStoppedSessionId) {
      const sessionId = generationSessionId ?? userStoppedSessionId
      const messageId = this.activeAssistantMessages.get(sessionId)
      const partIds = [...(this.activeToolParts.get(sessionId) ?? [])]
      const stoppedAt = Date.now()
      if (messageId) {
        void this.rememberStoppedGeneration(sessionId, messageId, partIds, stoppedAt).catch((error: unknown) => {
          console.warn("[wanta] failed to record stopped generation", error)
        })
      }
      void this.finalizeTurnOutput(sessionId, messageId)
        .catch((error: unknown) => {
          console.warn("[wanta] failed to finalize stopped turn output", error)
        })
        .finally(() => {
          this.clearSessionGeneration(sessionId)
          this.activeAssistantMessages.delete(sessionId)
          this.activeToolParts.delete(sessionId)
          this.activeRuns.delete(sessionId)
          this.emitSessionActivity(sessionId)
          this.sendBestEffort(
            emit,
            "generationStopped",
            { sessionId, ...(messageId ? { messageId, partIds, stoppedAt } : {}) },
            { sessionId },
          )
        })
      return
    }
    if (this.userStops.shouldSuppressEvent(translated)) {
      return
    }
    if (
      translated.event === "messageDelta" &&
      translated.data.synthetic === true &&
      this.managedUserMessageIds.has(translated.data.messageId)
    ) {
      return
    }
    if (
      translated.event === "messageAttachment" &&
      this.internalAttachmentPathsByMessage.get(translated.data.messageId)?.has(translated.data.attachment.path)
    ) {
      return
    }
    const activitySessionId = generationSessionId ?? sourceSessionId
    if (activitySessionId) {
      this.generations.clearAcknowledgementWatchdog(activitySessionId)
    }
    if (translated.event === "messageStarted") {
      if (translated.data.internal === true) {
        this.rememberInternalMessage(translated.data.sessionId, translated.data.messageId)
        return
      }
      if (translated.data.role === "user" && this.compactingSessions.has(translated.data.sessionId)) {
        this.rememberInternalMessage(translated.data.sessionId, translated.data.messageId)
        return
      }
      if (translated.data.role === "assistant") {
        this.compactingSessions.delete(translated.data.sessionId)
      }
      if (!this.rememberMessageStarted(translated)) {
        return
      }
    }
    if (
      ("messageId" in translated.data &&
        typeof translated.data.messageId === "string" &&
        this.isInternalMessage(translated.data.sessionId, translated.data.messageId)) ||
      (translated.event === "messageDelta" && translated.data.synthetic === true)
    ) {
      return
    }
    if (translated.event === "assistantActivity" && translated.data.phase === "compacting") {
      this.compactingSessions.add(translated.data.sessionId)
    }
    if (translated.event === "permissionAsked" && this.answerLocalAccessPermission(emit, translated.data.request)) {
      if (generationSessionId) {
        this.generations.clearInactivityWatchdog(generationSessionId)
      }
      return
    }
    const displayed = this.subagentSessions.forDisplay(translated)
    const displayedSessionId = displayed.data.sessionId
    if (sourceSessionId && generationSessionId && sourceSessionId !== generationSessionId && displayed === translated) {
      this.scheduleGenerationInactivityWatchdog(generationSessionId)
      return
    }
    if (translated.event === "permissionAsked") {
      this.rememberPendingPermissionRequest(translated.data.request)
    }
    this.activeRuns.applyEvent(displayed)
    if (translated.event === "messageStarted" && translated.data.role === "assistant") {
      this.activeAssistantMessages.set(translated.data.sessionId, translated.data.messageId)
      this.activeToolParts.set(translated.data.sessionId, new Set())
      const { artifactRoot, processRoot } = this.turnOutputs.consume(translated.data.sessionId)
      if (artifactRoot && processRoot) {
        const activeTurn = this.turnOutputs.forSession(translated.data.sessionId)
        if (activeTurn?.artifactRoot === artifactRoot && activeTurn.processRoot === processRoot) {
          activeTurn.messageId = translated.data.messageId
        }
      }
    }
    if (translated.event === "toolCallStarted") {
      this.activeAssistantMessages.set(translated.data.sessionId, translated.data.messageId)
      const partIds = this.activeToolParts.get(translated.data.sessionId) ?? new Set<string>()
      partIds.add(translated.data.partId)
      this.activeToolParts.set(translated.data.sessionId, partIds)
      this.activeRuns.update(translated.data.sessionId, {
        activeAssistantMessageId: translated.data.messageId,
        activeToolPartIds: [...partIds],
        phase: "tool_running",
      })
      const childSessionId = taskChildSessionId(translated.data)
      if (childSessionId) {
        this.subagentSessions.remember(translated.data.sessionId, childSessionId)
        void this.agent
          ?.inheritSessionKnowledgeBaseIds(translated.data.sessionId, childSessionId)
          .catch((error: unknown) => {
            console.warn("[wanta] failed to inherit task subagent knowledge scope:", error)
          })
      }
    }
    if (translated.event === "toolCallResult") {
      const partIds = this.activeToolParts.get(translated.data.sessionId)
      partIds?.delete(translated.data.partId)
      if (partIds?.size === 0) {
        this.activeToolParts.delete(translated.data.sessionId)
      }
      this.activeRuns.update(translated.data.sessionId, {
        activeAssistantMessageId: translated.data.messageId,
        activeToolPartIds: partIds ? [...partIds] : [],
        phase: partIds && partIds.size > 0 ? "tool_running" : "thinking",
      })
      const childSessionId = taskChildSessionId(translated.data)
      if (childSessionId) {
        this.subagentSessions.forget(translated.data.sessionId, childSessionId)
        void this.agent?.clearSessionKnowledgeBaseIds(childSessionId).catch((error: unknown) => {
          console.warn("[wanta] failed to clear task subagent knowledge scope:", error)
        })
      }
      if (translated.data.authorization) {
        void this.rememberAuthorizationOverlay(
          translated.data.sessionId,
          translated.data.messageId,
          translated.data.partId,
          translated.data.authorization,
        ).catch((error: unknown) => {
          console.warn("[wanta] failed to record authorization overlay", error)
        })
      }
    }
    if (translated.event === "agentError" && translated.data.sessionId) {
      const sessionId = translated.data.sessionId
      this.compactingSessions.delete(sessionId)
      this.generations.clearInactivityWatchdog(sessionId)
      void this.interruptSessionGeneration(emit, sessionId, "runtime_error", translated.data.message, {
        abortAgent: false,
      })
      return
    }
    if (translated.event === "messageCompleted") {
      const sessionId = translated.data.sessionId
      this.clearInternalMessages(sessionId)
      this.compactingSessions.delete(sessionId)
      const generation = this.generations.get(sessionId)
      if (generation) void this.completeSessionGeneration(emit, sessionId, generation)
      return
    }
    if (sourceSessionId) {
      if (inactivityWatchdogActionForEvent(displayed.event) === "pause") {
        if (generationSessionId) {
          this.generations.clearInactivityWatchdog(generationSessionId)
        }
      } else if (generationSessionId) {
        this.scheduleGenerationInactivityWatchdog(generationSessionId)
      }
    }
    if ((displayed.event === "messageDelta" || displayed.event === "messageReasoningDelta") && this.streamEventBuffer) {
      this.eventMetrics.record(`stream-input:${displayed.event}`)
      this.streamEventBuffer.enqueue(displayed)
    } else {
      this.sendBestEffort(emit, displayed.event, displayed.data, { sessionId: displayedSessionId })
    }
  }

  private handleAgentConnectionStatus(
    emit: (event: string, data: unknown) => Promise<void>,
    status: AgentConnectionStatus,
  ): void {
    if (status.status === "runtime_restarting") {
      this.setAgentStatus({ status: "starting" })
    } else if (status.status === "runtime_recovered") {
      this.setAgentStatus({ status: "ready" })
    } else if (status.status === "runtime_failed") {
      this.setAgentStatus({ status: "error", message: status.message ?? "OpenCode runtime failed to restart." })
    }
    const sessionIds = new Set<string>([
      ...this.generations.keys(),
      ...this.activeAssistantMessages.keys(),
      ...this.turnOutputs.pendingSessionIds(),
    ])
    if (sessionIds.size === 0) {
      return
    }
    const terminal = terminalConnectionInterruption(status)
    for (const sessionId of sessionIds) {
      const messageId = this.activeAssistantMessages.get(sessionId)
      this.sendBestEffort(
        emit,
        "agentConnectionChanged",
        {
          sessionId,
          ...(messageId ? { messageId } : {}),
          status: status.status,
          ...(status.attempt ? { attempt: status.attempt } : {}),
          ...(status.maxAttempts ? { maxAttempts: status.maxAttempts } : {}),
          ...(status.message ? { message: status.message } : {}),
          createdAt: Date.now(),
        },
        { messageId, sessionId },
      )
      if (!terminal) {
        continue
      }
      this.connectionFailedSessions.add(sessionId)
      void this.interruptSessionGeneration(emit, sessionId, terminal.reason, terminal.message, {
        abortAgent: false,
      })
    }
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
    const payload = createMessageErrorPayload(sessionId, message, this.runtimeCapabilities.mode, messageId)
    if (payload.errorKind === "auth_required") {
      void Promise.resolve(this.deps.onOomolAuthRequired?.()).catch((error: unknown) => {
        console.warn("[wanta] failed to expire OOMOL session after chat 401:", error)
        logDiagnostic("chat-service", "failed to expire OOMOL session after chat 401", { error }, "warn")
      })
    }
    this.sendBestEffort(emit, "messageError", payload, {
      messageId,
      sessionId,
    })
  }

  private sendBestEffort(
    emit: (event: string, data: unknown) => Promise<void>,
    event: string,
    data: unknown,
    context: { messageId?: string; sessionId?: string } = {},
  ): void {
    if (event !== "messageDelta" && event !== "messageReasoningDelta") {
      this.streamEventBuffer?.flush(context.sessionId)
    }
    this.eventMetrics.record(`ipc:${event}`)
    void emit(event, data).catch((error: unknown) => {
      console.warn("[wanta] failed to emit chat server event:", { event, error, ...context })
      logDiagnostic(
        "chat-service",
        "failed to emit chat server event",
        {
          event,
          error,
          ...context,
        },
        "warn",
      )
    })
  }

  private rememberMessageStarted(event: Extract<ChatEmit, { event: "messageStarted" }>): boolean {
    const key = `${event.data.sessionId}\0${event.data.messageId}\0${event.data.role}`
    if (this.startedMessages.has(key)) {
      return false
    }
    while (this.startedMessages.size >= startedMessageLimit) {
      const oldest = this.startedMessages.values().next().value
      if (typeof oldest !== "string") {
        break
      }
      this.startedMessages.delete(oldest)
    }
    this.startedMessages.add(key)
    return true
  }

  private rememberInternalMessage(sessionId: string, messageId: string): void {
    this.internalMessageIds.add(`${sessionId}\0${messageId}`)
  }

  private isInternalMessage(sessionId: string, messageId: string): boolean {
    return this.internalMessageIds.has(`${sessionId}\0${messageId}`)
  }

  private clearInternalMessages(sessionId: string): void {
    const prefix = `${sessionId}\0`
    for (const key of this.internalMessageIds) {
      if (key.startsWith(prefix)) {
        this.internalMessageIds.delete(key)
      }
    }
  }

  private createActiveRun(req: SendMessageRequest, generation: SessionGeneration): void {
    this.activeRuns.create(req.sessionId, generation.id, runWorkspaceFromRequest(req))
  }

  private sessionPermissionMode(sessionId: string): AgentPermissionMode {
    return this.permissions.mode(sessionId)
  }

  private setSessionPermissionModeValue(sessionId: string, mode: AgentPermissionMode, version?: number): boolean {
    return this.permissions.setMode(sessionId, mode, version)
  }

  private addSessionPermissionGrant(sessionId: string, request: ChatPermissionRequest): void {
    const trustedProjectRoot = this.trustedAccess.projectRoot(sessionId)
    const generationId = this.generations.get(sessionId)?.id
    const managedPythonProcessRoot = generationId ? this.turnOutputs.get(generationId)?.processRoot : undefined
    const candidate = localAccessGrantForRequest(request, {
      ...(trustedProjectRoot ? { trustedProjectRoot } : {}),
      ...(managedPythonProcessRoot ? { managedPythonProcessRoot } : {}),
    })
    if (!candidate) {
      return
    }
    const grant =
      candidate.kind === "python_dependency_install" && generationId ? { ...candidate, generationId } : candidate
    this.permissions.addGrant(sessionId, grant)
    this.rememberTrustedPermissionResources(sessionId, request)
  }

  private removeGenerationPermissionGrants(sessionId: string, generationId: string | undefined): void {
    this.permissions.removeGenerationGrants(sessionId, generationId)
  }

  private rememberPendingPermissionRequest(request: ChatPermissionRequest): void {
    this.permissions.rememberPending(request)
  }

  private forgetPendingPermissionRequest(sessionId: string, requestId: string): void {
    this.permissions.forgetPending(sessionId, requestId)
  }

  private forgetSessionPendingPermissionRequests(sessionId: string): void {
    this.permissions.forgetSessionPending(sessionId)
  }

  private pendingPermissionRequest(sessionId: string, requestId: string): ChatPermissionRequest | undefined {
    const directRequest = this.permissions.pending(sessionId, requestId)
    if (directRequest) return directRequest
    for (const childSessionId of this.subagentSessions.childSessionIds(sessionId)) {
      const childRequest = this.permissions.pending(childSessionId, requestId)
      if (childRequest) return childRequest
    }
    return undefined
  }

  private answerLocalAccessPermission(
    emit: (event: string, data: unknown) => Promise<void>,
    request: ChatPermissionRequest,
  ): boolean {
    const displaySessionId = this.subagentSessions.displaySessionId(request.sessionId)
    const projectRoot = this.trustedAccess.projectRoot(request.sessionId)
    const activeGenerationId = this.generations.get(displaySessionId)?.id
    const taskProcessRoot = activeGenerationId ? this.turnOutputs.get(activeGenerationId)?.processRoot : undefined
    // Keyed off the session id's kind, so a malformed external id still fails
    // closed (prompt) instead of falling through to the kernel's defaults.
    const isExternalSession = externalAgentKindForSessionId(request.sessionId) !== undefined
    const decision = evaluateLocalAccessRequest(request, {
      activeGenerationId,
      linkRuntime: this.activeLinkRuntime,
      permissionMode: this.sessionPermissionMode(request.sessionId),
      sessionGrants: this.permissions.sessionGrants(request.sessionId),
      ...(taskProcessRoot ? { taskProcessRoot } : {}),
      ...(projectRoot ? { trustedProjectRoot: projectRoot } : {}),
      ...(isExternalSession ? { isExternalSession } : {}),
    })
    // External sessions answer through their own adapter; only a session with
    // no backend at all falls through to the manual card.
    if (!this.chatBackendFor(request.sessionId)) {
      return false
    }
    if (decision.type === "prompt") {
      const promptReason = localAccessPromptReason(request)
      this.permissionDiagnostics.recordPrompt(promptReason, `${request.sessionId}:${request.id}`)
      request.wanta = { ...request.wanta, promptReason }
      logDiagnostic(
        "chat-service",
        "local permission requires confirmation",
        {
          action: request.action,
          hasActiveGeneration: Boolean(activeGenerationId),
          hasTaskProcessRoot: Boolean(taskProcessRoot),
          hasTrustedProjectRoot: Boolean(projectRoot),
          highRisk: decision.highRisk,
          kind: decision.kind,
          reason: promptReason,
          sessionId: displaySessionId,
          subagent: displaySessionId !== request.sessionId,
        },
        "info",
      )
      return false
    }
    if (!this.permissions.beginAutomaticReply(request.sessionId, request.id)) {
      return true
    }
    void this.answerAutomaticPermission(request, decision.type === "deny" ? "reject" : "once")
      .then(() => {
        if (decision.type === "allow") this.rememberTrustedPermissionResources(request.sessionId, request)
        this.sendBestEffort(
          emit,
          "permissionReplied",
          { sessionId: displaySessionId, requestId: request.id },
          { sessionId: displaySessionId },
        )
        this.forgetPendingPermissionRequest(request.sessionId, request.id)
        this.activeRuns.removeBlockingRequest(displaySessionId, request.id)
        this.scheduleGenerationInactivityWatchdogAfterReply(displaySessionId)
      })
      .catch((error: unknown) => {
        console.warn("[wanta] failed to approve local access permission:", error)
        logDiagnostic(
          "chat-service",
          "failed to approve local access permission",
          {
            action: request.action,
            error,
            reason: decision.type === "allow" ? decision.reason : "openconnector_denied",
            sessionId: request.sessionId,
          },
          "warn",
        )
        const failedRequest: ChatPermissionRequest = {
          ...request,
          wanta: {
            ...request.wanta,
            automaticReplyFailed: true,
            promptReason: "automatic_reply_failed",
          },
        }
        const failedDisplayRequest =
          displaySessionId === request.sessionId ? failedRequest : { ...failedRequest, sessionId: displaySessionId }
        this.permissionDiagnostics.recordPrompt("automatic_reply_failed", `${request.sessionId}:${request.id}`)
        this.rememberPendingPermissionRequest(failedRequest)
        this.activeRuns.addBlockingRequest(displaySessionId, request.id, "awaiting_permission")
        this.sendBestEffort(
          emit,
          "permissionAsked",
          { sessionId: displaySessionId, request: failedDisplayRequest },
          { sessionId: displaySessionId },
        )
      })
      .finally(() => {
        this.permissions.endAutomaticReply(request.sessionId, request.id)
      })
    return true
  }

  private async answerAutomaticPermission(request: ChatPermissionRequest, reply: "once" | "reject"): Promise<void> {
    const backend = this.chatBackendFor(request.sessionId)
    if (!backend) throw new Error("Agent not configured")
    let lastError: unknown
    for (let attempt = 1; attempt <= 2; attempt += 1) {
      try {
        await backend.send({
          type: "permission-response",
          sessionId: request.sessionId,
          requestId: request.id,
          reply,
        })
        this.permissionDiagnostics.recordAutomaticReply(attempt === 1 ? "first_attempt" : "retry_succeeded")
        return
      } catch (error) {
        lastError = error
        try {
          const stillPending = (await backend.getPendingPermissions(request.sessionId)).some(
            (pending) => pending.id === request.id,
          )
          if (!stillPending) {
            this.permissionDiagnostics.recordAutomaticReply("reconciled")
            return
          }
        } catch {
          // A failed reconciliation must not hide the original reply failure.
        }
        if (attempt < 2) {
          await new Promise<void>((resolve) => setTimeout(resolve, automaticPermissionRetryDelayMs))
        }
      }
    }
    this.permissionDiagnostics.recordAutomaticReply("failed")
    throw lastError
  }

  private async autoAnswerPendingPermissions(
    sessionId: string,
    emit: (event: string, data: unknown) => Promise<void> = this.send.bind(this) as (
      event: string,
      data: unknown,
    ) => Promise<void>,
  ): Promise<void> {
    const backend = this.chatBackendFor(sessionId)
    if (!backend) {
      return
    }
    let permissions: ChatPermissionRequest[]
    try {
      permissions = await backend.getPendingPermissions(sessionId)
    } catch (error) {
      console.warn("[wanta] failed to inspect pending permissions:", error)
      logDiagnostic("chat-service", "failed to inspect pending permissions", { error, sessionId }, "warn")
      return
    }
    for (const request of permissions) {
      this.answerLocalAccessPermission(emit, request)
    }
  }

  private rememberTrustedAttachments(sessionId: string, attachments: readonly ChatAttachment[] | undefined): void {
    this.trustedAccess.rememberAttachments(sessionId, attachments)
  }

  private rememberTrustedMessageAttachments(sessionId: string, messages: readonly ChatMessage[]): void {
    this.trustedAccess.rememberMessageAttachments(sessionId, messages)
  }

  private rememberTrustedPermissionResources(sessionId: string, request: ChatPermissionRequest): void {
    this.trustedAccess.rememberPermissionResources(sessionId, request)
  }

  private invalidateTrustedLocalPathRoots(): void {
    this.trustedAccess.invalidate()
  }

  private async trustedLocalPathRoots(): Promise<string[]> {
    return this.trustedAccess.roots()
  }

  private async loadAdditionalTrustedRoots(): Promise<Iterable<string>> {
    const roots = new Set<string>()
    for (const active of this.turnOutputs.activeValues()) {
      roots.add(active.artifactRoot)
      roots.add(active.processRoot)
      if (active.projectRoot) {
        roots.add(active.projectRoot)
      }
      if (active.outputProjectRoot) {
        roots.add(active.outputProjectRoot)
      }
    }
    const [artifactBundles, turnOutputs] = await Promise.all([this.readArtifactBundles(), this.readTurnOutputs()])
    for (const records of artifactBundles.values()) {
      for (const bundle of records.values()) {
        roots.add(bundle.rootPath)
        for (const item of bundle.items) roots.add(item.path)
      }
    }
    for (const records of turnOutputs.values()) {
      for (const record of records.values()) {
        if (record.processRoot) {
          roots.add(record.processRoot)
        }
        if (record.projectRoot) {
          roots.add(record.projectRoot)
        }
      }
    }
    try {
      const projects = await this.deps.projectStore?.read()
      for (const project of projects?.values() ?? []) {
        if (!project.archivedAt) {
          roots.add(project.path)
        }
      }
    } catch (error) {
      console.warn("[wanta] failed to read trusted project roots:", error)
      logDiagnostic("chat-service", "failed to read trusted project roots", { error }, "warn")
    }
    return roots
  }

  private async isPathInTrustedRoots(filePath: string, roots: readonly string[]): Promise<boolean> {
    return this.trustedAccess.isPathInRoots(filePath, roots)
  }

  private async assertTrustedLocalPath(filePath: string): Promise<void> {
    await this.trustedAccess.assertPath(filePath)
  }

  private async assertTrustedAttachments(attachments: readonly ChatAttachment[] | undefined): Promise<void> {
    if (!attachments?.length) return
    const roots = await this.trustedLocalPathRoots()
    for (const attachment of attachments) {
      const filePaths = [attachment.path, attachment.agentPath].filter((filePath): filePath is string =>
        Boolean(filePath?.trim()),
      )
      for (const filePath of filePaths) {
        if (!(await this.isPathInTrustedRoots(filePath, roots))) {
          throw new Error("Attachment path was not selected or previously authorized by the user.")
        }
      }
    }
  }

  private beginSessionGeneration(sessionId: string, userMessageId: string): SessionGeneration {
    const { generation, previous } = this.generations.begin(sessionId, userMessageId)
    this.removeGenerationPermissionGrants(sessionId, previous?.id)
    return generation
  }

  /** session.idle 不带 message/generation id；用本轮用户消息核对历史，避免旧 idle 结束刚重试的新轮次。 */
  private async completeSessionGeneration(
    emit: (event: string, data: unknown) => Promise<void>,
    sessionId: string,
    generation: SessionGeneration,
  ): Promise<void> {
    const completionKey = `${sessionId}\0${generation.id}`
    if (this.completionChecks.has(completionKey)) return
    this.clearCompletionRetry(completionKey, false)
    this.completionChecks.add(completionKey)
    try {
      if (!(await this.currentTurnIsComplete(sessionId, generation))) {
        this.scheduleCompletionRetry(emit, sessionId, generation)
        return
      }
      if (!this.isCurrentGeneration(sessionId, generation.id)) return
      this.clearCompletionRetry(completionKey)
      const messageId = this.activeAssistantMessages.get(sessionId)
      const completedRun = this.activeRuns.get(sessionId)
      this.generations.clearInactivityWatchdog(sessionId)
      await this.finalizeTurnOutput(sessionId, messageId).catch((error: unknown) => {
        console.warn("[wanta] failed to finalize turn output", error)
      })
      if (!this.isCurrentGeneration(sessionId, generation.id)) return
      this.clearSessionGeneration(sessionId, generation.id)
      this.activeAssistantMessages.delete(sessionId)
      this.activeToolParts.delete(sessionId)
      this.activeRuns.delete(sessionId, generation.id)
      this.emitSessionActivity(sessionId)
      this.sendBestEffort(emit, "messageCompleted", { sessionId }, { sessionId })
      if (completedRun?.workspace.kind === "team") {
        void Promise.resolve(
          this.deps.onSessionCompleted?.({
            teamId: completedRun.workspace.teamId,
            runId: completedRun.runId,
            sessionId,
          }),
        ).catch((error: unknown) => {
          console.warn("[wanta] failed to record completed task attention:", error)
        })
      }
    } finally {
      this.completionChecks.delete(completionKey)
    }
  }

  private async currentTurnIsComplete(sessionId: string, generation: SessionGeneration): Promise<boolean> {
    const backend = this.chatBackendFor(sessionId)
    if (!backend) return false
    const messages = await withTimeout(backend.getMessages(sessionId), 1_000, "idle history verification").catch(
      () => null,
    )
    if (!messages || messages.length === 0) return false
    const userIndex = messages.findIndex(
      (message) => message.id === generation.userMessageId && message.role === "user",
    )
    const assistantId = this.activeAssistantMessages.get(sessionId)
    const activeAssistant = assistantId
      ? messages.find((message) => message.id === assistantId && message.role === "assistant")
      : undefined
    const assistant =
      activeAssistant ??
      (userIndex >= 0 ? messages.slice(userIndex + 1).find((message) => message.role === "assistant") : undefined)
    return Boolean(assistant?.finishReason || assistant?.completedAt !== undefined)
  }

  private scheduleCompletionRetry(
    emit: (event: string, data: unknown) => Promise<void>,
    sessionId: string,
    generation: SessionGeneration,
  ): void {
    if (!this.isCurrentGeneration(sessionId, generation.id)) return
    const completionKey = `${sessionId}\0${generation.id}`
    if (this.completionRetryTimers.has(completionKey)) return
    const attempt = this.completionRetryAttempts.get(completionKey) ?? 0
    if (attempt >= completionRetryMaxAttempts) {
      this.clearCompletionRetry(completionKey)
      void this.interruptSessionGeneration(
        emit,
        sessionId,
        "runtime_error",
        "Unable to verify that the completed response was saved. Please retry the request.",
        { abortAgent: false },
      )
      return
    }
    const delay = Math.min(completionRetryInitialDelayMs * 2 ** Math.min(attempt, 6), completionRetryMaxDelayMs)
    this.completionRetryAttempts.set(completionKey, attempt + 1)
    const timer = setTimeout(() => {
      this.completionRetryTimers.delete(completionKey)
      if (this.isCurrentGeneration(sessionId, generation.id)) {
        void this.completeSessionGeneration(emit, sessionId, generation)
      } else {
        this.completionRetryAttempts.delete(completionKey)
      }
    }, delay)
    timer.unref()
    this.completionRetryTimers.set(completionKey, timer)
  }

  private clearCompletionRetry(completionKey: string, clearAttempts = true): void {
    const timer = this.completionRetryTimers.get(completionKey)
    if (timer) clearTimeout(timer)
    this.completionRetryTimers.delete(completionKey)
    if (clearAttempts) this.completionRetryAttempts.delete(completionKey)
  }

  private clearAllCompletionRetries(): void {
    for (const timer of this.completionRetryTimers.values()) clearTimeout(timer)
    this.completionRetryTimers.clear()
    this.completionRetryAttempts.clear()
  }

  private isCurrentGeneration(sessionId: string, generationId: string): boolean {
    return this.generations.isCurrent(sessionId, generationId)
  }

  private clearSessionGeneration(sessionId: string, generationId?: string): void {
    const generation = this.generations.get(sessionId)
    if (generationId && generation?.id !== generationId) {
      return
    }
    this.clearInternalMessages(sessionId)
    this.compactingSessions.delete(sessionId)
    if (generation) this.clearCompletionRetry(`${sessionId}\0${generation.id}`)
    this.generations.clear(sessionId, generationId)
    const childSessionIds = this.subagentSessions.childSessionIds(sessionId)
    this.subagentSessions.forgetAll(sessionId)
    this.forgetSessionPendingPermissionRequests(sessionId)
    this.removeGenerationPermissionGrants(sessionId, generation?.id)
    this.activeRuns.delete(sessionId, generationId)
    const agent = this.agent
    if (agent) {
      void Promise.all([
        agent.clearSessionTeamName(sessionId),
        agent.clearSessionKnowledgeBaseIds(sessionId),
        ...childSessionIds.map((childSessionId) => agent.clearSessionKnowledgeBaseIds(childSessionId)),
      ]).catch((error: unknown) => {
        console.warn("[wanta] failed to clear session agent scope:", error)
      })
    }
  }

  private scheduleGenerationStartWatchdog(sessionId: string, generationId: string): void {
    this.generations.scheduleAcknowledgementWatchdog(sessionId, generationId, generationStartAckTimeoutMs, () => {
      console.warn("[wanta] generation did not receive an OpenCode event before timeout:", { sessionId })
      logDiagnostic("chat-service", "generation did not receive opencode event before timeout", { sessionId }, "warn")
      void this.interruptSessionGeneration(
        this.send.bind(this) as (event: string, data: unknown) => Promise<void>,
        sessionId,
        "start_timeout",
        "CHAT_COMPLETION_INTERRUPTED: Agent runtime did not acknowledge this message. Please retry.",
        { abortAgent: true },
      )
    })
  }

  private scheduleGenerationSubmitWatchdog(sessionId: string, generationId: string): void {
    this.generations.scheduleAcknowledgementWatchdog(sessionId, generationId, generationSubmitTimeoutMs, () => {
      console.warn("[wanta] generation was not accepted by OpenCode before timeout:", { sessionId })
      logDiagnostic("chat-service", "generation was not accepted by opencode before timeout", { sessionId }, "warn")
      void this.interruptSessionGeneration(
        this.send.bind(this) as (event: string, data: unknown) => Promise<void>,
        sessionId,
        "submit_timeout",
        "CHAT_COMPLETION_INTERRUPTED: Agent runtime did not accept this message. Please retry.",
        { abortAgent: true },
      )
    })
  }

  private generationInactivityTimeoutForSession(sessionId: string): number {
    return (this.activeToolParts.get(sessionId)?.size ?? 0) > 0
      ? generationActiveToolInactivityTimeoutMs
      : generationInactivityTimeoutMs
  }

  private scheduleGenerationInactivityWatchdog(sessionId: string): void {
    const generation = this.generations.get(sessionId)
    if (!generation) {
      return
    }
    const timeoutMs = this.generationInactivityTimeoutForSession(sessionId)
    this.generations.scheduleInactivityWatchdog(sessionId, timeoutMs, () => {
      const noticeKind = generationNoticeKindForInactivity({
        activeToolCount: this.activeToolParts.get(sessionId)?.size ?? 0,
        blocked: Boolean(this.activeRuns.blockingPhase(sessionId)),
      })
      if (!noticeKind) {
        return
      }
      console.warn("[wanta] generation stopped receiving OpenCode events before completion:", {
        noticeKind,
        sessionId,
        timeoutMs,
      })
      logDiagnostic(
        "chat-service",
        "generation has not received opencode events recently",
        { noticeKind, sessionId, timeoutMs },
        "warn",
      )
      this.emitGenerationNotice(
        this.send.bind(this) as (event: string, data: unknown) => Promise<void>,
        sessionId,
        noticeKind,
      )
    })
  }

  private emitGenerationNotice(
    emit: (event: string, data: unknown) => Promise<void>,
    sessionId: string,
    kind: GenerationNoticeKind,
  ): void {
    const messageId = this.activeAssistantMessages.get(sessionId)
    const partIds = [...(this.activeToolParts.get(sessionId) ?? [])]
    this.sendBestEffort(
      emit,
      "generationNotice",
      {
        sessionId,
        ...(messageId ? { messageId } : {}),
        ...(partIds.length > 0 ? { partIds } : {}),
        createdAt: Date.now(),
        kind,
      },
      { messageId, sessionId },
    )
  }

  private async interruptSessionGeneration(
    emit: (event: string, data: unknown) => Promise<void>,
    sessionId: string,
    reason: GenerationInterruptedReason,
    message: string,
    options: { abortAgent: boolean },
  ): Promise<void> {
    const messageId = this.activeAssistantMessages.get(sessionId)
    const partIds = [...(this.activeToolParts.get(sessionId) ?? [])]
    const interruptedAt = Date.now()
    await this.stopSessionGeneration(sessionId, {
      abortAgent: options.abortAgent,
      reason: "system",
      throwOnAbortFailure: false,
    })
    this.sendBestEffort(
      emit,
      "generationInterrupted",
      {
        sessionId,
        ...(messageId ? { messageId } : {}),
        ...(partIds.length > 0 ? { partIds } : {}),
        interruptedAt,
        reason,
        message,
      },
      { messageId, sessionId },
    )
    this.emitMessageError(emit, sessionId, message, messageId)
  }

  private generationWatchdogSessionId(sessionId: string): string | null {
    if (this.generations.has(sessionId)) {
      return sessionId
    }
    const parentSessionId = this.subagentSessions.parentSessionId(sessionId)
    if (parentSessionId && this.generations.has(parentSessionId)) {
      return parentSessionId
    }
    return null
  }

  private scheduleGenerationInactivityWatchdogAfterReply(sessionId: string): void {
    const generationSessionId = this.generationWatchdogSessionId(sessionId)
    if (generationSessionId) {
      this.scheduleGenerationInactivityWatchdog(generationSessionId)
    }
  }

  private async runWithScopeMutation<T>(task: () => Promise<T>): Promise<T> {
    const previous = this.scopeMutationQueue
    let releaseCurrent!: () => void
    const current = new Promise<void>((resolve) => {
      releaseCurrent = resolve
    })
    this.scopeMutationQueue = previous.then(
      () => current,
      () => current,
    )
    await previous.catch(() => undefined)
    try {
      return await task()
    } finally {
      releaseCurrent()
    }
  }

  private async stopSessionGeneration(sessionId: string, options: StopSessionGenerationOptions): Promise<void> {
    const backend = this.chatBackendFor(sessionId)
    if (!backend) {
      return
    }
    const generation = this.generations.get(sessionId)
    generation?.controller.abort()
    const messageId = this.activeAssistantMessages.get(sessionId)
    const partIds = [...(this.activeToolParts.get(sessionId) ?? [])]
    const stoppedAt = Date.now()
    if (options.abortAgent) {
      try {
        await backend.send({ type: "cancel", sessionId })
      } catch (error) {
        if (options.throwOnAbortFailure && (messageId || !generation)) {
          this.userStops.delete(sessionId)
          throw error
        }
        console.warn("[wanta] generation abort failed:", error)
      }
    }
    if (options.reason === "user" && messageId) {
      await this.rememberStoppedGeneration(sessionId, messageId, partIds, stoppedAt).catch((error: unknown) => {
        console.warn("[wanta] failed to record stopped generation", error)
      })
    }
    await this.finalizeTurnOutput(sessionId, messageId).catch((error: unknown) => {
      console.warn("[wanta] failed to finalize stopped turn output", error)
    })
    this.clearSessionGeneration(sessionId, generation?.id)
    this.turnOutputs.clearPending(sessionId)
    this.turnOutputs.delete(sessionId, generation?.id)
    this.activeAssistantMessages.delete(sessionId)
    this.activeToolParts.delete(sessionId)
    if (options.reason === "user") {
      await this.send("generationStopped", {
        sessionId,
        ...(messageId ? { messageId, partIds, stoppedAt } : {}),
      }).catch((error: unknown) => {
        console.warn("[wanta] failed to emit generation stopped:", error)
        logDiagnostic("chat-service", "failed to emit generation stopped", { error, sessionId }, "warn")
      })
    }
  }

  public async isReady(): Promise<boolean> {
    return this.agentStatus.status === "ready" && (this.agent?.isReady() ?? false)
  }

  public async getAgentStatus(): Promise<AgentRuntimeStatus> {
    return this.agentStatus
  }

  public async getRuntimeCapabilities(): Promise<RuntimeCapabilities> {
    return this.runtimeCapabilities
  }

  public async getActiveRuns(): Promise<ChatActiveRun[]> {
    return [...this.activeRuns.values()]
  }

  public async getActiveRun(sessionId: string): Promise<ChatActiveRun | null> {
    return this.activeRuns.get(sessionId) ?? null
  }

  public async getSessionSnapshot(sessionId: string): Promise<ChatSessionSnapshot> {
    const [messages, pendingQuestions, pendingPermissions] = await Promise.all([
      this.getMessages(sessionId),
      this.getPendingQuestions(sessionId),
      this.getPendingPermissions(sessionId),
    ])
    return {
      activeRun: this.activeRuns.get(sessionId) ?? null,
      messages,
      pendingPermissions,
      pendingQuestions,
      sessionId,
    }
  }

  public async sendMessage(req: SendMessageRequest): Promise<void> {
    const externalKind = externalAgentKindForSessionId(req.sessionId)
    if (externalKind) {
      return this.sendExternalMessage(req, externalKind)
    }
    if (!this.agent) {
      throw new Error("Agent not configured (sign in first)")
    }
    if (this.generations.has(req.sessionId)) {
      throw new Error("A generation is already active for this session.")
    }
    await this.assertTrustedAttachments(req.attachments)
    this.setSessionPermissionModeValue(
      req.sessionId,
      req.permissionMode ?? this.sessionPermissionMode(req.sessionId),
      req.permissionModeVersion,
    )
    const userMessageId = createOpencodeMessageId()
    const teamName = teamNameFromRequest(req)
    const bugReport = parseBugReportCommand(req.text)
    let generation: SessionGeneration | undefined
    let artifactDir: string | undefined
    let processDir: string | undefined
    let attachmentsRecorded = false
    let submitted = false
    try {
      if (req.attachments?.length) {
        await this.deps.userAttachmentStore?.record(req.sessionId, userMessageId, req.attachments, req.text)
        attachmentsRecorded = true
        this.managedUserMessageIds.add(userMessageId)
        const sessionMessageIds = this.managedUserMessageIdsBySession.get(req.sessionId) ?? new Set<string>()
        sessionMessageIds.add(userMessageId)
        this.managedUserMessageIdsBySession.set(req.sessionId, sessionMessageIds)
        this.internalAttachmentPathsByMessage.set(
          userMessageId,
          new Set(
            req.attachments
              .map((attachment) => attachment.agentPath?.trim())
              .filter((value): value is string => Boolean(value)),
          ),
        )
      }
      generation = this.beginSessionGeneration(req.sessionId, userMessageId)
      this.createActiveRun(req, generation)
      const activeGeneration = generation
      this.userStops.delete(req.sessionId)
      this.connectionFailedSessions.delete(req.sessionId)
      this.clearMessageErrorSignatures(req.sessionId)
      this.emitSessionActivity(req.sessionId)
      const knowledgeBaseIds = (req.contextMentions ?? []).flatMap((mention) =>
        mention.kind === "knowledge" && mention.id.trim() ? [mention.id.trim()] : [],
      )
      await Promise.all([
        this.agent.setSessionTeamName(req.sessionId, teamName),
        this.agent.setSessionKnowledgeBaseIds(req.sessionId, knowledgeBaseIds),
      ])
      if (!this.isCurrentGeneration(req.sessionId, activeGeneration.id) || activeGeneration.controller.signal.aborted) {
        this.clearSessionGeneration(req.sessionId, activeGeneration.id)
        await removeUnsubmittedTurnDirectories(artifactDir, processDir)
        if (attachmentsRecorded) {
          await this.rollbackUnsubmittedUserAttachments(req.sessionId, userMessageId, req.attachments)
        }
        return
      }
      const trustedProjectRoot = await this.resolveTrustedProjectRoot(req.projectContext)
      const execution = resolveChatTurnExecution({
        ...(bugReport ? { forcedMode: "build" } : {}),
        requestedMode: req.mode,
        ...(trustedProjectRoot ? { trustedProjectRoot } : {}),
      })
      const artifactProjectRoot = execution.artifactProjectRoot
      const [artifactDirectoryResult, processDirectoryResult] = await Promise.allSettled([
        this.agent.createArtifactDir(req.sessionId, artifactProjectRoot),
        this.agent.createProcessDir(req.sessionId),
      ])
      if (artifactDirectoryResult.status === "fulfilled") artifactDir = artifactDirectoryResult.value
      if (processDirectoryResult.status === "fulfilled") processDir = processDirectoryResult.value
      const directoryErrors = [artifactDirectoryResult, processDirectoryResult]
        .filter((result): result is PromiseRejectedResult => result.status === "rejected")
        .map((result) => result.reason)
      if (directoryErrors.length === 1) throw directoryErrors[0]
      if (directoryErrors.length > 1) throw new AggregateError(directoryErrors, "Failed to create turn directories")
      if (!artifactDir || !processDir) throw new Error("Turn directory creation returned an empty path")
      if (!this.isCurrentGeneration(req.sessionId, activeGeneration.id) || activeGeneration.controller.signal.aborted) {
        this.clearSessionGeneration(req.sessionId, activeGeneration.id)
        await removeUnsubmittedTurnDirectories(artifactDir, processDir)
        if (attachmentsRecorded) {
          await this.rollbackUnsubmittedUserAttachments(req.sessionId, userMessageId, req.attachments)
        }
        return
      }
      this.trustedAccess.setProjectRoot(req.sessionId, trustedProjectRoot)
      const project = await this.projectBaseline(req.projectContext)
      const artifactBaseline = await captureArtifactSessionBaseline(
        this.agent.artifactSessionDir(req.sessionId, artifactProjectRoot),
        artifactDir,
      ).catch((error: unknown) => {
        console.warn("[wanta] failed to capture artifact session baseline", error)
        logDiagnostic(
          "chat-service",
          "failed to capture artifact session baseline",
          { error, sessionId: req.sessionId },
          "warn",
        )
        return null
      })
      this.turnOutputs.enqueue(req.sessionId, artifactDir, processDir)
      this.turnOutputs.set(activeGeneration.id, {
        artifactRoot: artifactDir,
        processRoot: processDir,
        createdAt: Date.now(),
        generationId: activeGeneration.id,
        requestText: req.text,
        ...(artifactBaseline ? { artifactBaseline } : {}),
        ...(project.baseline ? { projectBaseline: project.baseline } : {}),
        ...(project.projectRoot ? { projectRoot: project.projectRoot } : {}),
        ...(artifactProjectRoot ? { outputProjectRoot: artifactProjectRoot } : {}),
      })
      const promptGeneration = activeGeneration
      const bugReportSystem = bugReport
        ? buildBugReportSystemPrompt({
            ...(bugReport.note ? { note: bugReport.note } : {}),
            runtime: {
              agentMode: "build",
              appCommit: this.deps.bugReportRuntime?.appCommit ?? "unknown",
              appVersion: this.deps.bugReportRuntime?.appVersion ?? "unknown",
              generatedAt: new Date().toISOString(),
              model: bugReportModelLabel(req.model),
              permissionMode: this.sessionPermissionMode(req.sessionId),
              permissionDiagnostics: this.permissionDiagnostics.snapshot(),
              platform: this.deps.bugReportRuntime?.platform ?? process.platform,
            },
            targetFilePath: path.join(artifactDir, BUG_REPORT_FILE_NAME),
          })
        : undefined
      // promptStreaming 的结果经 SSE 推送；RPC 只确认主进程已接收本轮发送，避免首条消息 UI 等到流式内容已累积后才切换。
      this.rememberTrustedAttachments(req.sessionId, req.attachments)
      this.discardTrustedAttachmentPaths(req.attachments)
      this.activeRuns.update(req.sessionId, { phase: "submitted" })
      submitted = true
      this.scheduleGenerationSubmitWatchdog(req.sessionId, promptGeneration.id)
      void this.agent
        .send(
          {
            type: "prompt",
            sessionId: req.sessionId,
            text: req.text,
            attachments: req.attachments,
            artifactDir,
            outputProjectRoot: artifactProjectRoot,
            processDir,
            mode: execution.mode,
            messageId: userMessageId,
            model: req.model,
            teamName,
            reasoningLevel: req.reasoningLevel,
            system: mergeSystemPrompts(
              buildTeamSkillsSystem(req.teamSkills),
              buildContextMentionsSystemPrompt(req.contextMentions),
              buildProjectContextSystem(req.projectContext),
              buildPermissionModeSystem(req.permissionMode, this.deps.browserAvailable?.() ?? false),
              bugReportSystem,
              buildResponseLanguageSystem(req.appLocale, detectResponseLanguage(req.text)),
            ),
          },
          { signal: promptGeneration.controller.signal },
        )
        .then(() => {
          if (
            this.isCurrentGeneration(req.sessionId, promptGeneration.id) &&
            !promptGeneration.controller.signal.aborted &&
            !this.activeAssistantMessages.has(req.sessionId)
          ) {
            this.scheduleGenerationStartWatchdog(req.sessionId, promptGeneration.id)
          }
        })
        .catch(async (error: unknown) => {
          this.turnOutputs.removePending(req.sessionId, artifactDir, processDir)
          this.turnOutputs.delete(req.sessionId, promptGeneration.id)
          await removeUnsubmittedTurnDirectories(artifactDir, processDir)
          if (
            !this.isCurrentGeneration(req.sessionId, promptGeneration.id) ||
            promptGeneration.controller.signal.aborted
          ) {
            this.clearSessionGeneration(req.sessionId, promptGeneration.id)
            return
          }
          const messageId = this.activeAssistantMessages.get(req.sessionId)
          this.clearSessionGeneration(req.sessionId, promptGeneration.id)
          this.activeAssistantMessages.delete(req.sessionId)
          this.activeToolParts.delete(req.sessionId)
          this.emitMessageError(
            this.send.bind(this) as (event: string, data: unknown) => Promise<void>,
            req.sessionId,
            errorMessage(error),
            messageId,
          )
        })
    } catch (error) {
      if (generation) {
        this.turnOutputs.removePending(req.sessionId, artifactDir, processDir)
        this.turnOutputs.delete(req.sessionId, generation.id)
        this.clearSessionGeneration(req.sessionId, generation.id)
      }
      await removeUnsubmittedTurnDirectories(artifactDir, processDir)
      if (attachmentsRecorded && !submitted) {
        await this.rollbackUnsubmittedUserAttachments(req.sessionId, userMessageId, req.attachments)
      }
      throw error
    }
  }

  /**
   * External (BYOA) turn pipeline: no managed artifact/process directories, no
   * Link/team scope, no Wanta system prompt tail — the agent owns models, auth,
   * and workspace behavior. Wanta contributes run tracking, permission-mode
   * projection, and the shared event bridge.
   */
  private async sendExternalMessage(req: SendMessageRequest, kind: ExternalAgentKind): Promise<void> {
    const adapter = this.externalAgents.get(kind)
    if (!adapter) {
      throw new Error("This agent is not available.")
    }
    if (req.attachments?.length && !adapter.profile.inputs.attachments) {
      throw new Error("Attachments are not supported for this agent yet.")
    }
    // Main is the IPC boundary; a blank prompt must never spawn an agent turn.
    if (!req.text.trim()) {
      throw new Error("Message text is empty.")
    }
    // Same trust boundary as the kernel path: attachment paths cross the IPC
    // boundary, so only picker-authorized or previously trusted paths may be
    // recorded and handed to the agent. Asserted BEFORE the single-generation
    // check: the await would otherwise open a same-tick window where two sends
    // both pass the check and spawn duplicate generations.
    await this.assertTrustedAttachments(req.attachments)
    if (this.generations.has(req.sessionId)) {
      throw new Error("A generation is already active for this session.")
    }
    this.setSessionPermissionModeValue(
      req.sessionId,
      req.permissionMode ?? this.sessionPermissionMode(req.sessionId),
      req.permissionModeVersion,
    )
    const userMessageId = createOpencodeMessageId()
    const generation = this.beginSessionGeneration(req.sessionId, userMessageId)
    this.createActiveRun(req, generation)
    this.userStops.delete(req.sessionId)
    this.connectionFailedSessions.delete(req.sessionId)
    this.clearMessageErrorSignatures(req.sessionId)
    this.emitSessionActivity(req.sessionId)
    try {
      const trustedProjectRoot = await this.resolveTrustedProjectRoot(req.projectContext)
      if (!this.isCurrentGeneration(req.sessionId, generation.id) || generation.controller.signal.aborted) {
        this.clearSessionGeneration(req.sessionId, generation.id)
        return
      }
      if (trustedProjectRoot) {
        this.trustedAccess.setProjectRoot(req.sessionId, trustedProjectRoot)
      }
      if (req.attachments?.length) {
        // Same display path as the kernel: the store record is what getMessages
        // folds back onto the synthesized user turn.
        await this.deps.userAttachmentStore?.record(req.sessionId, userMessageId, req.attachments, req.text)
        this.rememberTrustedAttachments(req.sessionId, req.attachments)
        // One-shot picker authorization is consumed on submit, kernel-style.
        this.discardTrustedAttachmentPaths(req.attachments)
      }
      await this.projectPermissionMode(req.sessionId, this.sessionPermissionMode(req.sessionId))
      this.activeRuns.update(req.sessionId, { phase: "submitted" })
      this.scheduleGenerationSubmitWatchdog(req.sessionId, generation.id)
      void adapter
        .send(
          {
            type: "prompt",
            sessionId: req.sessionId,
            text: req.text,
            messageId: userMessageId,
            ...(req.attachments?.length ? { attachments: req.attachments } : {}),
            ...(trustedProjectRoot ? { outputProjectRoot: trustedProjectRoot } : {}),
            ...(req.agentModelId ? { agentModelId: req.agentModelId } : {}),
            ...(req.agentEffortId ? { agentEffortId: req.agentEffortId } : {}),
          },
          { signal: generation.controller.signal },
        )
        .then(() => {
          if (
            this.isCurrentGeneration(req.sessionId, generation.id) &&
            !generation.controller.signal.aborted &&
            !this.activeAssistantMessages.has(req.sessionId)
          ) {
            this.scheduleGenerationStartWatchdog(req.sessionId, generation.id)
          }
        })
        .catch((error: unknown) => {
          if (req.attachments?.length) {
            // The prompt never reached the agent; a record without a user turn
            // would resurface as an orphaned attachment bubble on reload.
            void this.rollbackUnsubmittedUserAttachments(req.sessionId, userMessageId, req.attachments)
          }
          if (!this.isCurrentGeneration(req.sessionId, generation.id) || generation.controller.signal.aborted) {
            this.clearSessionGeneration(req.sessionId, generation.id)
            return
          }
          const messageId = this.activeAssistantMessages.get(req.sessionId)
          this.clearSessionGeneration(req.sessionId, generation.id)
          this.activeAssistantMessages.delete(req.sessionId)
          this.activeToolParts.delete(req.sessionId)
          this.emitMessageError(
            this.send.bind(this) as (event: string, data: unknown) => Promise<void>,
            req.sessionId,
            errorMessage(error),
            messageId,
          )
        })
    } catch (error) {
      this.clearSessionGeneration(req.sessionId, generation.id)
      throw error
    }
  }

  private async rollbackUnsubmittedUserAttachments(
    sessionId: string,
    messageId: string,
    attachments: readonly ChatAttachment[] | undefined,
  ): Promise<void> {
    try {
      await this.deps.userAttachmentStore?.removeMessage(sessionId, messageId)
    } catch (error) {
      console.warn("[wanta] failed to roll back unsubmitted user attachments:", error)
      logDiagnostic(
        "chat-service",
        "failed to roll back unsubmitted user attachments",
        { error, messageId, sessionId },
        "warn",
      )
    } finally {
      this.discardTrustedAttachmentPaths(attachments)
      this.managedUserMessageIds.delete(messageId)
      this.internalAttachmentPathsByMessage.delete(messageId)
      const messageIds = this.managedUserMessageIdsBySession.get(sessionId)
      messageIds?.delete(messageId)
      if (messageIds?.size === 0) this.managedUserMessageIdsBySession.delete(sessionId)
    }
  }

  private discardTrustedAttachmentPaths(attachments: readonly ChatAttachment[] | undefined): void {
    for (const attachment of attachments ?? []) {
      this.deps.trustedAttachmentPaths?.delete(attachment.path)
      if (attachment.agentPath) this.deps.trustedAttachmentPaths?.delete(attachment.agentPath)
    }
  }

  private emitSessionActivity(sessionId: string): void {
    this.sessionActivity.emit({ sessionId, usedAt: Date.now() })
  }

  private readTurnOutputs(): Promise<TurnOutputRecords> {
    return this.outputPersistence.readTurnOutputs()
  }

  private readArtifactBundles(): Promise<ArtifactBundles> {
    return this.outputPersistence.readArtifactBundles()
  }

  private async publishArtifactBundle(bundle: ArtifactBundle): Promise<void> {
    await this.outputPersistence.recordArtifactBundle(bundle)
    await this.send("artifactBundleUpdated", { sessionId: bundle.sessionId, messageId: bundle.messageId }).catch(
      (error: unknown) => {
        console.warn("[wanta] failed to emit artifact bundle update", error)
        logDiagnostic(
          "chat-service",
          "failed to emit artifact bundle update",
          { error, messageId: bundle.messageId, sessionId: bundle.sessionId },
          "warn",
        )
      },
    )
  }

  private rememberAuthorizationOverlay(
    sessionId: string,
    messageId: string,
    partId: string,
    authorization: AuthorizationInfo,
  ): Promise<void> {
    return this.outputPersistence.recordAuthorization(sessionId, messageId, partId, authorization)
  }

  private rememberStoppedGeneration(
    sessionId: string,
    messageId: string,
    partIds: string[],
    stoppedAt = Date.now(),
  ): Promise<void> {
    return this.outputPersistence.recordStopped(sessionId, messageId, partIds, stoppedAt)
  }

  private rememberTurnOutput(record: StoredTurnOutputRecord): Promise<void> {
    return this.outputPersistence.recordTurnOutput(record)
  }
  private async projectBaseline(project: ChatProjectContext | undefined): Promise<{
    baseline?: GitTurnBaseline
    projectRoot?: string
  }> {
    if (!project?.git || !this.deps.projectStore) {
      return {}
    }
    const registered = (await this.deps.projectStore.read()).get(project.id)
    if (
      !registered ||
      registered.archivedAt ||
      normalizeProjectPath(registered.path) !== normalizeProjectPath(project.path)
    ) {
      return {}
    }
    try {
      return {
        // Git 输出和 turn output 都严格限制在用户注册的项目目录；仓库根由 renderer 提供，仅用于展示，
        // 不能作为主进程的本地读取授权边界。git -C 子目录会把 ls-files 输出限制并相对到该目录。
        baseline: await captureGitTurnBaseline(registered.path),
        projectRoot: normalizeProjectPath(registered.path),
      }
    } catch (error) {
      console.warn("[wanta] failed to capture project baseline", error)
      return {}
    }
  }

  private async resolveTrustedProjectRoot(project: ChatProjectContext | undefined): Promise<string | undefined> {
    const projectPath = project?.path.trim()
    if (!project || !project.id.trim() || !projectPath || !this.deps.projectStore) {
      return undefined
    }
    const registered = (await this.deps.projectStore.read()).get(project.id)
    if (
      !registered ||
      registered.archivedAt ||
      normalizeProjectPath(registered.path) !== normalizeProjectPath(projectPath)
    ) {
      return undefined
    }
    return normalizeProjectPath(registered.path)
  }

  private async finalizeTurnOutput(sessionId: string, messageId: string | undefined): Promise<void> {
    const generationId = this.generations.get(sessionId)?.id
    const active = generationId ? this.turnOutputs.get(generationId) : undefined
    if (generationId) this.turnOutputs.delete(sessionId, generationId)
    const resolvedMessageId = messageId ?? active?.messageId
    if (!active || !resolvedMessageId) return

    await finalizeTurnOutputArtifacts({
      active,
      getMessages: () => this.agent?.getMessages(sessionId) ?? Promise.resolve([]),
      messageId: resolvedMessageId,
      publishArtifactBundle: (bundle) => this.publishArtifactBundle(bundle),
      publishTurnOutput: async (record) => {
        await this.rememberTurnOutput(record)
        await this.send("turnOutputUpdated", { sessionId, messageId: resolvedMessageId }).catch((error: unknown) => {
          console.warn("[wanta] failed to emit turn output update:", error)
          logDiagnostic(
            "chat-service",
            "failed to emit turn output update",
            { error, messageId: resolvedMessageId, sessionId },
            "warn",
          )
        })
      },
      sessionId,
    })
  }
  public async getAttachmentPreview(req: AttachmentPreviewRequest): Promise<AttachmentPreviewResult> {
    await this.assertTrustedLocalPath(req.path)
    return attachmentPreview(req, this.deps.createArtifactResourceUrl)
  }

  public async copyLocalImage(req: LocalImageRequest): Promise<void> {
    const item = await localArtifactItem(req.path)
    if (!item || item.kind !== "file" || !item.mime.startsWith("image/")) {
      throw new Error("Image file does not exist.")
    }
    await this.assertTrustedLocalPath(item.path)
    const bytes = await readFile(item.path)
    const image = nativeImage.createFromBuffer(bytes)
    if (image.isEmpty()) {
      throw new Error("Image file could not be decoded.")
    }
    clipboard.writeImage(image)
  }

  public async saveLocalImageAs(req: LocalImageRequest): Promise<SaveLocalImageAsResult> {
    const item = await localArtifactItem(req.path)
    if (!item || item.kind !== "file" || !item.mime.startsWith("image/")) {
      throw new Error("Image file does not exist.")
    }
    await this.assertTrustedLocalPath(item.path)
    const result = await dialog.showSaveDialog({ defaultPath: item.name })
    if (result.canceled || !result.filePath) {
      return { saved: false }
    }
    await copyFile(item.path, result.filePath)
    return { path: result.filePath, saved: true }
  }

  public async getLocalArtifactPreview(req: LocalArtifactPreviewRequest): Promise<LocalArtifactPreviewResult> {
    await this.assertTrustedLocalPath(req.path)
    return localArtifactPreview(req, this.deps.createArtifactResourceUrl, this.deps.createSpreadsheetPreview)
  }

  public async getLocalArtifactThumbnail(req: LocalArtifactThumbnailRequest): Promise<LocalArtifactThumbnailResult> {
    await this.assertTrustedLocalPath(req.path)
    if (!this.deps.createArtifactThumbnail) {
      return { dataUrl: null }
    }
    return this.deps.createArtifactThumbnail(req.path)
  }

  public async getTurnOutputs(req: TurnOutputsRequest): Promise<TurnOutputRecord[]> {
    const records = (await this.readTurnOutputs()).get(req.sessionId)
    if (!records) {
      return []
    }
    const seen = new Set<string>()
    const output: TurnOutputRecord[] = []
    for (const messageId of req.messageIds) {
      if (seen.has(messageId)) {
        continue
      }
      seen.add(messageId)
      const record = records.get(messageId)
      if (record) {
        output.push(publicTurnOutputRecord(record))
      }
    }
    return output
  }

  public async getArtifactBundles(req: ArtifactBundlesRequest): Promise<ArtifactBundle[]> {
    const records = (await this.readArtifactBundles()).get(req.sessionId)
    if (!records) {
      return []
    }
    const seen = new Set<string>()
    const bundles: ArtifactBundle[] = []
    for (const messageId of req.messageIds) {
      if (seen.has(messageId)) {
        continue
      }
      seen.add(messageId)
      const bundle = records.get(messageId)
      if (bundle) {
        bundles.push(bundle)
      }
    }
    return bundles
  }

  public async getTurnFileDiff(req: TurnFileDiffRequest): Promise<TurnFileDiffResult> {
    const record = (await this.readTurnOutputs()).get(req.sessionId)?.get(req.messageId)
    const file = record?.files.find((item) => item.path === req.path)
    if (!record || !file) {
      return { kind: "missing", path: req.path, mime: "application/octet-stream", additions: 0, deletions: 0 }
    }
    if (file.role === "process" && (!record.processRoot || !isPathInside(record.processRoot, file.path))) {
      return { kind: "missing", path: req.path, mime: file.mime, additions: 0, deletions: 0 }
    }
    if (file.role === "project_change" && (!record.projectRoot || !isPathInside(record.projectRoot, file.path))) {
      return { kind: "missing", path: req.path, mime: file.mime, additions: 0, deletions: 0 }
    }
    return file.diff
  }

  public async resolveLocalArtifacts(req: ResolveLocalArtifactsRequest): Promise<ResolveLocalArtifactsResult> {
    const candidates = [req.artifactRoot]
    const maxDirectoryItems = Math.max(1, Math.min(req.maxDirectoryItems ?? defaultMaxDirectoryItems, 200))
    const trustedRoots = await this.trustedLocalPathRoots()
    const seen = new Set<string>()
    const groups: LocalArtifactGroup[] = []
    let pack: LocalArtifactPack | undefined
    for (const candidate of candidates) {
      const filePath = normalizeLocalPathCandidate(candidate, os.homedir())
      if (!filePath || seen.has(filePath)) {
        continue
      }
      if (!(await this.isPathInTrustedRoots(filePath, trustedRoots))) {
        throw new Error("Local artifact path is not available from this conversation.")
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
    await this.assertTrustedLocalPath(item.path)
    try {
      const result = await shell.openPath(item.path)
      if (result) {
        throw new Error(result)
      }
    } catch (error) {
      throw new Error(`Failed to open local path: ${errorMessage(error)}`)
    }
  }

  public async showLocalPathInFolder(req: ShowLocalPathInFolderRequest): Promise<void> {
    const item = await localArtifactItem(req.path)
    if (!item) {
      throw new Error("File does not exist.")
    }
    await this.assertTrustedLocalPath(item.path)
    try {
      shell.showItemInFolder(item.path)
    } catch (error) {
      throw new Error(`Failed to show local path in folder: ${errorMessage(error)}`)
    }
  }

  public async openExternalUrl(req: OpenExternalUrlRequest): Promise<void> {
    // 渲染层（额度中心等）已自行解析好目标 URL；主进程只校验 http/https 后外开，绝不在窗口内导航。
    await shell.openExternal(ensureExternalHttpUrl(req.url))
  }

  public async setAgentTeam(req: SetAgentTeamRequest): Promise<void> {
    const teamName = req.teamName.trim()
    if (!teamName) {
      throw new Error("Team name is required")
    }
    this.desiredWorkspaceTeamName = teamName
    await this.runWithScopeMutation(async () => {
      if (this.desiredWorkspaceTeamName !== teamName) {
        return
      }
      await this.deps.onSetAgentTeam?.(teamName)
    })
  }

  public async stopGeneration(sessionId: string): Promise<void> {
    // The kernel-null guard must not swallow stops for external sessions: they
    // route through their own adapter and work without the OpenCode kernel.
    if (!this.chatBackendFor(sessionId)) {
      return
    }
    this.userStops.mark(sessionId)
    await this.stopSessionGeneration(sessionId, { abortAgent: true, reason: "user", throwOnAbortFailure: true })
  }

  public async getMessages(sessionId: string): Promise<ChatMessage[]> {
    const backend = this.chatBackendFor(sessionId)
    if (!backend) {
      return []
    }
    const messages = await backend.getMessages(sessionId)
    const [authorizationOverlays, stoppedGenerations, userAttachmentRecords] = await Promise.all([
      this.outputPersistence.overlaysFor(sessionId),
      this.outputPersistence.stoppedFor(sessionId),
      this.deps.userAttachmentStore?.read(),
    ])
    const displayedMessages = applyStoppedGenerations(
      applyAuthorizationOverlays(
        applyUserAttachmentRecords(messages, userAttachmentRecords?.get(sessionId)),
        authorizationOverlays,
      ),
      stoppedGenerations,
    )
    this.rememberTrustedMessageAttachments(sessionId, displayedMessages)
    return displayedMessages
  }

  public async getPendingQuestions(sessionId: string): Promise<ChatQuestionRequest[]> {
    const backend = this.chatBackendFor(sessionId)
    if (!backend) {
      return []
    }
    const sessionIds = [sessionId, ...this.subagentSessions.childSessionIds(sessionId)]
    const questions: ChatQuestionRequest[] = []
    const sessionQuestions = await backend.getPendingQuestionsForSessions(sessionIds)
    for (const request of sessionQuestions) {
      const displaySessionId = this.subagentSessions.displaySessionId(request.sessionId)
      questions.push(displaySessionId === request.sessionId ? request : { ...request, sessionId: displaySessionId })
    }
    return questions
  }

  public async answerQuestion(req: AnswerQuestionRequest): Promise<void> {
    const backend = this.chatBackendFor(req.sessionId)
    if (!backend) {
      throw new Error("Agent not configured (sign in first)")
    }
    await backend.send({
      type: "question-response",
      sessionId: req.sessionId,
      requestId: req.requestId,
      outcome: { kind: "answered", answers: req.answers },
    })
    this.activeRuns.removeBlockingRequest(req.sessionId, req.requestId)
    this.scheduleGenerationInactivityWatchdogAfterReply(req.sessionId)
    this.emitSessionActivity(req.sessionId)
  }

  public async rejectQuestion(req: RejectQuestionRequest): Promise<void> {
    const backend = this.chatBackendFor(req.sessionId)
    if (!backend) {
      throw new Error("Agent not configured (sign in first)")
    }
    await withTimeout(
      backend.send({
        type: "question-response",
        sessionId: req.sessionId,
        requestId: req.requestId,
        outcome: { kind: "rejected" },
      }),
      questionRejectTimeoutMs,
      "question rejection",
    )
    this.activeRuns.removeBlockingRequest(req.sessionId, req.requestId)
    this.scheduleGenerationInactivityWatchdogAfterReply(req.sessionId)
    this.emitSessionActivity(req.sessionId)
  }

  public async getPendingPermissions(sessionId: string): Promise<ChatPermissionRequest[]> {
    const backend = this.chatBackendFor(sessionId)
    if (!backend) {
      return []
    }
    const sessionIds = [sessionId, ...this.subagentSessions.childSessionIds(sessionId)]
    const pendingPermissions: ChatPermissionRequest[] = []
    const emit = this.send.bind(this) as (event: string, data: unknown) => Promise<void>
    const permissions = await backend.getPendingPermissionsForSessions(sessionIds)
    for (const request of permissions) {
      if (!this.answerLocalAccessPermission(emit, request)) {
        const displaySessionId = this.subagentSessions.displaySessionId(request.sessionId)
        const displayRequest =
          displaySessionId === request.sessionId ? request : { ...request, sessionId: displaySessionId }
        this.rememberPendingPermissionRequest(request)
        this.activeRuns.addBlockingRequest(displaySessionId, displayRequest.id, "awaiting_permission")
        pendingPermissions.push(displayRequest)
      }
    }
    return pendingPermissions
  }

  public async answerPermission(req: AnswerPermissionRequest): Promise<void> {
    const backend = this.chatBackendFor(req.sessionId)
    if (!backend) {
      throw new Error("Agent not configured (sign in first)")
    }
    let request = this.pendingPermissionRequest(req.sessionId, req.requestId)
    const sessionIds = [req.sessionId, ...this.subagentSessions.childSessionIds(req.sessionId)]
    if (!request) {
      try {
        request = (await backend.getPendingPermissionsForSessions(sessionIds)).find((item) => item.id === req.requestId)
        if (!request) {
          this.activeRuns.removeBlockingRequest(req.sessionId, req.requestId)
          this.scheduleGenerationInactivityWatchdogAfterReply(req.sessionId)
          this.emitSessionActivity(req.sessionId)
          return
        }
      } catch (error) {
        console.warn("[wanta] failed to inspect permission before replying:", error)
        logDiagnostic(
          "chat-service",
          "failed to inspect permission before replying",
          { error, requestId: req.requestId, sessionId: req.sessionId },
          "warn",
        )
        throw error
      }
    }
    if (req.reply === "always") {
      for (const sessionId of sessionIds) {
        this.addSessionPermissionGrant(sessionId, request)
      }
    }
    const sourceSessionId = request.sessionId
    // The reply is forwarded verbatim; how "always" maps onto the agent's own
    // approval semantics is each adapter's business (the kernel adapter
    // downgrades it because the grant lives Wanta-side, external agents
    // persist it in their native rule system).
    await backend.send({
      type: "permission-response",
      sessionId: sourceSessionId,
      requestId: req.requestId,
      reply: req.reply,
    })
    if (req.reply !== "reject" && request) {
      this.rememberTrustedPermissionResources(req.sessionId, request)
    }
    this.forgetPendingPermissionRequest(sourceSessionId, req.requestId)
    this.activeRuns.removeBlockingRequest(req.sessionId, req.requestId)
    this.scheduleGenerationInactivityWatchdogAfterReply(req.sessionId)
    this.emitSessionActivity(req.sessionId)
  }

  public async setPermissionMode(req: SetChatPermissionModeRequest): Promise<void> {
    const previousMode = this.sessionPermissionMode(req.sessionId)
    if (!this.setSessionPermissionModeValue(req.sessionId, req.permissionMode, req.version)) {
      return
    }
    if (previousMode === req.permissionMode) {
      return
    }
    try {
      await this.deps.onPermissionModeChanged?.(req.sessionId, req.permissionMode)
    } catch (error) {
      // 仅回滚仍由本次请求持有的运行态；不能覆盖等待期间抵达的更新版本。
      if (this.sessionPermissionMode(req.sessionId) === req.permissionMode) {
        this.setSessionPermissionModeValue(req.sessionId, previousMode)
      }
      throw error
    }
    // 持久化等待期间可能已有更新版本接管该会话，旧请求不得继续改子会话或自动批准权限。
    if (this.sessionPermissionMode(req.sessionId) !== req.permissionMode) {
      return
    }
    // Sessions with an adapter-side mode get it projected immediately
    // (mid-run switches must not wait for the next prompt); best effort.
    await this.projectPermissionMode(req.sessionId, req.permissionMode)
    const affectedSessionIds = [req.sessionId]
    for (const childSessionId of this.subagentSessions.trustedChildSessionIds(req.sessionId)) {
      if (this.setSessionPermissionModeValue(childSessionId, req.permissionMode, req.version)) {
        affectedSessionIds.push(childSessionId)
      }
    }
    if (req.permissionMode === "full_access") {
      await Promise.all(affectedSessionIds.map((sessionId) => this.autoAnswerPendingPermissions(sessionId)))
    }
  }
}
