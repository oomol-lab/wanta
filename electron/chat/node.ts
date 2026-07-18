import type { ChatEmit } from "../agent/event-translator.ts"
import type { AgentEventConnectionStatus, AgentManager } from "../agent/manager.ts"
import type { GitTurnBaseline } from "../git/turn-diff.ts"
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
  SetAgentOrganizationRequest,
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
import { translateOpencodeEvent } from "../agent/event-translator.ts"
import { createOpencodeMessageId } from "../agent/opencode-id.ts"
import { logDiagnostic } from "../diagnostics-log.ts"
import { captureGitTurnBaseline } from "../git/turn-diff.ts"
import { ServiceEvent } from "../service-events.ts"
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
  buildOrganizationSkillsSystem,
  buildPermissionModeSystem,
  buildProjectContextSystem,
  mergeSystemPrompts,
} from "./context-system.ts"
import { normalizeChatError } from "./error.ts"
import { GenerationRegistry } from "./generation-registry.ts"
import { evaluateLocalAccessRequest, localAccessGrantForRequest } from "./local-access-policy.ts"
import { directoryArtifacts, fileArtifact, localArtifactItem, readArtifactPack } from "./local-artifacts.ts"
import { OutputPersistence } from "./output-persistence.ts"
import { PermissionState } from "./permission-state.ts"
import { attachmentPreview, localArtifactPreview } from "./previews.ts"
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

function organizationNameFromRequest(req: SendMessageRequest): string | undefined {
  const organizationName = req.scope?.organizationName.trim()
  return organizationName ? organizationName : undefined
}

function runWorkspaceFromRequest(req: SendMessageRequest): ChatRunWorkspace {
  const organizationId = req.scope?.organizationId.trim() ?? ""
  const organizationName = req.scope?.organizationName.trim() ?? ""
  if (!organizationId || !organizationName) {
    throw new Error("Organization scope is invalid")
  }
  return { organizationId, organizationName }
}

function messageErrorSignature(message: string): string {
  return message.trim() || message
}

function metadataString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined
}

