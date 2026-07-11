import type { ChatEmit } from "../agent/event-translator.ts"
import type { AgentEventConnectionStatus, AgentManager } from "../agent/manager.ts"
import type { GitTurnBaseline } from "../git/turn-diff.ts"
import type { SessionProjectStore } from "../session/project-store.ts"
import type { ArtifactBundleStore, ArtifactBundles, ArtifactSessionBaseline } from "./artifact-bundles.ts"
import type { AuthorizationOverlayStore, AuthorizationOverlays } from "./authorization.ts"
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
  ChatRunPhase,
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
  LocalArtifactPack,
  MessageErrorEvent,
  OpenExternalUrlRequest,
  OpenLocalPathRequest,
  RejectQuestionRequest,
  ResolveLocalArtifactsRequest,
  ResolveLocalArtifactsResult,
  SendMessageRequest,
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
import type { SessionPermissionGrant } from "./permission-request.ts"
import type { StoppedGenerationStore, StoppedGenerations } from "./stopped-generations.ts"
import type { StoredTurnOutputRecord, TurnOutputRecords, TurnOutputStore } from "./turn-outputs.ts"
import type { IConnectionService } from "@oomol/connection"

import { ConnectionService } from "@oomol/connection"
import { shell } from "electron"
import { realpath, rm } from "node:fs/promises"
import os from "node:os"
import { translateOpencodeEvent } from "../agent/event-translator.ts"
import { managedPythonEnvironmentPath } from "../agent/python-environment.ts"
import { logDiagnostic } from "../diagnostics-log.ts"
import { captureGitTurnBaseline } from "../git/turn-diff.ts"
import { ServiceEvent } from "../service-events.ts"
import {
  buildArtifactBundle,
  captureArtifactSessionBaseline,
  generatedImagePreviewCount,
  materializeAssistantArtifacts,
  recordArtifactBundle,
  recoverMisplacedTurnArtifacts,
} from "./artifact-bundles.ts"
import { normalizeLocalPathCandidate } from "./artifacts.ts"
import { applyAuthorizationOverlays, recordAuthorizationOverlay } from "./authorization.ts"
import { ChatService as ChatServiceName } from "./common.ts"
import {
  buildContextMentionsSystem as buildContextMentionsSystemPrompt,
  buildOrganizationSkillsSystem,
  buildPermissionModeSystem,
  buildProjectContextSystem,
  mergeSystemPrompts,
} from "./context-system.ts"
import { normalizeChatError } from "./error.ts"
import { evaluateLocalAccessRequest, localAccessGrantForRequest } from "./local-access-policy.ts"
import { directoryArtifacts, fileArtifact, localArtifactItem, readArtifactPack } from "./local-artifacts.ts"
import { attachmentPreview, localArtifactPreview } from "./previews.ts"
import { applyStoppedGenerations, recordStoppedGeneration } from "./stopped-generations.ts"
import { ChatStreamEventBuffer } from "./stream-event-buffer.ts"
import {
  generationNoticeKindForInactivity,
  inactivityWatchdogActionForEvent,
  terminalConnectionInterruption,
} from "./turn-lifecycle.ts"
import {
  intermediateArtifactProcessFiles,
  isPathInside,
  normalizeProjectPath,
  processOutputFiles,
  projectOutputFiles,
  summarizeTurnFiles,
} from "./turn-output-files.ts"
import { publicTurnOutputRecord, recordTurnOutput } from "./turn-outputs.ts"

export { buildContextMentionsSystem } from "./context-system.ts"

const userStopAbortWindowMs = 30_000
const generationSubmitTimeoutMs = 45_000
const generationStartAckTimeoutMs = 45_000
const generationInactivityTimeoutMs = 2 * 60_000
const generationActiveToolInactivityTimeoutMs = 10 * 60_000
const questionRejectTimeoutMs = 5_000
const defaultMaxDirectoryItems = 80
const startedMessageLimit = 5_000

function permissionReplyKey(sessionId: string, requestId: string): string {
  return `${sessionId}\n${requestId}`
}

interface ActiveTurnOutput {
  artifactBaseline?: ArtifactSessionBaseline
  artifactRoot: string
  createdAt: number
  generationId: string
  messageId?: string
  processRoot: string
  projectBaseline?: GitTurnBaseline
  projectRoot?: string
  requestText: string
}

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
  if (req.scope?.type !== "organization") {
    return undefined
  }
  const organizationName = req.scope.organizationName.trim()
  return organizationName ? organizationName : undefined
}

function runWorkspaceFromRequest(req: SendMessageRequest): ChatRunWorkspace {
  if (req.scope?.type !== "organization") {
    return { type: "personal" }
  }
  const organizationId = req.scope.organizationId.trim()
  const organizationName = req.scope.organizationName.trim()
  if (!organizationId || !organizationName) {
    return { type: "personal" }
  }
  return { type: "organization", organizationId, organizationName }
}

function sameStringArray(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index])
}

function sameActiveRun(left: ChatActiveRun, right: ChatActiveRun): boolean {
  return (
    left.activeAssistantMessageId === right.activeAssistantMessageId &&
    left.generationId === right.generationId &&
    left.phase === right.phase &&
    left.runId === right.runId &&
    left.sessionId === right.sessionId &&
    left.startedAt === right.startedAt &&
    left.workspace.type === right.workspace.type &&
    (left.workspace.type !== "organization" ||
      (right.workspace.type === "organization" &&
        left.workspace.organizationId === right.workspace.organizationId &&
        left.workspace.organizationName === right.workspace.organizationName)) &&
    sameStringArray(left.activeToolPartIds, right.activeToolPartIds) &&
    sameStringArray(left.blockingRequestIds, right.blockingRequestIds)
  )
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
  trustedAttachmentPaths?: ReadonlySet<string>
  turnOutputStore?: TurnOutputStore
  /** 渲染层切换组织 workspace 时，同步 agent 的组织作用域（main 持有 agent 与 activeAgentOrganizationName）。 */
  onSetAgentOrganization?: (organizationName: string | undefined) => Promise<void> | void
}

interface SessionGeneration {
  controller: AbortController
  id: string
}

const trustedLocalPathRootsCacheMs = 1_000

interface StopSessionGenerationOptions {
  abortAgent: boolean
  reason: "system" | "user"
  throwOnAbortFailure: boolean
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

export class ChatServiceImpl extends ConnectionService<ChatService> implements IConnectionService<ChatService> {
  public readonly sessionActivity = new ServiceEvent<{ sessionId: string; usedAt: number }>()

