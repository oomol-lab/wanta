import type { ChatEmit } from "../agent/event-translator.ts"
import type { AgentEventConnectionStatus, AgentManager } from "../agent/manager.ts"
import type { GitTurnBaseline } from "../git/turn-diff.ts"
import type { SessionProjectStore } from "../session/project-store.ts"
import type { ArtifactRootStore, ArtifactRoots } from "./artifact-roots.ts"
import type { AuthorizationOverlayStore, AuthorizationOverlays } from "./authorization.ts"
import type {
  AgentRuntimeStatus,
  AnswerPermissionRequest,
  AnswerQuestionRequest,
  AttachmentPreviewRequest,
  AttachmentPreviewResult,
  AuthorizationInfo,
  ChatMessage,
  ChatPermissionRequest,
  ChatQuestionRequest,
  ChatService,
  ChatProjectContext,
  LocalArtifactPreviewRequest,
  LocalArtifactPreviewResult,
  LocalArtifactGroup,
  LocalArtifactPack,
  MessageErrorEvent,
  OpenExternalUrlRequest,
  OpenLocalPathRequest,
  RejectQuestionRequest,
  ResolveLocalArtifactsRequest,
  ResolveLocalArtifactsResult,
  SendMessageRequest,
  SetAgentOrganizationRequest,
  ShowLocalPathInFolderRequest,
  ToolCallResultEvent,
  ToolCallStartedEvent,
  TurnFileDiffRequest,
  TurnFileDiffResult,
  TurnOutputRecord,
  TurnOutputRequest,
} from "./common.ts"
import type { StoppedGenerationStore, StoppedGenerations } from "./stopped-generations.ts"
import type { StoredTurnOutputRecord, TurnOutputRecords, TurnOutputStore } from "./turn-outputs.ts"
import type { IConnectionService } from "@oomol/connection"

import { ConnectionService } from "@oomol/connection"
import { shell } from "electron"
import os from "node:os"
import { translateOpencodeEvent } from "../agent/event-translator.ts"
import { logDiagnostic } from "../diagnostics-log.ts"
import { captureGitTurnBaseline } from "../git/turn-diff.ts"
import { ServiceEvent } from "../service-events.ts"
import { applyArtifactRoots, recordArtifactRoot } from "./artifact-roots.ts"
import { extractLocalPathCandidates, isBroadLocalArtifactPath, normalizeLocalPathCandidate } from "./artifacts.ts"
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
import { directoryArtifacts, fileArtifact, localArtifactItem, readArtifactPack } from "./local-artifacts.ts"
import { attachmentPreview, localArtifactPreview } from "./previews.ts"
import { projectPermissionRequestInsideRoot } from "./project-permission.ts"
import { applyStoppedGenerations, recordStoppedGeneration } from "./stopped-generations.ts"
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
const generationStartAckTimeoutMs = 45_000
const generationInactivityTimeoutMs = 2 * 60_000
const generationActiveToolInactivityTimeoutMs = 10 * 60_000
const questionRejectTimeoutMs = 5_000
const defaultMaxDirectoryItems = 80

interface ActiveTurnOutput {
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
  artifactRootStore?: ArtifactRootStore
  authorizationOverlayStore?: AuthorizationOverlayStore
  projectStore?: Pick<SessionProjectStore, "read">
  stoppedGenerationStore?: StoppedGenerationStore
  turnOutputStore?: TurnOutputStore
  /** 渲染层切换组织 workspace 时，同步 agent 的组织作用域（main 持有 agent 与 activeAgentOrganizationName）。 */
  onSetAgentOrganization?: (organizationName: string | undefined) => Promise<void> | void
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

export class ChatServiceImpl extends ConnectionService<ChatService> implements IConnectionService<ChatService> {
  public readonly sessionActivity = new ServiceEvent<{ sessionId: string; usedAt: number }>()