function taskChildSessionId(data: ToolCallStartedEvent | ToolCallResultEvent): string | undefined {
  if (data.tool !== "task") {
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
  /** 渲染层切换组织 workspace 时，同步 agent 的组织作用域（main 持有 agent 与 activeAgentOrganizationName）。 */
  onSetAgentOrganization?: (organizationName: string | undefined) => Promise<void> | void
  /** 权限模式由 ChatService 统一提交，避免 renderer 分别写运行态与会话元数据。 */
  onPermissionModeChanged?: (sessionId: string, permissionMode: AgentPermissionMode) => Promise<void> | void
  /** 正常完成且产物已收尾后通知主进程 attention 域；停止和错误路径不触发。 */
  onSessionCompleted?: (input: { organizationId: string; runId: string; sessionId: string }) => Promise<void> | void
}

interface StopSessionGenerationOptions {
  abortAgent: boolean
  reason: "system" | "user"
  throwOnAbortFailure: boolean
}

export class ChatServiceImpl extends ConnectionService<ChatService> implements IConnectionService<ChatService> {
  public readonly sessionActivity = new ServiceEvent<{ sessionId: string; usedAt: number }>()

  private agent: AgentManager | null
  private bridged = false
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
  private connectionFailedSessions = new Set<string>()
  private readonly trustedAccess: TrustedLocalAccess
  private readonly subagentSessions: SubagentSessions
  private readonly permissions = new PermissionState()
  private readonly deps: ChatServiceDeps
  private agentStatus: AgentRuntimeStatus = { status: "signed_out" }
  private readonly outputPersistence: OutputPersistence
  private scopeMutationQueue: Promise<void> = Promise.resolve()
  private desiredWorkspaceOrganizationName: string | undefined
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

  public constructor(agent: AgentManager | null = null, deps: ChatServiceDeps = {}) {
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
  public setAgent(agent: AgentManager | null): void {
    this.streamEventBuffer?.clear()
    this.streamEventBuffer = null
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
    this.desiredWorkspaceOrganizationName = undefined
    this.startedMessages.clear()
    this.completionChecks.clear()
    this.clearAllCompletionRetries()
    this.managedUserMessageIds.clear()
    this.internalAttachmentPathsByMessage.clear()
    this.managedUserMessageIdsBySession.clear()
    this.deps.trustedAttachmentPaths?.clear()
    this.scopeMutationQueue = Promise.resolve()
  }

  public setAgentStatus(status: AgentRuntimeStatus): void {
    this.agentStatus = status
    void this.send("agentStatusChanged", { status }).catch((error: unknown) => {
      console.warn("[wanta] failed to emit agent status:", error)
      logDiagnostic("chat-service", "failed to emit agent status", { error, status: status.status }, "warn")
    })
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
    const handleConnectionStatus = (status: AgentEventConnectionStatus): void => {
      this.handleAgentConnectionStatus(emit, status)
    }
    this.agent.subscribe((event) => {
      for (const translated of translateOpencodeEvent(event)) {
        const sourceSessionId = translated.data.sessionId
        const generationSessionId = sourceSessionId ? this.generationWatchdogSessionId(sourceSessionId) : null
        const failedSessionId = generationSessionId ?? sourceSessionId
        if (failedSessionId && this.connectionFailedSessions.has(failedSessionId)) {
          continue
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
          continue
        }
        if (this.userStops.shouldSuppressEvent(translated)) {
          continue
        }
        if (
          translated.event === "messageDelta" &&
          translated.data.synthetic === true &&
          this.managedUserMessageIds.has(translated.data.messageId)
        ) {
          continue
        }
        if (
          translated.event === "messageAttachment" &&
          this.internalAttachmentPathsByMessage.get(translated.data.messageId)?.has(translated.data.attachment.path)
        ) {
          continue
        }
        const activitySessionId = generationSessionId ?? sourceSessionId
        if (activitySessionId) {
          this.generations.clearAcknowledgementWatchdog(activitySessionId)
        }
        if (translated.event === "messageStarted") {
          if (!this.rememberMessageStarted(translated)) {
            continue
          }
        }
        if (translated.event === "permissionAsked" && this.answerLocalAccessPermission(emit, translated.data.request)) {
          if (generationSessionId) {
            this.generations.clearInactivityWatchdog(generationSessionId)
          }
          continue
        }
        const displayed = this.subagentSessions.forDisplay(translated)
        const displayedSessionId = displayed.data.sessionId
        if (
          sourceSessionId &&
          generationSessionId &&
          sourceSessionId !== generationSessionId &&
          displayed === translated
        ) {
          this.scheduleGenerationInactivityWatchdog(generationSessionId)
          continue
        }
        if (displayed.event === "permissionAsked") {
          this.rememberPendingPermissionRequest(displayed.data.request)
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
          this.generations.clearInactivityWatchdog(sessionId)
          void this.interruptSessionGeneration(emit, sessionId, "runtime_error", translated.data.message, {
            abortAgent: false,
          })
          continue
        }
        if (translated.event === "messageCompleted") {
          const sessionId = translated.data.sessionId
          const generation = this.generations.get(sessionId)
          if (generation) void this.completeSessionGeneration(emit, sessionId, generation)
          continue
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
        if (displayed.event === "messageDelta" || displayed.event === "messageReasoningDelta") {
          this.eventMetrics.record(`stream-input:${displayed.event}`)
          this.streamEventBuffer?.enqueue(displayed)
        } else {
          this.sendBestEffort(emit, displayed.event, displayed.data, { sessionId: displayedSessionId })
        }
      }
    }, handleConnectionStatus)
  }

  private handleAgentConnectionStatus(
    emit: (event: string, data: unknown) => Promise<void>,
    status: AgentEventConnectionStatus,
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
    this.sendBestEffort(emit, "messageError", createMessageErrorPayload(sessionId, message, messageId), {
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
      ...(generationId ? { projectDependencyGenerationId: generationId } : {}),
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
    return this.permissions.pending(sessionId, requestId)
  }

  private answerLocalAccessPermission(
    emit: (event: string, data: unknown) => Promise<void>,
    request: ChatPermissionRequest,
  ): boolean {
    const projectRoot = this.trustedAccess.projectRoot(request.sessionId)
    const decision = evaluateLocalAccessRequest(request, {
      activeGenerationId: this.generations.get(request.sessionId)?.id,
      permissionMode: this.sessionPermissionMode(request.sessionId),
      sessionGrants: this.permissions.sessionGrants(request.sessionId),
      ...(projectRoot ? { trustedProjectRoot: projectRoot } : {}),
    })
    if (!this.agent || decision.type !== "allow") {
      return false
    }
    const displaySessionId = this.subagentSessions.displaySessionId(request.sessionId)
    const displayRequest =
      displaySessionId === request.sessionId ? request : { ...request, sessionId: displaySessionId }
    if (!this.permissions.beginAutomaticReply(request.sessionId, request.id)) {
      return true
    }
    void this.agent
      .answerPermission(request.sessionId, request.id, "once")
      .then(() => {
        this.rememberTrustedPermissionResources(request.sessionId, request)
        this.sendBestEffort(
          emit,
          "permissionReplied",
          { sessionId: displaySessionId, requestId: request.id },
          { sessionId: displaySessionId },
        )
        this.forgetPendingPermissionRequest(displaySessionId, request.id)
        this.activeRuns.removeBlockingRequest(displaySessionId, request.id)
        this.scheduleGenerationInactivityWatchdogAfterReply(displaySessionId)
      })
      .catch((error: unknown) => {
        console.warn("[wanta] failed to approve local access permission:", error)
        logDiagnostic(
          "chat-service",
          "failed to approve local access permission",
          { action: request.action, error, reason: decision.reason, sessionId: request.sessionId },
          "warn",
        )
        this.rememberPendingPermissionRequest(displayRequest)
        this.activeRuns.addBlockingRequest(displaySessionId, request.id, "awaiting_permission")
        this.sendBestEffort(
          emit,
          "permissionAsked",
          { sessionId: displaySessionId, request: displayRequest },
          { sessionId: displaySessionId },
        )
      })
      .finally(() => {
        this.permissions.endAutomaticReply(request.sessionId, request.id)
      })
    return true
  }

  private async autoAnswerPendingPermissions(
    sessionId: string,
    emit: (event: string, data: unknown) => Promise<void> = this.send.bind(this) as (
      event: string,
      data: unknown,
    ) => Promise<void>,
  ): Promise<void> {
    if (!this.agent) {
      return
    }
    let permissions: ChatPermissionRequest[]
    try {
      permissions = await this.agent.getPendingPermissions(sessionId)
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
    }
    const [artifactBundles, turnOutputs] = await Promise.all([this.readArtifactBundles(), this.readTurnOutputs()])
    for (const records of artifactBundles.values()) {
      for (const bundle of records.values()) {
        roots.add(bundle.rootPath)
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
      if (completedRun) {
        void Promise.resolve(
          this.deps.onSessionCompleted?.({
            organizationId: completedRun.workspace.organizationId,
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
    if (!this.agent) return false
    const messages = await withTimeout(this.agent.getMessages(sessionId), 1_000, "idle history verification").catch(
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
    if (generation) this.clearCompletionRetry(`${sessionId}\0${generation.id}`)
    this.generations.clear(sessionId, generationId)
    this.subagentSessions.forgetAll(sessionId)
    this.forgetSessionPendingPermissionRequests(sessionId)
    this.removeGenerationPermissionGrants(sessionId, generation?.id)
    this.activeRuns.delete(sessionId, generationId)
    const agent = this.agent
    if (agent) {
      void Promise.all([
        agent.clearSessionOrganizationName(sessionId),
        agent.clearSessionKnowledgeBaseIds(sessionId),
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
    if (!this.agent) {
      return
    }
    const generation = this.generations.get(sessionId)
    generation?.controller.abort()
    const messageId = this.activeAssistantMessages.get(sessionId)
    const partIds = [...(this.activeToolParts.get(sessionId) ?? [])]
    const stoppedAt = Date.now()
    if (options.abortAgent) {
      try {
        await this.agent.abort(sessionId)
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
    this.rememberTrustedAttachments(req.sessionId, req.attachments)
    for (const attachment of req.attachments ?? []) {
      this.deps.trustedAttachmentPaths?.delete(attachment.path)
      if (attachment.agentPath) this.deps.trustedAttachmentPaths?.delete(attachment.agentPath)
    }
    const userMessageId = createOpencodeMessageId()
    if (req.attachments?.length) {
      await this.deps.userAttachmentStore?.record(req.sessionId, userMessageId, req.attachments)
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
    const organizationName = organizationNameFromRequest(req)
    const bugReport = parseBugReportCommand(req.text)
    let generation: SessionGeneration | undefined
    let artifactDir: string | undefined
    let processDir: string | undefined
    try {
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
        this.agent.setSessionOrganizationName(req.sessionId, organizationName),
        this.agent.setSessionKnowledgeBaseIds(req.sessionId, knowledgeBaseIds),
      ])
      if (!this.isCurrentGeneration(req.sessionId, activeGeneration.id) || activeGeneration.controller.signal.aborted) {
        this.clearSessionGeneration(req.sessionId, activeGeneration.id)
        await removeUnsubmittedTurnDirectories(artifactDir, processDir)
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
              platform: this.deps.bugReportRuntime?.platform ?? process.platform,
            },
            targetFilePath: path.join(artifactDir, BUG_REPORT_FILE_NAME),
          })
        : undefined
      // promptStreaming 的结果经 SSE 推送；RPC 只确认主进程已接收本轮发送，避免首条消息 UI 等到流式内容已累积后才切换。
      this.activeRuns.update(req.sessionId, { phase: "submitted" })
      this.scheduleGenerationSubmitWatchdog(req.sessionId, promptGeneration.id)
      void this.agent
        .promptStreaming(req.sessionId, req.text, {
          attachments: req.attachments,
          artifactDir,
          processDir,
          mode: execution.mode,
          messageId: userMessageId,
          model: req.model,
          organizationName,
          reasoningLevel: req.reasoningLevel,
          signal: promptGeneration.controller.signal,
          system: mergeSystemPrompts(
            buildOrganizationSkillsSystem(req.organizationSkills),
            buildContextMentionsSystemPrompt(req.contextMentions),
            buildProjectContextSystem(req.projectContext),
            buildPermissionModeSystem(req.permissionMode),
            bugReportSystem,
          ),
        })
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
      throw error
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

  public async setAgentOrganization(req: SetAgentOrganizationRequest): Promise<void> {
    const organizationName = req.organizationName.trim()
    if (!organizationName) {
      throw new Error("Organization name is required")
    }
    this.desiredWorkspaceOrganizationName = organizationName
    await this.runWithScopeMutation(async () => {
      if (this.desiredWorkspaceOrganizationName !== organizationName) {
        return
      }
      await this.deps.onSetAgentOrganization?.(organizationName)
    })
  }

  public async stopGeneration(sessionId: string): Promise<void> {
    if (!this.agent) {
      return
    }
    this.userStops.mark(sessionId)
    await this.stopSessionGeneration(sessionId, { abortAgent: true, reason: "user", throwOnAbortFailure: true })
  }

  public async getMessages(sessionId: string): Promise<ChatMessage[]> {
    if (!this.agent) {
      return []
    }
    const messages = await this.agent.getMessages(sessionId)
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
    if (!this.agent) {
      return []
    }
    const sessionIds = [sessionId, ...this.subagentSessions.childSessionIds(sessionId)]
    const questions: ChatQuestionRequest[] = []
    const sessionQuestions = await this.agent.getPendingQuestionsForSessions(sessionIds)
    for (const request of sessionQuestions) {
      const displaySessionId = this.subagentSessions.displaySessionId(request.sessionId)
      questions.push(displaySessionId === request.sessionId ? request : { ...request, sessionId: displaySessionId })
    }
    return questions
  }

  public async answerQuestion(req: AnswerQuestionRequest): Promise<void> {
    if (!this.agent) {
      throw new Error("Agent not configured (sign in first)")
    }
    await this.agent.answerQuestion(req.sessionId, req.requestId, req.answers)
    this.activeRuns.removeBlockingRequest(req.sessionId, req.requestId)
    this.scheduleGenerationInactivityWatchdogAfterReply(req.sessionId)
    this.emitSessionActivity(req.sessionId)
  }

  public async rejectQuestion(req: RejectQuestionRequest): Promise<void> {
    if (!this.agent) {
      throw new Error("Agent not configured (sign in first)")
    }
    await withTimeout(
      this.agent.rejectQuestion(req.sessionId, req.requestId),
      questionRejectTimeoutMs,
      "question rejection",
    )
    this.activeRuns.removeBlockingRequest(req.sessionId, req.requestId)
    this.scheduleGenerationInactivityWatchdogAfterReply(req.sessionId)
    this.emitSessionActivity(req.sessionId)
  }

  public async getPendingPermissions(sessionId: string): Promise<ChatPermissionRequest[]> {
    if (!this.agent) {
      return []
    }
    const sessionIds = [sessionId, ...this.subagentSessions.childSessionIds(sessionId)]
    const pendingPermissions: ChatPermissionRequest[] = []
    const emit = this.send.bind(this) as (event: string, data: unknown) => Promise<void>
    const permissions = await this.agent.getPendingPermissionsForSessions(sessionIds)
    for (const request of permissions) {
      if (!this.answerLocalAccessPermission(emit, request)) {
        const displaySessionId = this.subagentSessions.displaySessionId(request.sessionId)
        const displayRequest =
          displaySessionId === request.sessionId ? request : { ...request, sessionId: displaySessionId }
        this.rememberPendingPermissionRequest(displayRequest)
        this.activeRuns.addBlockingRequest(displaySessionId, displayRequest.id, "awaiting_permission")
        pendingPermissions.push(displayRequest)
      }
    }
    return pendingPermissions
  }

  public async answerPermission(req: AnswerPermissionRequest): Promise<void> {
    if (!this.agent) {
      throw new Error("Agent not configured (sign in first)")
    }
    let request = this.pendingPermissionRequest(req.sessionId, req.requestId)
    if (req.reply === "always") {
      if (!request) {
        try {
          request = (await this.agent.getPendingPermissions(req.sessionId)).find((item) => item.id === req.requestId)
        } catch (error) {
          console.warn("[wanta] failed to inspect permission before saving session grant:", error)
          logDiagnostic(
            "chat-service",
            "failed to inspect permission before saving session grant",
            { error, requestId: req.requestId, sessionId: req.sessionId },
            "warn",
          )
        }
      }
      if (request) {
        this.addSessionPermissionGrant(req.sessionId, request)
      }
    }
    await this.agent.answerPermission(req.sessionId, req.requestId, req.reply === "always" ? "once" : req.reply)
    if (req.reply !== "reject" && request) {
      this.rememberTrustedPermissionResources(req.sessionId, request)
    }
    this.forgetPendingPermissionRequest(req.sessionId, req.requestId)
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