  private agent: AgentManager | null
  private bridged = false
  private userStoppedSessions = new Map<string, number>()
  private emittedMessageErrors = new Map<string, Set<string>>()
  private sessionGenerations = new Map<string, SessionGeneration>()
  private activeRuns = new Map<string, ChatActiveRun>()
  private activeRunBlockingPhases = new Map<
    string,
    Map<string, Extract<ChatRunPhase, "awaiting_permission" | "awaiting_question">>
  >()
  private pendingArtifactDirs = new Map<string, string[]>()
  private pendingProcessDirs = new Map<string, string[]>()
  // 按 generation id 索引，避免旧 generation 的 late cleanup 误删同 session 的新 turn output。
  private activeTurnOutputs = new Map<string, ActiveTurnOutput>()
  private activeAssistantMessages = new Map<string, string>()
  private activeToolParts = new Map<string, Set<string>>()
  private generationStartWatchdogs = new Map<string, NodeJS.Timeout>()
  private generationInactivityWatchdogs = new Map<string, NodeJS.Timeout>()
  private connectionFailedSessions = new Set<string>()
  private childSessionsByParent = new Map<string, Set<string>>()
  private parentSessionByChild = new Map<string, string>()
  private trustedProjectRoots = new Map<string, string>()
  private trustedSubagentSessionsByParent = new Map<string, Set<string>>()
  private trustedAttachmentPaths = new Map<string, Set<string>>()
  private trustedPermissionPaths = new Map<string, Set<string>>()
  private trustedLocalPathRootsCache: { expiresAt: number; roots: string[] } | undefined
  private trustedLocalPathRootsGeneration = 0
  private permissionModes = new Map<string, AgentPermissionMode>()
  private permissionModeVersions = new Map<string, number>()
  private sessionPermissionGrants = new Map<string, SessionPermissionGrant[]>()
  private automaticPermissionReplies = new Set<string>()
  private pendingPermissionRequests = new Map<string, ChatPermissionRequest>()
  private readonly deps: ChatServiceDeps
  private agentStatus: AgentRuntimeStatus = { status: "signed_out" }
  private transientArtifactBundles: ArtifactBundles = new Map()
  private authorizationOverlays: AuthorizationOverlays = new Map()
  private authorizationOverlaysLoaded = false
  private authorizationOverlaysLoadPromise: Promise<void> | null = null
  private authorizationOverlayWritePromise: Promise<void> = Promise.resolve()
  private stoppedGenerations: StoppedGenerations = new Map()
  private stoppedGenerationsLoaded = false
  private stoppedGenerationsLoadPromise: Promise<void> | null = null
  private transientTurnOutputs: TurnOutputRecords = new Map()
  private scopeMutationQueue: Promise<void> = Promise.resolve()
  private desiredWorkspaceOrganizationName: string | undefined
  private streamEventBuffer: ChatStreamEventBuffer | null = null
  private startedMessages = new Set<string>()

  public constructor(agent: AgentManager | null = null, deps: ChatServiceDeps = {}) {
    super(ChatServiceName)
    this.agent = agent
    this.deps = deps
  }

  public override dispose(): void {
    this.streamEventBuffer?.clear()
    this.streamEventBuffer = null
    super.dispose()
  }