  private agent: AgentManager | null
  private bridged = false
  private userStoppedSessions = new Map<string, number>()
  private emittedMessageErrors = new Map<string, Set<string>>()
  private sessionGenerations = new Map<string, SessionGeneration>()
  private pendingArtifactDirs = new Map<string, string[]>()
  private pendingProcessDirs = new Map<string, string[]>()
  // 按 generation id 索引，避免旧 generation 的 late cleanup 误删同 session 的新 turn output。
  private activeTurnOutputs = new Map<string, ActiveTurnOutput>()
  private activeAssistantMessages = new Map<string, string>()
  private activeToolParts = new Map<string, Set<string>>()
  private generationStartWatchdogs = new Map<string, NodeJS.Timeout>()
  private generationInactivityWatchdogs = new Map<string, NodeJS.Timeout>()
  private connectionFailedSessions = new Set<string>()
  private trustedProjectRoots = new Map<string, string>()
  private trustedSubagentSessionsByParent = new Map<string, Set<string>>()
  private readonly deps: ChatServiceDeps
  private agentStatus: AgentRuntimeStatus = { status: "signed_out" }
  private artifactRoots: ArtifactRoots = new Map()
  private artifactRootsLoaded = false
  private artifactRootsLoadPromise: Promise<void> | null = null
  private authorizationOverlays: AuthorizationOverlays = new Map()
  private authorizationOverlaysLoaded = false
  private authorizationOverlaysLoadPromise: Promise<void> | null = null
  private authorizationOverlayWritePromise: Promise<void> = Promise.resolve()
  private stoppedGenerations: StoppedGenerations = new Map()
  private stoppedGenerationsLoaded = false
  private stoppedGenerationsLoadPromise: Promise<void> | null = null
  private turnOutputs: TurnOutputRecords = new Map()
  private turnOutputsLoaded = false
  private turnOutputsLoadPromise: Promise<void> | null = null
  private turnOutputWritePromise: Promise<void> = Promise.resolve()
  private scopeMutationQueue: Promise<void> = Promise.resolve()
  private desiredIdleOrganizationName: string | undefined
  private syncedIdleOrganizationName: string | undefined

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
    this.pendingProcessDirs.clear()
    this.activeTurnOutputs.clear()
    this.activeAssistantMessages.clear()
    this.activeToolParts.clear()
    this.clearAllGenerationStartWatchdogs()
    this.clearAllGenerationInactivityWatchdogs()
    this.connectionFailedSessions.clear()
    this.trustedProjectRoots.clear()
    this.trustedSubagentSessionsByParent.clear()
    this.artifactRoots.clear()
    this.artifactRootsLoaded = false
    this.artifactRootsLoadPromise = null
    this.authorizationOverlays.clear()
    this.authorizationOverlaysLoaded = false
    this.authorizationOverlaysLoadPromise = null
    this.stoppedGenerations.clear()
    this.stoppedGenerationsLoaded = false
    this.stoppedGenerationsLoadPromise = null
    this.turnOutputs.clear()
    this.turnOutputsLoaded = false
    this.turnOutputsLoadPromise = null
    this.desiredIdleOrganizationName = undefined
    this.syncedIdleOrganizationName = undefined
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
    const handleConnectionStatus = (status: AgentEventConnectionStatus): void => {
      this.handleAgentConnectionStatus(emit, status)
    }
    this.agent.subscribe((event) => {
      for (const translated of translateOpencodeEvent(event)) {
        if (translated.data.sessionId && this.connectionFailedSessions.has(translated.data.sessionId)) {
          continue
        }
        if (
          translated.event === "agentError" &&
          translated.data.sessionId &&
          this.consumeUserStopAbort(translated.data.sessionId, translated.data.message)
        ) {
          const sessionId = translated.data.sessionId
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
        const sessionId = translated.data.sessionId
        if (sessionId) {
          this.clearGenerationStartWatchdog(sessionId)
        }
        if (translated.event === "messageStarted") {
          this.emitSessionActivity(translated.data.sessionId)
        }
        if (
          translated.event === "permissionAsked" &&
          this.answerTrustedProjectPermission(emit, translated.data.request)
        ) {
          const generationSessionId = this.generationWatchdogSessionId(translated.data.sessionId)
          if (generationSessionId) {
            this.clearGenerationInactivityWatchdog(generationSessionId)
          }
          continue
        }
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
          if (artifactRoot) {
            this.sendBestEffort(
              emit,
              "messageArtifacts",
              {
                sessionId: translated.data.sessionId,
                messageId: translated.data.messageId,
                artifactRoot,
              },
              { messageId: translated.data.messageId, sessionId: translated.data.sessionId },
            )
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
          const childSessionId = taskChildSessionId(translated.data)
          if (childSessionId) {
            this.rememberTrustedSubagentSession(translated.data.sessionId, childSessionId)
          }
        }
        if (translated.event === "toolCallResult") {
          const partIds = this.activeToolParts.get(translated.data.sessionId)
          partIds?.delete(translated.data.partId)
          if (partIds?.size === 0) {
            this.activeToolParts.delete(translated.data.sessionId)
          }
          const childSessionId = taskChildSessionId(translated.data)
          if (childSessionId) {
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
          const messageId = this.activeAssistantMessages.get(sessionId)
          this.clearGenerationInactivityWatchdog(sessionId)
          void this.finalizeTurnOutput(sessionId, messageId)
            .catch((error: unknown) => {
              console.warn("[wanta] failed to finalize errored turn output", error)
            })
            .finally(() => {
              this.clearSessionGeneration(sessionId)
              this.activeAssistantMessages.delete(sessionId)
              this.activeToolParts.delete(sessionId)
              this.emitSessionActivity(sessionId)
              this.emitMessageError(emit, sessionId, translated.data.message, messageId)
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
              this.emitSessionActivity(sessionId)
              this.sendBestEffort(emit, translated.event, translated.data, { sessionId })
            })
          continue
        }
        if (sessionId) {
          const generationSessionId = this.generationWatchdogSessionId(sessionId)
          if (translated.event === "questionAsked" || translated.event === "permissionAsked") {
            if (generationSessionId) {
              this.clearGenerationInactivityWatchdog(generationSessionId)
            }
          } else if (generationSessionId) {
            this.scheduleGenerationInactivityWatchdog(generationSessionId)
          }
        }
        this.sendBestEffort(emit, translated.event, translated.data, { sessionId: translated.data.sessionId })
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
    const terminalMessage =
      status.status === "failed"
        ? "CHAT_COMPLETION_INTERRUPTED: OpenCode event stream reconnection failed."
        : status.status === "runtime_recovered"
          ? "CHAT_COMPLETION_INTERRUPTED: OpenCode runtime restarted before this turn completed."
          : status.status === "runtime_failed"
            ? "CHAT_COMPLETION_INTERRUPTED: OpenCode runtime could not restart."
            : null
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
      if (!terminalMessage) {
        continue
      }
      this.connectionFailedSessions.add(sessionId)
      void this.finalizeTurnOutput(sessionId, messageId)
        .catch((error: unknown) => {
          console.warn("[wanta] failed to finalize disconnected turn output", error)
        })
        .finally(() => {
          this.clearSessionGeneration(sessionId)
          this.activeAssistantMessages.delete(sessionId)
          this.activeToolParts.delete(sessionId)
          this.emitSessionActivity(sessionId)
          this.emitMessageError(emit, sessionId, terminalMessage, messageId)
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
    this.activeTurnOutputs.delete(activeGenerationId)
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

  private answerTrustedProjectPermission(
    emit: (event: string, data: unknown) => Promise<void>,
    request: ChatPermissionRequest,
  ): boolean {
    const projectRoot = this.trustedProjectRoots.get(request.sessionId)
    if (!this.agent || !projectRoot || !projectPermissionRequestInsideRoot(request, projectRoot)) {
      return false
    }
    void this.agent
      .answerPermission(request.sessionId, request.id, "once")
      .then(() => {
        this.scheduleGenerationInactivityWatchdogAfterReply(request.sessionId)
      })
      .catch((error: unknown) => {
        console.warn("[wanta] failed to approve trusted project permission:", error)
        logDiagnostic(
          "chat-service",
          "failed to approve trusted project permission",
          { action: request.action, error, sessionId: request.sessionId },
          "warn",
        )
        this.sendBestEffort(
          emit,
          "permissionAsked",
          { sessionId: request.sessionId, request },
          { sessionId: request.sessionId },
        )
      })
    return true
  }

  private rememberTrustedSubagentSession(parentSessionId: string, childSessionId: string): void {
    const projectRoot = this.trustedProjectRoots.get(parentSessionId)
    if (!projectRoot) {
      return
    }
    this.trustedProjectRoots.set(childSessionId, projectRoot)
    const childSessionIds = this.trustedSubagentSessionsByParent.get(parentSessionId) ?? new Set<string>()
    childSessionIds.add(childSessionId)
    this.trustedSubagentSessionsByParent.set(parentSessionId, childSessionIds)
  }

  private forgetTrustedSubagentSession(parentSessionId: string, childSessionId: string): void {
    const childSessionIds = this.trustedSubagentSessionsByParent.get(parentSessionId)
    if (!childSessionIds?.has(childSessionId)) {
      return
    }
    childSessionIds.delete(childSessionId)
    this.trustedProjectRoots.delete(childSessionId)
    if (childSessionIds.size === 0) {
      this.trustedSubagentSessionsByParent.delete(parentSessionId)
    }
  }

  private forgetTrustedSubagentSessions(parentSessionId: string): void {
    const childSessionIds = this.trustedSubagentSessionsByParent.get(parentSessionId)
    if (!childSessionIds) {
      return
    }
    for (const childSessionId of childSessionIds) {
      this.trustedProjectRoots.delete(childSessionId)
    }
    this.trustedSubagentSessionsByParent.delete(parentSessionId)
  }

  private beginSessionGeneration(sessionId: string): SessionGeneration {
    const previousGeneration = this.sessionGenerations.get(sessionId)
    previousGeneration?.controller.abort()
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
    this.forgetTrustedSubagentSessions(sessionId)
    this.sessionGenerations.delete(sessionId)
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
      const messageId = this.activeAssistantMessages.get(sessionId)
      void this.stopSessionGeneration(sessionId, { abortAgent: true, throwOnAbortFailure: false }).finally(() => {
        this.emitMessageError(
          this.send.bind(this) as (event: string, data: unknown) => Promise<void>,
          sessionId,
          "CHAT_COMPLETION_INTERRUPTED: Agent runtime did not acknowledge this message. Please retry.",
          messageId,
        )
      })
    }, generationStartAckTimeoutMs)
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
      if (!this.isCurrentGeneration(sessionId, generationId)) {
        return
      }
      console.warn("[wanta] generation stopped receiving OpenCode events before completion:", {
        sessionId,
        timeoutMs,
      })
      logDiagnostic(
        "chat-service",
        "generation stopped receiving opencode events before completion",
        { sessionId, timeoutMs },
        "warn",
      )
      const messageId = this.activeAssistantMessages.get(sessionId)
      void this.stopSessionGeneration(sessionId, { abortAgent: true, throwOnAbortFailure: false }).finally(() => {
        this.emitMessageError(
          this.send.bind(this) as (event: string, data: unknown) => Promise<void>,
          sessionId,
          "CHAT_COMPLETION_INTERRUPTED: Agent runtime stopped sending updates before the response completed. Please retry.",
          messageId,
        )
      })
    }, timeoutMs)
    timer.unref?.()
    this.generationInactivityWatchdogs.set(sessionId, timer)
  }

  private generationWatchdogSessionId(sessionId: string): string | null {
    if (this.sessionGenerations.has(sessionId)) {
      return sessionId
    }
    for (const [parentSessionId, childSessionIds] of this.trustedSubagentSessionsByParent) {
      if (childSessionIds.has(sessionId) && this.sessionGenerations.has(parentSessionId)) {
        return parentSessionId
      }
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

  private hasSessionGenerationState(sessionId: string): boolean {
    return (
      this.sessionGenerations.has(sessionId) ||
      this.pendingArtifactDirs.has(sessionId) ||
      this.pendingProcessDirs.has(sessionId) ||
      Boolean(this.activeTurnOutputForSession(sessionId)) ||
      this.activeAssistantMessages.has(sessionId) ||
      this.activeToolParts.has(sessionId)
    )
  }

  private async stopSessionGeneration(
    sessionId: string,
    options: { abortAgent: boolean; throwOnAbortFailure: boolean },
  ): Promise<void> {
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
    if (messageId) {
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
    await this.send("generationStopped", {
      sessionId,
      ...(messageId ? { messageId, partIds, stoppedAt } : {}),
    }).catch((error: unknown) => {
      console.warn("[wanta] failed to emit generation stopped:", error)
      logDiagnostic("chat-service", "failed to emit generation stopped", { error, sessionId }, "warn")
    })
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
    const organizationName = organizationNameFromRequest(req)
    this.desiredIdleOrganizationName = organizationName
    let generation: SessionGeneration | undefined
    let artifactDir: string | undefined
    let processDir: string | undefined
    try {
      await this.agent.setSessionOrganizationName(req.sessionId, organizationName)
      generation = this.beginSessionGeneration(req.sessionId)
      const activeGeneration = generation
      this.userStoppedSessions.delete(req.sessionId)
      this.connectionFailedSessions.delete(req.sessionId)
      this.clearMessageErrorSignatures(req.sessionId)
      this.emitSessionActivity(req.sessionId)
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
      const project = await this.projectBaseline(req.projectContext)
      this.enqueuePendingArtifactDir(req.sessionId, artifactDir)
      this.enqueuePendingProcessDir(req.sessionId, processDir)
      this.activeTurnOutputs.set(activeGeneration.id, {
        artifactRoot: artifactDir,
        processRoot: processDir,
        createdAt: Date.now(),
        generationId: activeGeneration.id,
        requestText: req.text,
        ...(project.baseline ? { projectBaseline: project.baseline } : {}),
        ...(project.projectRoot ? { projectRoot: project.projectRoot } : {}),
      })
      const promptGeneration = activeGeneration
      // promptStreaming 的结果经 SSE 推送；RPC 只确认主进程已接收本轮发送，避免首条消息 UI 等到流式内容已累积后才切换。
      this.scheduleGenerationStartWatchdog(req.sessionId, promptGeneration.id)
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

  private async ensureTurnOutputsLoaded(): Promise<void> {
    if (this.turnOutputsLoaded) {
      return
    }
    if (this.turnOutputsLoadPromise) {
      return this.turnOutputsLoadPromise
    }
    this.turnOutputsLoadPromise = (async () => {
      this.turnOutputs = (await this.deps.turnOutputStore?.read()) ?? new Map()
      this.turnOutputsLoaded = true
      this.turnOutputsLoadPromise = null
    })()
    return this.turnOutputsLoadPromise
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

  private async rememberArtifactRoot(sessionId: string, messageId: string, artifactRoot: string): Promise<void> {
    await this.ensureArtifactRootsLoaded()
    if (!recordArtifactRoot(this.artifactRoots, sessionId, messageId, artifactRoot)) {
      return
    }
    await this.deps.artifactRootStore?.write(this.artifactRoots)
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
    await this.ensureTurnOutputsLoaded()
    recordTurnOutput(this.turnOutputs, record)
    const write = this.turnOutputWritePromise
      .catch((error: unknown) => {
        this.logQueuedWriteFailure("turn output", error)
      })
      .then(async () => {
        await this.deps.turnOutputStore?.write(this.turnOutputs)
      })
    this.turnOutputWritePromise = write.then(
      () => undefined,
      () => undefined,
    )
    await write
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
      this.activeTurnOutputs.delete(generationId)
    }
    const resolvedMessageId = messageId ?? active?.messageId
    if (!active || !resolvedMessageId) {
      return
    }
    const [artifactGroup, processFiles, intermediateArtifactFiles, projectFiles] = await Promise.all([
      directoryArtifacts(active.artifactRoot, defaultMaxDirectoryItems),
      processOutputFiles(active.processRoot),
      intermediateArtifactProcessFiles(active.artifactRoot, active.requestText),
      projectOutputFiles(active.projectBaseline, active.projectRoot),
    ])
    const files = [...processFiles, ...intermediateArtifactFiles, ...projectFiles]
    if (files.length === 0 && !artifactGroup?.items.length) {
      return
    }
    const record: StoredTurnOutputRecord = {
      sessionId,
      messageId: resolvedMessageId,
      artifactRoot: active.artifactRoot,
      processRoot: active.processRoot,
      ...(active.projectRoot ? { projectRoot: active.projectRoot } : {}),
      createdAt: active.createdAt,
      completedAt: Date.now(),
      files,
      summary: summarizeTurnFiles(files, artifactGroup?.items.length ?? 0),
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
  }

  public async getAttachmentPreview(req: AttachmentPreviewRequest): Promise<AttachmentPreviewResult> {
    return attachmentPreview(req)
  }

  public async getLocalArtifactPreview(req: LocalArtifactPreviewRequest): Promise<LocalArtifactPreviewResult> {
    return localArtifactPreview(req)
  }

  public async getTurnOutput(req: TurnOutputRequest): Promise<TurnOutputRecord | null> {
    await this.ensureTurnOutputsLoaded()
    const record = this.turnOutputs.get(req.sessionId)?.get(req.messageId)
    return record ? publicTurnOutputRecord(record) : null
  }

  public async getTurnFileDiff(req: TurnFileDiffRequest): Promise<TurnFileDiffResult> {
    await this.ensureTurnOutputsLoaded()
    const record = this.turnOutputs.get(req.sessionId)?.get(req.messageId)
    const file = record?.files.find((item) => item.path === req.path)
    if (!record || !file) {
      return { kind: "missing", path: req.path, mime: "application/octet-stream", additions: 0, deletions: 0 }
    }
    if (file.role === "artifact" && (!record.artifactRoot || !isPathInside(record.artifactRoot, file.path))) {
      return { kind: "missing", path: req.path, mime: file.mime, additions: 0, deletions: 0 }
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

  public async showLocalPathInFolder(req: ShowLocalPathInFolderRequest): Promise<void> {
    const item = await localArtifactItem(req.path)
    if (!item) {
      throw new Error("File does not exist.")
    }
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
    this.desiredIdleOrganizationName = organizationName
    await this.runWithScopeMutation(async () => {
      if (this.desiredIdleOrganizationName !== organizationName) {
        return
      }
      await this.deps.onSetAgentOrganization?.(organizationName)
      this.syncedIdleOrganizationName = organizationName
    })
  }

  public async stopGeneration(sessionId: string): Promise<void> {
    if (!this.agent) {
      return
    }
    this.markUserStopped(sessionId)
    await this.stopSessionGeneration(sessionId, { abortAgent: true, throwOnAbortFailure: true })
  }

  public async getMessages(sessionId: string): Promise<ChatMessage[]> {
    if (!this.agent) {
      return []
    }
    const messages = await this.agent.getMessages(sessionId)
    await this.ensureArtifactRootsLoaded()
    await this.ensureAuthorizationOverlaysLoaded()
    await this.ensureStoppedGenerationsLoaded()
    return applyStoppedGenerations(
      applyAuthorizationOverlays(
        applyArtifactRoots(messages, this.artifactRoots.get(sessionId)),
        this.authorizationOverlays.get(sessionId),
      ),
      this.stoppedGenerations.get(sessionId),
    )
  }

  public async getPendingQuestions(sessionId: string): Promise<ChatQuestionRequest[]> {
    if (!this.agent) {
      return []
    }
    return this.agent.getPendingQuestions(sessionId)
  }

  public async answerQuestion(req: AnswerQuestionRequest): Promise<void> {
    if (!this.agent) {
      throw new Error("Agent not configured (sign in first)")
    }
    await this.agent.answerQuestion(req.sessionId, req.requestId, req.answers)
    this.scheduleGenerationInactivityWatchdogAfterReply(req.sessionId)
    this.emitSessionActivity(req.sessionId)
  }

  public async rejectQuestion(req: RejectQuestionRequest): Promise<void> {
    if (!this.agent) {
      throw new Error("Agent not configured (sign in first)")
    }
    const hadGenerationState = this.hasSessionGenerationState(req.sessionId)
    let rejectError: unknown
    try {
      await withTimeout(
        this.agent.rejectQuestion(req.sessionId, req.requestId),
        questionRejectTimeoutMs,
        "question rejection",
      )
    } catch (error) {
      rejectError = error
      console.warn("[wanta] question rejection failed before generation stop:", error)
      logDiagnostic(
        "chat-service",
        "question rejection failed before generation stop",
        {
          error,
          requestId: req.requestId,
          sessionId: req.sessionId,
        },
        "warn",
      )
    }
    const shouldStopGeneration = hadGenerationState || this.hasSessionGenerationState(req.sessionId)
    if (shouldStopGeneration) {
      this.markUserStopped(req.sessionId)
      await this.stopSessionGeneration(req.sessionId, { abortAgent: true, throwOnAbortFailure: false })
    }
    if (rejectError && !shouldStopGeneration) {
      throw rejectError
    }
    this.emitSessionActivity(req.sessionId)
  }

  public async getPendingPermissions(sessionId: string): Promise<ChatPermissionRequest[]> {
    if (!this.agent) {
      return []
    }
    return this.agent.getPendingPermissions(sessionId)
  }

  public async answerPermission(req: AnswerPermissionRequest): Promise<void> {
    if (!this.agent) {
      throw new Error("Agent not configured (sign in first)")
    }
    await this.agent.answerPermission(req.sessionId, req.requestId, req.reply)
    this.scheduleGenerationInactivityWatchdogAfterReply(req.sessionId)
    this.emitSessionActivity(req.sessionId)
  }
}