  /** 登录 / 登出时由 main 重新装配 agent（旧 agent 的事件流随其 dispose 终止）。 */
  public setAgent(agent: AgentManager | null): void {
    this.streamEventBuffer?.clear()
    this.streamEventBuffer = null
    this.agent = agent
    this.bridged = false
    this.userStoppedSessions.clear()
    this.emittedMessageErrors.clear()
    for (const sessionId of this.activeRuns.keys()) {
      this.deleteActiveRun(sessionId)
    }
    this.abortSessionGenerations()
    this.sessionGenerations.clear()
    this.activeRuns.clear()
    this.activeRunBlockingPhases.clear()
    this.pendingArtifactDirs.clear()
    this.pendingProcessDirs.clear()
    this.activeTurnOutputs.clear()
    this.activeAssistantMessages.clear()
    this.activeToolParts.clear()
    this.clearAllGenerationStartWatchdogs()
    this.clearAllGenerationInactivityWatchdogs()
    this.connectionFailedSessions.clear()
    this.childSessionsByParent.clear()
    this.parentSessionByChild.clear()
    this.trustedProjectRoots.clear()
    this.trustedSubagentSessionsByParent.clear()
    this.trustedAttachmentPaths.clear()
    this.trustedPermissionPaths.clear()
    this.invalidateTrustedLocalPathRoots()
    this.permissionModes.clear()
    this.permissionModeVersions.clear()
    this.sessionPermissionGrants.clear()
    this.automaticPermissionReplies.clear()
    this.pendingPermissionRequests.clear()
    this.transientArtifactBundles.clear()
    this.authorizationOverlays.clear()
    this.authorizationOverlaysLoaded = false
    this.authorizationOverlaysLoadPromise = null
    this.stoppedGenerations.clear()
    this.stoppedGenerationsLoaded = false
    this.stoppedGenerationsLoadPromise = null
    this.transientTurnOutputs.clear()
    this.desiredWorkspaceOrganizationName = undefined
    this.startedMessages.clear()
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
    return (
      this.activeAssistantMessages.size > 0 ||
      this.pendingArtifactDirs.size > 0 ||
      this.pendingProcessDirs.size > 0 ||
      this.sessionGenerations.size > 0
    )
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
                .find((sessionId) => this.consumeUserStopAbort(sessionId, translated.data.message))
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
              this.deleteActiveRun(sessionId)
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
        if (this.shouldSuppressUserStoppedEvent(translated)) {
          continue
        }
        const activitySessionId = generationSessionId ?? sourceSessionId
        if (activitySessionId) {
          this.clearGenerationStartWatchdog(activitySessionId)
        }
        if (translated.event === "messageStarted") {
          this.emitSessionActivity(generationSessionId ?? translated.data.sessionId)
          if (!this.rememberMessageStarted(translated)) {
            continue
          }
        }
        if (translated.event === "permissionAsked" && this.answerLocalAccessPermission(emit, translated.data.request)) {
          if (generationSessionId) {
            this.clearGenerationInactivityWatchdog(generationSessionId)
          }
          continue
        }
        const displayed = this.translatedForDisplay(translated)
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
        this.updateActiveRunFromEvent(displayed)
        if (translated.event === "messageStarted" && translated.data.role === "assistant") {
          this.activeAssistantMessages.set(translated.data.sessionId, translated.data.messageId)
          this.activeToolParts.set(translated.data.sessionId, new Set())
          const artifactRoot = this.consumePendingArtifactDir(translated.data.sessionId)
          const processRoot = this.consumePendingProcessDir(translated.data.sessionId)
          if (artifactRoot && processRoot) {
            const activeTurn = this.activeTurnOutputForSession(translated.data.sessionId)
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
          this.updateActiveRun(translated.data.sessionId, {
            activeAssistantMessageId: translated.data.messageId,
            activeToolPartIds: [...partIds],
            phase: "tool_running",
          })
          const childSessionId = taskChildSessionId(translated.data)
          if (childSessionId) {
            this.rememberChildSession(translated.data.sessionId, childSessionId)
            this.rememberTrustedSubagentSession(translated.data.sessionId, childSessionId)
          }
        }
        if (translated.event === "toolCallResult") {
          const partIds = this.activeToolParts.get(translated.data.sessionId)
          partIds?.delete(translated.data.partId)
          if (partIds?.size === 0) {
            this.activeToolParts.delete(translated.data.sessionId)
          }
          this.updateActiveRun(translated.data.sessionId, {
            activeAssistantMessageId: translated.data.messageId,
            activeToolPartIds: partIds ? [...partIds] : [],
            phase: partIds && partIds.size > 0 ? "tool_running" : "thinking",
          })
          const childSessionId = taskChildSessionId(translated.data)
          if (childSessionId) {
            this.forgetChildSession(translated.data.sessionId, childSessionId)
            this.forgetTrustedSubagentSession(translated.data.sessionId, childSessionId)
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
          this.clearGenerationInactivityWatchdog(sessionId)
          void this.interruptSessionGeneration(emit, sessionId, "runtime_error", translated.data.message, {
            abortAgent: false,
          })
          continue
        }
        if (translated.event === "messageCompleted") {
          const sessionId = translated.data.sessionId
          const messageId = this.activeAssistantMessages.get(sessionId)
          this.clearGenerationInactivityWatchdog(sessionId)
          void this.finalizeTurnOutput(sessionId, messageId)
            .catch((error: unknown) => {
              console.warn("[wanta] failed to finalize turn output", error)
            })
            .finally(() => {
              this.clearSessionGeneration(sessionId)
              this.activeAssistantMessages.delete(sessionId)
              this.activeToolParts.delete(sessionId)
              this.deleteActiveRun(sessionId)
              this.emitSessionActivity(sessionId)
              this.sendBestEffort(emit, translated.event, translated.data, { sessionId })
            })
          continue
        }
        if (sourceSessionId) {
          if (inactivityWatchdogActionForEvent(displayed.event) === "pause") {
            if (generationSessionId) {
              this.clearGenerationInactivityWatchdog(generationSessionId)
            }
          } else if (generationSessionId) {
            this.scheduleGenerationInactivityWatchdog(generationSessionId)
          }
        }
        if (displayed.event === "messageDelta" || displayed.event === "messageReasoningDelta") {
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
      ...this.sessionGenerations.keys(),
      ...this.activeAssistantMessages.keys(),
      ...this.pendingArtifactDirs.keys(),
      ...this.pendingProcessDirs.keys(),
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

  private enqueuePendingArtifactDir(sessionId: string, artifactDir: string): void {
    const queue = this.pendingArtifactDirs.get(sessionId) ?? []
    queue.push(artifactDir)
    this.pendingArtifactDirs.set(sessionId, queue)
  }

  private enqueuePendingProcessDir(sessionId: string, processDir: string): void {
    const queue = this.pendingProcessDirs.get(sessionId) ?? []
    queue.push(processDir)
    this.pendingProcessDirs.set(sessionId, queue)
  }

  private consumePendingArtifactDir(sessionId: string): string | undefined {
    const queue = this.pendingArtifactDirs.get(sessionId)
    const artifactDir = queue?.shift()
    if (!queue || queue.length === 0) {
      this.pendingArtifactDirs.delete(sessionId)
    }
    return artifactDir
  }

  private consumePendingProcessDir(sessionId: string): string | undefined {
    const queue = this.pendingProcessDirs.get(sessionId)
    const processDir = queue?.shift()
    if (!queue || queue.length === 0) {
      this.pendingProcessDirs.delete(sessionId)
    }
    return processDir
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

  private removePendingProcessDir(sessionId: string, processDir: string): void {
    const queue = this.pendingProcessDirs.get(sessionId)
    if (!queue) {
      return
    }
    const next = queue.filter((item) => item !== processDir)
    if (next.length === 0) {
      this.pendingProcessDirs.delete(sessionId)
      return
    }
    this.pendingProcessDirs.set(sessionId, next)
  }

  private deleteActiveTurnOutput(sessionId: string, generationId?: string): void {
    const activeGenerationId = generationId ?? this.sessionGenerations.get(sessionId)?.id
    if (!activeGenerationId) {
      return
    }
    if (this.activeTurnOutputs.delete(activeGenerationId)) {
      this.invalidateTrustedLocalPathRoots()
    }
  }

  private activeTurnOutputForSession(sessionId: string): ActiveTurnOutput | undefined {
    const generationId = this.sessionGenerations.get(sessionId)?.id
    if (!generationId) {
      return
    }
    return this.activeTurnOutputs.get(generationId)
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
      this.streamEventBuffer?.flush()
    }
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

  private emitActiveRunUpdated(
    sessionId: string,
    run: ChatActiveRun | null,
    ended?: { endedAt: number; endedRunId: string },
  ): void {
    this.sendBestEffort(this.send.bind(this) as (event: string, data: unknown) => Promise<void>, "activeRunUpdated", {
      ...ended,
      run,
      sessionId,
    })
  }

  private activeRunBlockingPhase(
    sessionId: string,
  ): Extract<ChatRunPhase, "awaiting_permission" | "awaiting_question"> | null {
    const blocks = this.activeRunBlockingPhases.get(sessionId)
    if (!blocks || blocks.size === 0) {
      return null
    }
    for (const phase of blocks.values()) {
      if (phase === "awaiting_permission") {
        return "awaiting_permission"
      }
    }
    return "awaiting_question"
  }

  private createActiveRun(req: SendMessageRequest, generation: SessionGeneration): void {
    const now = Date.now()
    const run: ChatActiveRun = {
      activeToolPartIds: [],
      blockingRequestIds: [],
      generationId: generation.id,
      phase: "sending",
      runId: generation.id,
      sessionId: req.sessionId,
      startedAt: now,
      updatedAt: now,
      workspace: runWorkspaceFromRequest(req),
    }
    this.activeRunBlockingPhases.delete(req.sessionId)
    this.activeRuns.set(req.sessionId, run)
    this.emitActiveRunUpdated(req.sessionId, run)
  }

  private updateActiveRun(
    sessionId: string,
    patch: Partial<
      Pick<ChatActiveRun, "activeAssistantMessageId" | "activeToolPartIds" | "blockingRequestIds" | "phase">
    >,
  ): void {
    const current = this.activeRuns.get(sessionId)
    if (!current) {
      return
    }
    const blockingPhase = this.activeRunBlockingPhase(sessionId)
    const requestedPhase = patch.phase
    const nextPhase =
      requestedPhase === "awaiting_permission" || requestedPhase === "awaiting_question"
        ? requestedPhase
        : (blockingPhase ?? requestedPhase ?? current.phase)
    const next: ChatActiveRun = {
      ...current,
      ...(patch.activeAssistantMessageId === undefined
        ? {}
        : { activeAssistantMessageId: patch.activeAssistantMessageId }),
      ...(patch.activeToolPartIds === undefined ? {} : { activeToolPartIds: patch.activeToolPartIds }),
      ...(patch.blockingRequestIds === undefined ? {} : { blockingRequestIds: patch.blockingRequestIds }),
      phase: nextPhase,
      updatedAt: Date.now(),
    }
    if (sameActiveRun(current, next)) {
      return
    }
    this.activeRuns.set(sessionId, next)
    this.emitActiveRunUpdated(sessionId, next)
  }

  private deleteActiveRun(sessionId: string, generationId?: string): void {
    const current = this.activeRuns.get(sessionId)
    if (!current || (generationId && current.generationId !== generationId)) {
      return
    }
    this.activeRuns.delete(sessionId)
    this.activeRunBlockingPhases.delete(sessionId)
    this.emitActiveRunUpdated(sessionId, null, { endedAt: Date.now(), endedRunId: current.runId })
  }

  private addActiveRunBlockingRequest(
    sessionId: string,
    requestId: string,
    phase: Extract<ChatRunPhase, "awaiting_permission" | "awaiting_question">,
  ): void {
    if (!this.activeRuns.has(sessionId)) {
      return
    }
    const blocks = this.activeRunBlockingPhases.get(sessionId) ?? new Map()
    blocks.set(requestId, phase)
    this.activeRunBlockingPhases.set(sessionId, blocks)
    this.updateActiveRun(sessionId, { blockingRequestIds: [...blocks.keys()], phase })
  }

  private removeActiveRunBlockingRequest(sessionId: string, requestId: string): void {
    const blocks = this.activeRunBlockingPhases.get(sessionId)
    if (blocks) {
      blocks.delete(requestId)
      if (blocks.size === 0) {
        this.activeRunBlockingPhases.delete(sessionId)
      }
    }
    const remainingRequestIds = blocks && blocks.size > 0 ? [...blocks.keys()] : []
    this.updateActiveRun(sessionId, {
      blockingRequestIds: remainingRequestIds,
      phase: this.activeRunBlockingPhase(sessionId) ?? "thinking",
    })
  }

  private updateActiveRunFromEvent(translated: ChatEmit): void {
    const sessionId = translated.data.sessionId
    if (!sessionId) {
      return
    }
    switch (translated.event) {
      case "assistantActivity":
        this.updateActiveRun(sessionId, {
          activeAssistantMessageId: translated.data.messageId,
          phase: translated.data.phase === "retrying" ? "submitted" : "thinking",
        })
        break
      case "messageDelta":
        this.updateActiveRun(sessionId, {
          activeAssistantMessageId: translated.data.messageId,
          phase: translated.data.text || translated.data.delta ? "answering" : "thinking",
        })
        break
      case "messageReasoningDelta":
        this.updateActiveRun(sessionId, {
          activeAssistantMessageId: translated.data.messageId,
          phase: "thinking",
        })
        break
      case "messageStarted":
        if (translated.data.role === "assistant") {
          this.updateActiveRun(sessionId, {
            activeAssistantMessageId: translated.data.messageId,
            phase: "thinking",
          })
        }
        break
      case "permissionAsked":
        this.addActiveRunBlockingRequest(sessionId, translated.data.request.id, "awaiting_permission")
        break
      case "permissionReplied":
        this.removeActiveRunBlockingRequest(sessionId, translated.data.requestId)
        break
      case "questionAsked":
        this.addActiveRunBlockingRequest(sessionId, translated.data.request.id, "awaiting_question")
        break
      case "questionRejected":
      case "questionReplied":
        this.removeActiveRunBlockingRequest(sessionId, translated.data.requestId)
        break
      default:
        break
    }
  }

  private sessionPermissionMode(sessionId: string): AgentPermissionMode {
    return this.permissionModes.get(sessionId) ?? "default"
  }

  private setSessionPermissionModeValue(sessionId: string, mode: AgentPermissionMode, version?: number): boolean {
    if (typeof version === "number") {
      const currentVersion = this.permissionModeVersions.get(sessionId) ?? 0
      if (version < currentVersion) {
        return false
      }
      this.permissionModeVersions.set(sessionId, version)
    }
    this.permissionModes.set(sessionId, mode)
    return true
  }

  private addSessionPermissionGrant(sessionId: string, request: ChatPermissionRequest): void {
    const trustedProjectRoot = this.trustedProjectRoots.get(sessionId)
    const generationId = this.sessionGenerations.get(sessionId)?.id
    const managedPythonProcessRoot = generationId ? this.activeTurnOutputs.get(generationId)?.processRoot : undefined
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
    const grants = this.sessionPermissionGrants.get(sessionId) ?? []
    const exists = grants.some(
      (item) =>
        item.action === grant.action &&
        item.kind === grant.kind &&
        item.patterns.join("\n") === grant.patterns.join("\n") &&
        item.generationId === grant.generationId &&
        item.projectRoot === grant.projectRoot &&
        item.processRoot === grant.processRoot,
    )
    if (!exists) {
      this.sessionPermissionGrants.set(sessionId, [...grants, grant])
    }
    this.rememberTrustedPermissionResources(sessionId, request)
  }

  private removeGenerationPermissionGrants(sessionId: string, generationId: string | undefined): void {
    if (!generationId) {
      return
    }
    const grants = this.sessionPermissionGrants.get(sessionId)
    if (!grants) {
      return
    }
    const retained = grants.filter((grant) => grant.generationId !== generationId)
    if (retained.length === grants.length) {
      return
    }
    if (retained.length > 0) {
      this.sessionPermissionGrants.set(sessionId, retained)
    } else {
      this.sessionPermissionGrants.delete(sessionId)
    }
  }

  private rememberPendingPermissionRequest(request: ChatPermissionRequest): void {
    this.pendingPermissionRequests.set(permissionReplyKey(request.sessionId, request.id), request)
  }

  private forgetPendingPermissionRequest(sessionId: string, requestId: string): void {
    this.pendingPermissionRequests.delete(permissionReplyKey(sessionId, requestId))
  }

  private forgetSessionPendingPermissionRequests(sessionId: string): void {
    for (const [key, request] of this.pendingPermissionRequests) {
      if (request.sessionId === sessionId) {
        this.pendingPermissionRequests.delete(key)
      }
    }
  }

  private pendingPermissionRequest(sessionId: string, requestId: string): ChatPermissionRequest | undefined {
    return this.pendingPermissionRequests.get(permissionReplyKey(sessionId, requestId))
  }

  private answerLocalAccessPermission(
    emit: (event: string, data: unknown) => Promise<void>,
    request: ChatPermissionRequest,
  ): boolean {
    const projectRoot = this.trustedProjectRoots.get(request.sessionId)
    const decision = evaluateLocalAccessRequest(request, {
      activeGenerationId: this.sessionGenerations.get(request.sessionId)?.id,
      permissionMode: this.sessionPermissionMode(request.sessionId),
      sessionGrants: this.sessionPermissionGrants.get(request.sessionId),
      ...(projectRoot ? { trustedProjectRoot: projectRoot } : {}),
    })
    if (!this.agent || decision.type !== "allow") {
      return false
    }
    const displaySessionId = this.displaySessionIdForEvent(request.sessionId)
    const displayRequest =
      displaySessionId === request.sessionId ? request : { ...request, sessionId: displaySessionId }
    const replyKey = permissionReplyKey(request.sessionId, request.id)
    if (this.automaticPermissionReplies.has(replyKey)) {
      return true
    }
    this.automaticPermissionReplies.add(replyKey)
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
        this.removeActiveRunBlockingRequest(displaySessionId, request.id)
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
        this.addActiveRunBlockingRequest(displaySessionId, request.id, "awaiting_permission")
        this.sendBestEffort(
          emit,
          "permissionAsked",
          { sessionId: displaySessionId, request: displayRequest },
          { sessionId: displaySessionId },
        )
      })
      .finally(() => {
        this.automaticPermissionReplies.delete(replyKey)
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

  private rememberChildSession(parentSessionId: string, childSessionId: string): void {
    const childSessionIds = this.childSessionsByParent.get(parentSessionId) ?? new Set<string>()
    childSessionIds.add(childSessionId)
    this.childSessionsByParent.set(parentSessionId, childSessionIds)
    this.parentSessionByChild.set(childSessionId, parentSessionId)
  }

  private forgetChildSession(parentSessionId: string, childSessionId: string): void {
    const childSessionIds = this.childSessionsByParent.get(parentSessionId)
    if (childSessionIds) {
      childSessionIds.delete(childSessionId)
      if (childSessionIds.size === 0) {
        this.childSessionsByParent.delete(parentSessionId)
      }
    }
    if (this.parentSessionByChild.get(childSessionId) === parentSessionId) {
      this.parentSessionByChild.delete(childSessionId)
    }
  }

  private forgetChildSessions(parentSessionId: string): void {
    const childSessionIds = this.childSessionsByParent.get(parentSessionId)
    if (!childSessionIds) {
      return
    }
    for (const childSessionId of childSessionIds) {
      if (this.parentSessionByChild.get(childSessionId) === parentSessionId) {
        this.parentSessionByChild.delete(childSessionId)
      }
    }
    this.childSessionsByParent.delete(parentSessionId)
  }

  private displaySessionIdForEvent(sessionId: string): string {
    return this.parentSessionByChild.get(sessionId) ?? sessionId
  }

  private translatedForDisplay(translated: ChatEmit): ChatEmit {
    const sessionId = translated.data.sessionId
    if (!sessionId) {
      return translated
    }
    const displaySessionId = this.displaySessionIdForEvent(sessionId)
    if (displaySessionId === sessionId) {
      return translated
    }
    switch (translated.event) {
      case "permissionAsked":
        return {
          ...translated,
          data: {
            sessionId: displaySessionId,
            request: { ...translated.data.request, sessionId: displaySessionId },
          },
        }
      case "questionAsked":
        return {
          ...translated,
          data: {
            sessionId: displaySessionId,
            request: { ...translated.data.request, sessionId: displaySessionId },
          },
        }
      case "permissionReplied":
      case "questionRejected":
      case "questionReplied":
        return { ...translated, data: { ...translated.data, sessionId: displaySessionId } }
      default:
        return translated
    }
  }

  private rememberTrustedSubagentSession(parentSessionId: string, childSessionId: string): void {
    const projectRoot = this.trustedProjectRoots.get(parentSessionId)
    const permissionMode = this.permissionModes.get(parentSessionId)
    const permissionModeVersion = this.permissionModeVersions.get(parentSessionId)
    const sessionGrants = this.sessionPermissionGrants.get(parentSessionId)
    const permissionPaths = this.trustedPermissionPaths.get(parentSessionId)
    if (!projectRoot && !permissionMode && !sessionGrants && !permissionPaths) {
      return
    }
    if (projectRoot) {
      this.trustedProjectRoots.set(childSessionId, projectRoot)
    }
    if (permissionMode) {
      this.permissionModes.set(childSessionId, permissionMode)
    }
    if (typeof permissionModeVersion === "number") {
      this.permissionModeVersions.set(childSessionId, permissionModeVersion)
    }
    if (sessionGrants) {
      this.sessionPermissionGrants.set(childSessionId, [...sessionGrants])
    }
    if (permissionPaths) {
      this.trustedPermissionPaths.set(childSessionId, new Set(permissionPaths))
    }
    const childSessionIds = this.trustedSubagentSessionsByParent.get(parentSessionId) ?? new Set<string>()
    childSessionIds.add(childSessionId)
    this.trustedSubagentSessionsByParent.set(parentSessionId, childSessionIds)
    this.invalidateTrustedLocalPathRoots()
  }

  private forgetTrustedSubagentSession(parentSessionId: string, childSessionId: string): void {
    const childSessionIds = this.trustedSubagentSessionsByParent.get(parentSessionId)
    if (!childSessionIds?.has(childSessionId)) {
      return
    }
    childSessionIds.delete(childSessionId)
    this.trustedProjectRoots.delete(childSessionId)
    this.permissionModes.delete(childSessionId)
    this.permissionModeVersions.delete(childSessionId)
    this.sessionPermissionGrants.delete(childSessionId)
    this.trustedPermissionPaths.delete(childSessionId)
    this.forgetSessionPendingPermissionRequests(childSessionId)
    if (childSessionIds.size === 0) {
      this.trustedSubagentSessionsByParent.delete(parentSessionId)
    }
    this.invalidateTrustedLocalPathRoots()
  }

  private forgetTrustedSubagentSessions(parentSessionId: string): void {
    const childSessionIds = this.trustedSubagentSessionsByParent.get(parentSessionId)
    if (!childSessionIds) {
      return
    }
    for (const childSessionId of childSessionIds) {
      this.trustedProjectRoots.delete(childSessionId)
      this.permissionModes.delete(childSessionId)
      this.permissionModeVersions.delete(childSessionId)
      this.sessionPermissionGrants.delete(childSessionId)
      this.trustedPermissionPaths.delete(childSessionId)
      this.forgetSessionPendingPermissionRequests(childSessionId)
    }
    this.trustedSubagentSessionsByParent.delete(parentSessionId)
    this.invalidateTrustedLocalPathRoots()
  }

  private rememberTrustedAttachments(sessionId: string, attachments: readonly ChatAttachment[] | undefined): void {
    if (!attachments?.length) {
      return
    }
    const paths = this.trustedAttachmentPaths.get(sessionId) ?? new Set<string>()
    for (const attachment of attachments) {
      if (attachment.path.trim()) {
        paths.add(attachment.path)
      }
      if (attachment.agentPath?.trim()) {
        paths.add(attachment.agentPath)
      }
    }
    if (paths.size > 0) {
      this.trustedAttachmentPaths.set(sessionId, paths)
      this.invalidateTrustedLocalPathRoots()
    }
  }

  private rememberTrustedMessageAttachments(sessionId: string, messages: readonly ChatMessage[]): void {
    const attachments: ChatAttachment[] = []
    for (const message of messages) {
      if (message.role !== "user") {
        continue
      }
      for (const part of message.parts) {
        if (part.kind === "attachment" && part.attachment) {
          attachments.push(part.attachment)
        }
      }
    }
    this.rememberTrustedAttachments(sessionId, attachments)
  }

  private rememberTrustedPermissionResources(sessionId: string, request: ChatPermissionRequest): void {
    const paths = this.trustedPermissionPaths.get(sessionId) ?? new Set<string>()
    for (const resource of [...request.resources, ...(request.save ?? [])]) {
      const wildcardIndex = resource.search(/[*?[\]{}]/u)
      const candidate = wildcardIndex === -1 ? resource : resource.slice(0, wildcardIndex).replace(/[\\/]+$/u, "")
      const filePath = normalizeLocalPathCandidate(candidate, os.homedir())
      if (filePath) {
        paths.add(filePath)
      }
    }
    if (paths.size > 0) {
      this.trustedPermissionPaths.set(sessionId, paths)
      this.invalidateTrustedLocalPathRoots()
    }
  }

  private invalidateTrustedLocalPathRoots(): void {
    this.trustedLocalPathRootsGeneration += 1
    this.trustedLocalPathRootsCache = undefined
  }

  private async trustedLocalPathRoots(): Promise<string[]> {
    const cached = this.trustedLocalPathRootsCache
    if (cached && cached.expiresAt > Date.now()) {
      return cached.roots
    }
    const generation = this.trustedLocalPathRootsGeneration
    const roots = new Set<string>()
    for (const active of this.activeTurnOutputs.values()) {
      roots.add(active.artifactRoot)
      roots.add(active.processRoot)
      if (active.projectRoot) {
        roots.add(active.projectRoot)
      }
    }
    for (const projectRoot of this.trustedProjectRoots.values()) {
      roots.add(projectRoot)
    }
    for (const paths of this.trustedAttachmentPaths.values()) {
      for (const filePath of paths) {
        roots.add(filePath)
      }
    }
    for (const filePath of this.deps.trustedAttachmentPaths ?? []) {
      roots.add(filePath)
    }
    for (const paths of this.trustedPermissionPaths.values()) {
      for (const filePath of paths) {
        roots.add(filePath)
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
    const normalizedRoots = (
      await Promise.all([...roots].filter((root) => root.trim()).map((root) => realpath(root).catch(() => null)))
    ).filter((root): root is string => Boolean(root))
    if (this.trustedLocalPathRootsGeneration !== generation) {
      return this.trustedLocalPathRoots()
    }
    this.trustedLocalPathRootsCache = {
      expiresAt: Date.now() + trustedLocalPathRootsCacheMs,
      roots: normalizedRoots,
    }
    return normalizedRoots
  }

  private async isPathInTrustedRoots(filePath: string, roots: readonly string[]): Promise<boolean> {
    const target = await realpath(filePath).catch(() => null)
    if (!target) {
      return false
    }
    for (const root of roots) {
      if (isPathInside(root, target)) {
        return true
      }
    }
    return false
  }

  private async isTrustedLocalPath(filePath: string): Promise<boolean> {
    return this.isPathInTrustedRoots(filePath, await this.trustedLocalPathRoots())
  }

  private async assertTrustedLocalPath(filePath: string): Promise<void> {
    if (!(await this.isTrustedLocalPath(filePath))) {
      throw new Error("Local path is not available from this conversation.")
    }
  }

  private beginSessionGeneration(sessionId: string): SessionGeneration {
    const previousGeneration = this.sessionGenerations.get(sessionId)
    previousGeneration?.controller.abort()
    this.removeGenerationPermissionGrants(sessionId, previousGeneration?.id)
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
    const generation = this.sessionGenerations.get(sessionId)
    if (generationId && generation?.id !== generationId) {
      return
    }
    this.clearGenerationStartWatchdog(sessionId)
    this.clearGenerationInactivityWatchdog(sessionId)
    this.forgetChildSessions(sessionId)
    this.forgetTrustedSubagentSessions(sessionId)
    this.forgetSessionPendingPermissionRequests(sessionId)
    this.removeGenerationPermissionGrants(sessionId, generation?.id)
    this.sessionGenerations.delete(sessionId)
    this.deleteActiveRun(sessionId, generationId)
    void this.agent?.clearSessionOrganizationName(sessionId).catch((error: unknown) => {
      console.warn("[wanta] failed to clear session organization scope:", error)
    })
  }

  private scheduleGenerationStartWatchdog(sessionId: string, generationId: string): void {
    this.clearGenerationStartWatchdog(sessionId)
    const timer = setTimeout(() => {
      if (!this.isCurrentGeneration(sessionId, generationId)) {
        return
      }
      console.warn("[wanta] generation did not receive an OpenCode event before timeout:", { sessionId })
      logDiagnostic("chat-service", "generation did not receive opencode event before timeout", { sessionId }, "warn")
      void this.interruptSessionGeneration(
        this.send.bind(this) as (event: string, data: unknown) => Promise<void>,
        sessionId,
        "start_timeout",
        "CHAT_COMPLETION_INTERRUPTED: Agent runtime did not acknowledge this message. Please retry.",
        { abortAgent: true },
      )
    }, generationStartAckTimeoutMs)
    timer.unref?.()
    this.generationStartWatchdogs.set(sessionId, timer)
  }

  private scheduleGenerationSubmitWatchdog(sessionId: string, generationId: string): void {
    this.clearGenerationStartWatchdog(sessionId)
    const timer = setTimeout(() => {
      if (!this.isCurrentGeneration(sessionId, generationId)) {
        return
      }
      console.warn("[wanta] generation was not accepted by OpenCode before timeout:", { sessionId })
      logDiagnostic("chat-service", "generation was not accepted by opencode before timeout", { sessionId }, "warn")
      void this.interruptSessionGeneration(
        this.send.bind(this) as (event: string, data: unknown) => Promise<void>,
        sessionId,
        "submit_timeout",
        "CHAT_COMPLETION_INTERRUPTED: Agent runtime did not accept this message. Please retry.",
        { abortAgent: true },
      )
    }, generationSubmitTimeoutMs)
    timer.unref?.()
    this.generationStartWatchdogs.set(sessionId, timer)
  }

  private clearGenerationStartWatchdog(sessionId: string): void {
    const timer = this.generationStartWatchdogs.get(sessionId)
    if (!timer) {
      return
    }
    clearTimeout(timer)
    this.generationStartWatchdogs.delete(sessionId)
  }

  private clearAllGenerationStartWatchdogs(): void {
    for (const timer of this.generationStartWatchdogs.values()) {
      clearTimeout(timer)
    }
    this.generationStartWatchdogs.clear()
  }

  private generationInactivityTimeoutForSession(sessionId: string): number {
    return (this.activeToolParts.get(sessionId)?.size ?? 0) > 0
      ? generationActiveToolInactivityTimeoutMs
      : generationInactivityTimeoutMs
  }

  private scheduleGenerationInactivityWatchdog(sessionId: string): void {
    const generation = this.sessionGenerations.get(sessionId)
    if (!generation) {
      return
    }
    this.clearGenerationInactivityWatchdog(sessionId)
    const generationId = generation.id
    const timeoutMs = this.generationInactivityTimeoutForSession(sessionId)
    const timer = setTimeout(() => {
      this.generationInactivityWatchdogs.delete(sessionId)
      if (!this.isCurrentGeneration(sessionId, generationId)) {
        return
      }
      const noticeKind = generationNoticeKindForInactivity({
        activeToolCount: this.activeToolParts.get(sessionId)?.size ?? 0,
        blocked: Boolean(this.activeRunBlockingPhase(sessionId)),
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
    }, timeoutMs)
    timer.unref?.()
    this.generationInactivityWatchdogs.set(sessionId, timer)
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
    if (this.sessionGenerations.has(sessionId)) {
      return sessionId
    }
    const parentSessionId = this.parentSessionByChild.get(sessionId)
    if (parentSessionId && this.sessionGenerations.has(parentSessionId)) {
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

  private clearGenerationInactivityWatchdog(sessionId: string): void {
    const timer = this.generationInactivityWatchdogs.get(sessionId)
    if (!timer) {
      return
    }
    clearTimeout(timer)
    this.generationInactivityWatchdogs.delete(sessionId)
  }

  private clearAllGenerationInactivityWatchdogs(): void {
    for (const timer of this.generationInactivityWatchdogs.values()) {
      clearTimeout(timer)
    }
    this.generationInactivityWatchdogs.clear()
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

  private async stopSessionGeneration(sessionId: string, options: StopSessionGenerationOptions): Promise<void> {
    if (!this.agent) {
      return
    }
    const generation = this.sessionGenerations.get(sessionId)
    generation?.controller.abort()
    const messageId = this.activeAssistantMessages.get(sessionId)
    const partIds = [...(this.activeToolParts.get(sessionId) ?? [])]
    const stoppedAt = Date.now()
    if (options.abortAgent) {
      try {
        await this.agent.abort(sessionId)
      } catch (error) {
        if (options.throwOnAbortFailure && (messageId || !generation)) {
          this.userStoppedSessions.delete(sessionId)
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
    this.pendingArtifactDirs.delete(sessionId)
    this.pendingProcessDirs.delete(sessionId)
    this.deleteActiveTurnOutput(sessionId, generation?.id)
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
    const messages = await this.getMessages(sessionId)
    const [pendingQuestions, pendingPermissions] = await Promise.all([
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
    this.setSessionPermissionModeValue(
      req.sessionId,
      req.permissionMode ?? this.sessionPermissionMode(req.sessionId),
      req.permissionModeVersion,
    )
    this.rememberTrustedAttachments(req.sessionId, req.attachments)
    const organizationName = organizationNameFromRequest(req)
    let generation: SessionGeneration | undefined
    let artifactDir: string | undefined
    let processDir: string | undefined
    try {
      generation = this.beginSessionGeneration(req.sessionId)
      this.createActiveRun(req, generation)
      const activeGeneration = generation
      this.userStoppedSessions.delete(req.sessionId)
      this.connectionFailedSessions.delete(req.sessionId)
      this.clearMessageErrorSignatures(req.sessionId)
      this.emitSessionActivity(req.sessionId)
      await this.agent.setSessionOrganizationName(req.sessionId, organizationName)
      if (!this.isCurrentGeneration(req.sessionId, activeGeneration.id) || activeGeneration.controller.signal.aborted) {
        this.clearSessionGeneration(req.sessionId, activeGeneration.id)
        return
      }
      ;[artifactDir, processDir] = await Promise.all([
        this.agent.createArtifactDir(req.sessionId),
        this.agent.createProcessDir(req.sessionId),
      ])
      if (!this.isCurrentGeneration(req.sessionId, activeGeneration.id) || activeGeneration.controller.signal.aborted) {
        this.clearSessionGeneration(req.sessionId, activeGeneration.id)
        return
      }
      const trustedProjectRoot = await this.resolveTrustedProjectRoot(req.projectContext)
      if (trustedProjectRoot) {
        this.trustedProjectRoots.set(req.sessionId, trustedProjectRoot)
      } else {
        this.trustedProjectRoots.delete(req.sessionId)
      }
      this.invalidateTrustedLocalPathRoots()
      const project = await this.projectBaseline(req.projectContext)
      const artifactBaseline = await captureArtifactSessionBaseline(
        this.agent.artifactSessionDir(req.sessionId),
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
      this.enqueuePendingArtifactDir(req.sessionId, artifactDir)
      this.enqueuePendingProcessDir(req.sessionId, processDir)
      this.activeTurnOutputs.set(activeGeneration.id, {
        artifactRoot: artifactDir,
        processRoot: processDir,
        createdAt: Date.now(),
        generationId: activeGeneration.id,
        requestText: req.text,
        ...(artifactBaseline ? { artifactBaseline } : {}),
        ...(project.baseline ? { projectBaseline: project.baseline } : {}),
        ...(project.projectRoot ? { projectRoot: project.projectRoot } : {}),
      })
      this.invalidateTrustedLocalPathRoots()
      const promptGeneration = activeGeneration
      // promptStreaming 的结果经 SSE 推送；RPC 只确认主进程已接收本轮发送，避免首条消息 UI 等到流式内容已累积后才切换。
      this.updateActiveRun(req.sessionId, { phase: "submitted" })
      this.scheduleGenerationSubmitWatchdog(req.sessionId, promptGeneration.id)
      void this.agent
        .promptStreaming(req.sessionId, req.text, {
          attachments: req.attachments,
          artifactDir,
          processDir,
          mode: req.mode,
          model: req.model,
          organizationName,
          reasoningLevel: req.reasoningLevel,
          signal: promptGeneration.controller.signal,
          system: mergeSystemPrompts(
            buildOrganizationSkillsSystem(req.organizationSkills),
            buildContextMentionsSystemPrompt(req.contextMentions),
            buildProjectContextSystem(req.projectContext),
            buildPermissionModeSystem(req.permissionMode),
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
        .catch((error: unknown) => {
          if (artifactDir) {
            this.removePendingArtifactDir(req.sessionId, artifactDir)
          }
          if (processDir) {
            this.removePendingProcessDir(req.sessionId, processDir)
          }
          this.deleteActiveTurnOutput(req.sessionId, promptGeneration.id)
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
        this.clearSessionGeneration(req.sessionId, generation.id)
      }
      throw error
    }
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

  private async readTurnOutputs(): Promise<TurnOutputRecords> {
    return this.deps.turnOutputStore?.read() ?? this.transientTurnOutputs
  }

  private async readArtifactBundles(): Promise<ArtifactBundles> {
    return this.deps.artifactBundleStore?.read() ?? this.transientArtifactBundles
  }

  private async rememberArtifactBundle(bundle: ArtifactBundle): Promise<void> {
    if (this.deps.artifactBundleStore) {
      await this.deps.artifactBundleStore.record(bundle)
      this.invalidateTrustedLocalPathRoots()
      return
    }
    recordArtifactBundle(this.transientArtifactBundles, bundle)
    this.invalidateTrustedLocalPathRoots()
  }

  private async publishArtifactBundle(bundle: ArtifactBundle): Promise<void> {
    await this.rememberArtifactBundle(bundle)
    await this.send("artifactBundleUpdated", {
      sessionId: bundle.sessionId,
      messageId: bundle.messageId,
    }).catch((error: unknown) => {
      console.warn("[wanta] failed to emit artifact bundle update", error)
      logDiagnostic(
        "chat-service",
        "failed to emit artifact bundle update",
        { error, messageId: bundle.messageId, sessionId: bundle.sessionId },
        "warn",
      )
    })
  }

  private async ensureAuthorizationOverlaysLoaded(): Promise<void> {
    if (this.authorizationOverlaysLoaded) {
      return
    }
    if (this.authorizationOverlaysLoadPromise) {
      return this.authorizationOverlaysLoadPromise
    }
    this.authorizationOverlaysLoadPromise = (async () => {
      this.authorizationOverlays = (await this.deps.authorizationOverlayStore?.read()) ?? new Map()
      this.authorizationOverlaysLoaded = true
      this.authorizationOverlaysLoadPromise = null
    })()
    return this.authorizationOverlaysLoadPromise
  }

  private async rememberAuthorizationOverlay(
    sessionId: string,
    messageId: string,
    partId: string,
    authorization: AuthorizationInfo,
  ): Promise<void> {
    await this.ensureAuthorizationOverlaysLoaded()
    if (!recordAuthorizationOverlay(this.authorizationOverlays, sessionId, messageId, partId, authorization)) {
      return
    }
    const write = this.authorizationOverlayWritePromise
      .catch((error: unknown) => {
        this.logQueuedWriteFailure("authorization overlay", error)
      })
      .then(async () => {
        await this.deps.authorizationOverlayStore?.write(this.authorizationOverlays)
      })
    this.authorizationOverlayWritePromise = write.then(
      () => undefined,
      () => undefined,
    )
    await write
  }

  private async rememberStoppedGeneration(
    sessionId: string,
    messageId: string,
    partIds: string[],
    stoppedAt = Date.now(),
  ): Promise<void> {
    await this.ensureStoppedGenerationsLoaded()
    if (!recordStoppedGeneration(this.stoppedGenerations, sessionId, messageId, partIds, stoppedAt)) {
      return
    }
    await this.deps.stoppedGenerationStore?.write(this.stoppedGenerations)
  }

  private logQueuedWriteFailure(scope: string, error: unknown): void {
    console.warn(`[wanta] previous ${scope} write failed:`, error)
    logDiagnostic("chat-service", "previous queued write failed", { error, scope }, "warn")
  }

  private async rememberTurnOutput(record: StoredTurnOutputRecord): Promise<void> {
    if (this.deps.turnOutputStore) {
      await this.deps.turnOutputStore.record(record)
      this.invalidateTrustedLocalPathRoots()
      return
    }
    recordTurnOutput(this.transientTurnOutputs, record)
    this.invalidateTrustedLocalPathRoots()
  }

  private async projectBaseline(project: ChatProjectContext | undefined): Promise<{
    baseline?: GitTurnBaseline
    projectRoot?: string
  }> {
    const repositoryRoot = project?.git?.repositoryRoot?.trim()
    if (!project || !repositoryRoot || !this.deps.projectStore) {
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
        baseline: await captureGitTurnBaseline(repositoryRoot),
        projectRoot: repositoryRoot,
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
    const generationId = this.sessionGenerations.get(sessionId)?.id
    const active = generationId ? this.activeTurnOutputs.get(generationId) : undefined
    if (generationId) {
      if (this.activeTurnOutputs.delete(generationId)) {
        this.invalidateTrustedLocalPathRoots()
      }
    }
    const resolvedMessageId = messageId ?? active?.messageId
    if (!active) {
      return
    }
    try {
      if (!resolvedMessageId) {
        return
      }
      const messages = await this.agent?.getMessages(sessionId).catch(() => [])
      const materializedOrigins = await materializeAssistantArtifacts(
        messages ?? [],
        resolvedMessageId,
        active.artifactRoot,
      ).catch((error: unknown) => {
        console.warn("[wanta] failed to materialize assistant artifacts", error)
        logDiagnostic(
          "chat-service",
          "failed to materialize assistant artifacts",
          { error, messageId: resolvedMessageId, sessionId },
          "warn",
        )
        return new Map()
      })
      const recoveredOrigins = await recoverMisplacedTurnArtifacts(active.artifactBaseline, active.artifactRoot).catch(
        (error: unknown) => {
          console.warn("[wanta] failed to recover misplaced turn artifacts", error)
          logDiagnostic(
            "chat-service",
            "failed to recover misplaced turn artifacts",
            { error, messageId: resolvedMessageId, sessionId },
            "warn",
          )
          return new Map()
        },
      )
      for (const [relativePath, origin] of recoveredOrigins) {
        materializedOrigins.set(relativePath, origin)
      }
      const [artifactBundle, processFiles, intermediateArtifactFiles, projectFiles] = await Promise.all([
        buildArtifactBundle({
          artifactRoot: active.artifactRoot,
          completedAt: Date.now(),
          createdAt: active.createdAt,
          generatedPreviewCount: generatedImagePreviewCount(messages ?? [], resolvedMessageId),
          materializedOrigins,
          messageId: resolvedMessageId,
          sessionId,
        }),
        processOutputFiles(active.processRoot),
        intermediateArtifactProcessFiles(active.artifactRoot, active.requestText),
        projectOutputFiles(active.projectBaseline, active.projectRoot),
      ])
      if (artifactBundle) {
        await this.publishArtifactBundle(artifactBundle)
      }
      const files = [...processFiles, ...intermediateArtifactFiles, ...projectFiles]
      if (files.length === 0) {
        return
      }
      const record: StoredTurnOutputRecord = {
        sessionId,
        messageId: resolvedMessageId,
        processRoot: active.processRoot,
        ...(active.projectRoot ? { projectRoot: active.projectRoot } : {}),
        createdAt: active.createdAt,
        completedAt: Date.now(),
        files,
        summary: summarizeTurnFiles(files),
      }
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
    } finally {
      await rm(managedPythonEnvironmentPath(active.processRoot), { force: true, recursive: true }).catch(
        () => undefined,
      )
    }
  }

  public async getAttachmentPreview(req: AttachmentPreviewRequest): Promise<AttachmentPreviewResult> {
    await this.assertTrustedLocalPath(req.path)
    return attachmentPreview(req, this.deps.createArtifactResourceUrl)
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
    const organizationName = req.organizationName?.trim() ? req.organizationName.trim() : undefined
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
    this.markUserStopped(sessionId)
    await this.stopSessionGeneration(sessionId, { abortAgent: true, reason: "user", throwOnAbortFailure: true })
  }

  public async getMessages(sessionId: string): Promise<ChatMessage[]> {
    if (!this.agent) {
      return []
    }
    const messages = await this.agent.getMessages(sessionId)
    await this.ensureAuthorizationOverlaysLoaded()
    await this.ensureStoppedGenerationsLoaded()
    const displayedMessages = applyStoppedGenerations(
      applyAuthorizationOverlays(messages, this.authorizationOverlays.get(sessionId)),
      this.stoppedGenerations.get(sessionId),
    )
    this.rememberTrustedMessageAttachments(sessionId, displayedMessages)
    return displayedMessages
  }

  public async getPendingQuestions(sessionId: string): Promise<ChatQuestionRequest[]> {
    if (!this.agent) {
      return []
    }
    const sessionIds = [sessionId, ...(this.childSessionsByParent.get(sessionId) ?? [])]
    const questions: ChatQuestionRequest[] = []
    for (const currentSessionId of sessionIds) {
      const sessionQuestions = await this.agent.getPendingQuestions(currentSessionId)
      for (const request of sessionQuestions) {
        const displaySessionId = this.displaySessionIdForEvent(request.sessionId)
        questions.push(displaySessionId === request.sessionId ? request : { ...request, sessionId: displaySessionId })
      }
    }
    return questions
  }

  public async answerQuestion(req: AnswerQuestionRequest): Promise<void> {
    if (!this.agent) {
      throw new Error("Agent not configured (sign in first)")
    }
    await this.agent.answerQuestion(req.sessionId, req.requestId, req.answers)
    this.removeActiveRunBlockingRequest(req.sessionId, req.requestId)
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
    this.removeActiveRunBlockingRequest(req.sessionId, req.requestId)
    this.scheduleGenerationInactivityWatchdogAfterReply(req.sessionId)
    this.emitSessionActivity(req.sessionId)
  }

  public async getPendingPermissions(sessionId: string): Promise<ChatPermissionRequest[]> {
    if (!this.agent) {
      return []
    }
    const sessionIds = [sessionId, ...(this.childSessionsByParent.get(sessionId) ?? [])]
    const pendingPermissions: ChatPermissionRequest[] = []
    const emit = this.send.bind(this) as (event: string, data: unknown) => Promise<void>
    for (const currentSessionId of sessionIds) {
      const permissions = await this.agent.getPendingPermissions(currentSessionId)
      for (const request of permissions) {
        if (!this.answerLocalAccessPermission(emit, request)) {
          const displaySessionId = this.displaySessionIdForEvent(request.sessionId)
          const displayRequest =
            displaySessionId === request.sessionId ? request : { ...request, sessionId: displaySessionId }
          this.rememberPendingPermissionRequest(displayRequest)
          this.addActiveRunBlockingRequest(displaySessionId, displayRequest.id, "awaiting_permission")
          pendingPermissions.push(displayRequest)
        }
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
    this.removeActiveRunBlockingRequest(req.sessionId, req.requestId)
    this.scheduleGenerationInactivityWatchdogAfterReply(req.sessionId)
    this.emitSessionActivity(req.sessionId)
  }

  public async setPermissionMode(req: SetChatPermissionModeRequest): Promise<void> {
    if (!this.setSessionPermissionModeValue(req.sessionId, req.permissionMode, req.version)) {
      return
    }
    const affectedSessionIds = [req.sessionId]
    for (const childSessionId of this.trustedSubagentSessionsByParent.get(req.sessionId) ?? []) {
      if (this.setSessionPermissionModeValue(childSessionId, req.permissionMode, req.version)) {
        affectedSessionIds.push(childSessionId)
      }
    }
    if (req.permissionMode === "full_access") {
      await Promise.all(affectedSessionIds.map((sessionId) => this.autoAnswerPendingPermissions(sessionId)))
    }
    this.emitSessionActivity(req.sessionId)
  }
}
