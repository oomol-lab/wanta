import type {
  AgentMode,
  ChatAttachment,
  ChatMessage,
  ChatPermissionReply,
  ChatPermissionRequest,
  ChatQuestionRequest,
  ReasoningLevel,
} from "../chat/common.ts"
import type { ModelChoice } from "../models/common.ts"
import type { RuntimeCustomModel } from "../models/store.ts"
import type { LinkRuntime, ModelAccess } from "../runtime/agent-runtime.ts"
import type { GenerateSessionTitleRequest, SessionInfo } from "../session/common.ts"
import type { GeneratedSessionTitle } from "./session-title-generator.ts"
import type { FilePartInput, SessionPromptAsyncData, TextPartInput } from "@opencode-ai/sdk/v2/client"
import type { OpencodeClient } from "@opencode-ai/sdk/v2/client"

import { randomBytes, randomUUID } from "node:crypto"
import { lstat, mkdir, realpath } from "node:fs/promises"
import path from "node:path"
import { pathToFileURL } from "node:url"
import { ActivityMetrics } from "../activity-metrics.ts"
import { atomicWriteText } from "../atomic-file.ts"
import { branding } from "../branding.ts"
import { resolveUserCommandPath } from "../command-path.ts"
import { logDiagnostic } from "../diagnostics-log.ts"
import { connectorBaseUrl, llmBaseUrl } from "../domain.ts"
import { DEFAULT_BUILTIN_MODEL_ID, isBuiltinModelId, resolveBuiltinModel } from "../models/builtin.ts"
import { planAttachmentInputs } from "./attachment-input.ts"
import { buildOpencodeConfig, customProviderId, WANTA_MODEL_ID, WANTA_PROVIDER_ID } from "./config.ts"
import { normalizeMessage, normalizePermissionRequest, normalizeQuestionRequest } from "./event-translator.ts"
import { normalizeWantaAgentMode } from "./mode.ts"
import { writeOoIdentitySettings } from "./oo-identity.ts"
import { buildAgentLinkEnv } from "./oo.ts"
import { managedPythonEnvironmentPath, managedPythonExecutable } from "./python-environment.ts"
import { opencodeReasoningVariant } from "./reasoning.ts"
import { generateSessionTitle as generateTitle } from "./session-title-generator.ts"
import { OpencodeSidecar } from "./sidecar.ts"
import { ensureAgentWorkspace } from "./workspace.ts"

export type { GeneratedSessionTitle } from "./session-title-generator.ts"

export interface AgentManagerOptions {
  linkRuntime: LinkRuntime | null
  modelAccess: ModelAccess
  /** opencode 二进制绝对路径。 */
  opencodeBinPath: string
  /** The oo binary is resolved and injected only when a Link runtime is configured. */
  ooBinPath?: string
  /** WikiGraph CLI 的 Node 入口与执行器；仅供 Wanta 只读知识查询工具使用。 */
  wikiGraphCliPath?: string
  wikiGraphExecutablePath?: string
  knowledgeRegistryPath?: string
  listOpenConnectorAuthorizedServices?: (signal?: AbortSignal) => Promise<string[]>
  /** 内置 oo skill 源目录（resources/skills 或打包 Resources/skills）；启动时拷进 .opencode/skill/。 */
  bundledSkillsDir?: string
  /** 构建期合并的自定义工具 runtime；启动时拷进 .opencode/runtime/tool.js。 */
  bundledToolRuntimePath?: string
  /** App 私有根目录（userData 下）：workspace / oo-store / isolation 都在其下。 */
  rootDir: string
  /** 自定义 OpenAI-compatible 模型配置。apiKey 只进入 sidecar env config，不落到 OpenCode 文件。 */
  customModels?: RuntimeCustomModel[]
  /** sidecar 启动默认模型；本地 runtime 必须解析为 custom model。 */
  defaultModel?: ModelChoice
  /** 关闭 sidecar Basic Auth（默认开，随机口令）。 */
  disableServerAuth?: boolean
}

function normalizeTeamName(teamName: string | undefined): string | undefined {
  const normalized = teamName?.trim()
  return normalized ? normalized : undefined
}

function requireOoBinPath(ooBinPath: string | undefined): string {
  if (!ooBinPath) throw new Error("The Link runtime requires the oo binary path.")
  return ooBinPath
}

function normalizeKnowledgeBaseIds(ids: readonly string[]): string[] {
  return [...new Set(ids.map((id) => id.trim()).filter(Boolean))]
}

function sameStringArray(left: readonly string[] | undefined, right: readonly string[]): boolean {
  if (!left) return right.length === 0
  return left.length === right.length && left.every((item, index) => item === right[index])
}

export function buildManagedSkillRuntimeEnv(nodeBin: string = process.execPath): Record<string, string> {
  return {
    ELECTRON_RUN_AS_NODE: "1",
    WANTA_NODE_BIN: nodeBin,
  }
}

export interface TeamScopePersistenceOptions {
  currentName: string | undefined
  nextName: string | undefined
  writeScope: (teamName: string | undefined) => Promise<void>
}

export async function persistTeamScopeUpdate({
  currentName,
  nextName,
  writeScope,
}: TeamScopePersistenceOptions): Promise<void> {
  try {
    await writeScope(nextName)
  } catch (error) {
    try {
      await writeScope(currentName)
    } catch (rollbackError) {
      console.warn("[wanta] failed to rollback agent team scope:", rollbackError)
      logDiagnostic(
        "agent",
        "failed to rollback agent team scope",
        { error: rollbackError, teamName: currentName },
        "warn",
      )
      throw new AggregateError([error, rollbackError], "Failed to persist and rollback agent team scope.")
    }
    throw error
  }
}

export interface SendMessageResult {
  sessionId: string
  messages: unknown
}

interface OpencodeResult<T = unknown> {
  data?: T
  error?: unknown
}

function opencodeErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message
  if (typeof error === "string") return error
  try {
    return JSON.stringify(error)
  } catch {
    return String(error)
  }
}

/** OpenCode SDK 默认不 throw，而是返回 `{ error }`；所有调用统一在边界转成异常。 */
function assertOpencodeSuccess<T>(result: OpencodeResult<T>, operation: string): asserts result is { data?: T } {
  if (result.error !== undefined) {
    throw new Error(`${operation} failed: ${opencodeErrorMessage(result.error)}`)
  }
}

export interface PromptStreamingOptions {
  system?: string
  attachments?: ChatAttachment[]
  mode?: AgentMode
  model?: ModelChoice
  teamName?: string
  reasoningLevel?: ReasoningLevel
  artifactDir?: string
  outputProjectRoot?: string
  processDir?: string
  messageId?: string
  signal?: AbortSignal
}

export type AgentEventConnectionStatus =
  | { status: "reconnecting"; attempt: number; maxAttempts: number; message?: string }
  | { status: "reconnected"; attempt: number; maxAttempts: number; message?: string }
  | { status: "failed"; attempt: number; maxAttempts: number; message?: string }
  | { status: "runtime_restarting"; attempt: number; maxAttempts: number; message?: string }
  | { status: "runtime_recovered"; attempt: number; maxAttempts: number; message?: string }
  | { status: "runtime_failed"; attempt: number; maxAttempts: number; message?: string }

export interface RawSession {
  id: string
  title?: string
  parentID?: string
  parentId?: string
  parent_id?: string
  time?: { created?: number; updated?: number }
}

const eventStreamMaxReconnectAttempts = 5
const eventStreamRestartInitialDelayMs = 500
const eventStreamRestartMaxDelayMs = 5_000
const runtimeRestartMaxAttempts = 5
const runtimeRestartInitialDelayMs = 1_000
const runtimeRestartMaxDelayMs = 10_000
const authorizedServicesCacheTtlMs = 30_000
const authorizedServicesPromptBudgetMs = 750

interface AgentEventSubscriber {
  onEvent: (event: { type: string; data?: Record<string, unknown>; properties?: Record<string, unknown> }) => void
  onConnectionStatus?: (status: AgentEventConnectionStatus) => void
}

function toSessionInfo(session: RawSession): SessionInfo {
  return {
    id: session.id,
    title: session.title ?? "新会话",
    createdAt: session.time?.created ?? 0,
    updatedAt: session.time?.updated ?? session.time?.created ?? 0,
  }
}

export function isUserVisibleSession(session: RawSession): boolean {
  return !(session.parentID || session.parentId || session.parent_id)
}

/** Agent 内核管理器：编排 OpenCode sidecar + 非编码 agent + 自定义连接器工具。electron-free，便于 headless 测试。 */
export class AgentManager {
  private options: AgentManagerOptions
  private sidecar: OpencodeSidecar | null = null
  // 启动中（尚未就绪、还没赋给 sidecar）的实例：它已 spawn opencode，dispose 必须能回收它，
  // 否则"启动期间退出/重启"会漏掉这个正在拉起的 opencode，形成新的残留孤儿。
  private startingSidecar: OpencodeSidecar | null = null
  private eventStreamAbort: AbortController | null = null
  private eventSubscriber: AgentEventSubscriber | null = null
  private eventLoopRestartFailures = 0
  private disposed = false
  private runtimeRecovery: Promise<void> | null = null
  private started = false
  private eventLoopStopped = false
  private teamName: string | undefined
  private teamScopePath: string | undefined
  private teamUpdateChain: Promise<void> = Promise.resolve()
  private sessionTeamNames = new Map<string, string>()
  private sessionKnowledgeBaseIds = new Map<string, string[]>()
  private authorizedServicesCache = new Map<string, { loadedAt: number; services: string[] }>()
  private authorizedServicesLoadControllers = new Map<string, AbortController>()
  private authorizedServicesLoads = new Map<string, Promise<string[]>>()
  private readonly eventMetrics = new ActivityMetrics((snapshot) => {
    logDiagnostic("performance", "opencode event activity", { ...snapshot }, "trace")
  })

  public constructor(options: AgentManagerOptions) {
    this.options = options
    this.teamName = options.linkRuntime?.kind === "oomol" ? normalizeTeamName(options.linkRuntime.teamName) : undefined
  }

  public get client(): OpencodeClient {
    if (!this.sidecar) {
      throw new Error("AgentManager not started")
    }
    return this.sidecar.client
  }

  public get url(): string {
    return this.sidecar?.url ?? ""
  }

  public isReady(): boolean {
    return this.started
  }

  /** 更新 Link 工具使用的团队工作区，不重启 sidecar，避免刷新会话列表。 */
  public async setTeamName(teamName?: string): Promise<void> {
    const nextTeamName = normalizeTeamName(teamName)
    await this.queueTeamUpdate(async () => {
      if (nextTeamName === this.teamName) {
        return
      }
      const previousTeamName = this.teamName
      await persistTeamScopeUpdate({
        currentName: previousTeamName,
        nextName: nextTeamName,
        writeScope: (name) => this.writeTeamState(name),
      })
      this.teamName = nextTeamName
    })
  }

  /** 记录单个 OpenCode session 的 Link 团队身份，供并发工具调用按 session 隔离读取。 */
  public async setSessionTeamName(sessionId: string, teamName?: string): Promise<void> {
    const normalizedSessionId = sessionId.trim()
    if (!normalizedSessionId) {
      throw new Error("Session id is required")
    }
    const nextTeamName = normalizeTeamName(teamName) ?? ""
    await this.queueTeamUpdate(async () => {
      if (this.sessionTeamNames.get(normalizedSessionId) === nextTeamName) {
        return
      }
      this.sessionTeamNames.set(normalizedSessionId, nextTeamName)
      await this.writeTeamScope(this.teamName)
    })
  }

  public async clearSessionTeamName(sessionId: string): Promise<void> {
    const normalizedSessionId = sessionId.trim()
    if (!normalizedSessionId) {
      return
    }
    await this.queueTeamUpdate(async () => {
      if (!this.sessionTeamNames.delete(normalizedSessionId)) {
        return
      }
      await this.writeTeamScope(this.teamName)
    })
  }

  /** 记录本轮允许 query_knowledge 访问的知识库；工具按 OpenCode sessionID 强制校验。 */
  public async setSessionKnowledgeBaseIds(sessionId: string, knowledgeBaseIds: readonly string[]): Promise<void> {
    const normalizedSessionId = sessionId.trim()
    if (!normalizedSessionId) throw new Error("Session id is required")
    const normalizedIds = normalizeKnowledgeBaseIds(knowledgeBaseIds)
    await this.queueTeamUpdate(async () => {
      if (sameStringArray(this.sessionKnowledgeBaseIds.get(normalizedSessionId), normalizedIds)) return
      if (normalizedIds.length > 0) this.sessionKnowledgeBaseIds.set(normalizedSessionId, normalizedIds)
      else this.sessionKnowledgeBaseIds.delete(normalizedSessionId)
      await this.writeTeamScope(this.teamName)
    })
  }

  public async clearSessionKnowledgeBaseIds(sessionId: string): Promise<void> {
    const normalizedSessionId = sessionId.trim()
    if (!normalizedSessionId) return
    await this.queueTeamUpdate(async () => {
      if (!this.sessionKnowledgeBaseIds.delete(normalizedSessionId)) return
      await this.writeTeamScope(this.teamName)
    })
  }

  /** task 子会话使用独立 sessionID，必须显式继承父会话的知识库 allowlist。 */
  public async inheritSessionKnowledgeBaseIds(parentSessionId: string, childSessionId: string): Promise<void> {
    const normalizedParentId = parentSessionId.trim()
    const normalizedChildId = childSessionId.trim()
    if (!normalizedParentId || !normalizedChildId || normalizedParentId === normalizedChildId) return
    await this.queueTeamUpdate(async () => {
      const parentIds = this.sessionKnowledgeBaseIds.get(normalizedParentId) ?? []
      if (sameStringArray(this.sessionKnowledgeBaseIds.get(normalizedChildId), parentIds)) return
      if (parentIds.length > 0) this.sessionKnowledgeBaseIds.set(normalizedChildId, [...parentIds])
      else this.sessionKnowledgeBaseIds.delete(normalizedChildId)
      await this.writeTeamScope(this.teamName)
    })
  }

  public async removeKnowledgeBaseAccess(knowledgeBaseId: string): Promise<void> {
    const normalizedId = knowledgeBaseId.trim()
    if (!normalizedId) return
    await this.queueTeamUpdate(async () => {
      let changed = false
      for (const [sessionId, ids] of this.sessionKnowledgeBaseIds) {
        const next = ids.filter((id) => id !== normalizedId)
        if (next.length === ids.length) continue
        changed = true
        if (next.length > 0) this.sessionKnowledgeBaseIds.set(sessionId, next)
        else this.sessionKnowledgeBaseIds.delete(sessionId)
      }
      if (changed) await this.writeTeamScope(this.teamName)
    })
  }

  private async queueTeamUpdate(update: () => Promise<void>): Promise<void> {
    const task = this.teamUpdateChain.then(update, update)
    this.teamUpdateChain = task.catch((error: unknown) => {
      logDiagnostic("agent", "agent team scope update failed", { error }, "warn")
    })
    await task
  }

  public async start(): Promise<void> {
    this.disposed = false
    await this.prepareWorkspace()
    await this.startSidecar()
  }

  private async prepareWorkspace(): Promise<void> {
    const { bundledSkillsDir, bundledToolRuntimePath, rootDir } = this.options
    const workspaceDir = path.join(rootDir, "workspace")
    const teamScopePath = path.join(rootDir, "team-scope.json")

    await ensureAgentWorkspace(workspaceDir, bundledSkillsDir, bundledToolRuntimePath, {
      bundledOoSkills: this.options.linkRuntime?.kind === "oomol",
      connectors: this.options.linkRuntime !== null,
    })
    this.teamScopePath = teamScopePath
    await this.writeTeamState(this.teamName)
  }

  private async startSidecar(): Promise<void> {
    const {
      linkRuntime,
      modelAccess,
      opencodeBinPath,
      ooBinPath,
      rootDir,
      disableServerAuth,
      customModels,
      defaultModel,
      wikiGraphCliPath,
      wikiGraphExecutablePath,
      knowledgeRegistryPath,
    } = this.options
    const workspaceDir = path.join(rootDir, "workspace")
    const isolationDir = path.join(rootDir, "isolation")
    const storeDir = path.join(rootDir, "oo-store")
    const teamScopePath = this.teamScopePath ?? path.join(rootDir, "team-scope.json")

    const config = buildOpencodeConfig({ customModels, defaultModel, linkRuntime, modelAccess })
    const ooEnv = linkRuntime
      ? buildAgentLinkEnv({
          linkRuntime,
          teamName: this.teamName,
          teamScopePath,
          storeDir,
          ooBinPath: requireOoBinPath(ooBinPath),
        })
      : { WANTA_TEAM_SCOPE_PATH: teamScopePath }
    const commandPath = await resolveUserCommandPath({
      preferredDirectories: linkRuntime && ooBinPath ? [path.dirname(ooBinPath)] : [],
    })
    const env: Record<string, string> = {
      ...ooEnv,
      // 托管 Skill 可复用 Wanta 自身的 Node runtime；生产的 process.execPath 是 Electron，调用方同时设置
      // ELECTRON_RUN_AS_NODE=1，避免依赖用户机器另装 Node。
      ...buildManagedSkillRuntimeEnv(),
      // WANTA 自带 oo/rg 目录保持最高优先级；其后合并用户登录 shell PATH，
      // 让 Finder/Dock 启动的 GUI 也能发现用户在终端中安装的 CLI。
      PATH: commandPath,
      ...(wikiGraphCliPath ? { WANTA_WIKIGRAPH_CLI: wikiGraphCliPath } : {}),
      ...(wikiGraphExecutablePath ? { WANTA_WIKIGRAPH_EXECUTABLE: wikiGraphExecutablePath } : {}),
      ...(knowledgeRegistryPath ? { WANTA_KNOWLEDGE_REGISTRY: knowledgeRegistryPath } : {}),
    }

    const sidecar = new OpencodeSidecar({
      opencodeBinPath,
      workspaceDir,
      config,
      env,
      isolationDir,
      serverPassword: disableServerAuth ? undefined : randomBytes(24).toString("hex"),
      onExit: (info) => this.handleSidecarExit(info),
    })
    // 启动期间也要能被 dispose 回收（此实例已 spawn opencode）：先登记为 startingSidecar，
    // start 结束后再清掉。仅在 sidecar 完全就绪后才赋值 this.sidecar 并标记 ready，避免 client 在启动期被访问。
    this.startingSidecar = sidecar
    try {
      await sidecar.start()
    } finally {
      if (this.startingSidecar === sidecar) {
        this.startingSidecar = null
      }
    }
    // 启动过程中若已 dispose（退出/重启在启动期插入），此 sidecar 已拉起 opencode，就地回收后返回，
    // 绝不再赋值/标记 ready。OpencodeSidecar.dispose 幂等，与 dispose() 里对 startingSidecar 的回收互不冲突。
    if (this.disposed) {
      await sidecar.dispose()
      return
    }
    this.sidecar = sidecar
    this.started = true
  }

  private handleSidecarExit(info: { code?: number | null; error?: Error; signal?: NodeJS.Signals | null }): void {
    if (this.disposed) {
      return
    }
    this.started = false
    this.sidecar = null
    this.eventStreamAbort?.abort()
    this.eventStreamAbort = null
    const message = info.error
      ? info.error.message
      : `opencode serve exited${info.code === undefined ? "" : ` with code ${info.code}`}${
          info.signal ? ` (${info.signal})` : ""
        }`
    console.warn("[wanta] opencode sidecar exited unexpectedly:", message)
    this.runtimeRecovery ??= this.recoverRuntime(message).finally(() => {
      this.runtimeRecovery = null
    })
  }

  private async recoverRuntime(reason: string): Promise<void> {
    let lastMessage = reason
    for (let attempt = 1; attempt <= runtimeRestartMaxAttempts; attempt += 1) {
      if (this.disposed) {
        return
      }
      this.eventSubscriber?.onConnectionStatus?.({
        status: "runtime_restarting",
        attempt,
        maxAttempts: runtimeRestartMaxAttempts,
        message: lastMessage,
      })
      try {
        await this.prepareWorkspace()
        await this.startSidecar()
        this.eventSubscriber?.onConnectionStatus?.({
          status: "runtime_recovered",
          attempt,
          maxAttempts: runtimeRestartMaxAttempts,
        })
        this.restartEventLoop()
        return
      } catch (error) {
        lastMessage = error instanceof Error ? error.message : String(error)
        console.warn("[wanta] opencode sidecar restart failed:", { attempt, error })
        if (attempt < runtimeRestartMaxAttempts) {
          await sleep(Math.min(runtimeRestartInitialDelayMs * 2 ** (attempt - 1), runtimeRestartMaxDelayMs))
        }
      }
    }
    this.eventSubscriber?.onConnectionStatus?.({
      status: "runtime_failed",
      attempt: runtimeRestartMaxAttempts,
      maxAttempts: runtimeRestartMaxAttempts,
      message: lastMessage,
    })
  }

  /** 订阅 OpenCode 全局 SSE 事件流。回调收到原始 OpenCode 事件 {type, properties}。返回停止函数。 */
  public subscribe(
    onEvent: (event: { type: string; data?: Record<string, unknown>; properties?: Record<string, unknown> }) => void,
    onConnectionStatus?: (status: AgentEventConnectionStatus) => void,
  ): () => void {
    this.eventLoopStopped = false
    this.eventSubscriber = { onEvent, onConnectionStatus }
    this.eventLoopRestartFailures = 0
    this.restartEventLoop()
    return () => {
      this.eventLoopStopped = true
      this.eventSubscriber = null
      this.eventStreamAbort?.abort()
      this.eventStreamAbort = null
    }
  }

  private restartEventLoop(): void {
    const subscriber = this.eventSubscriber
    if (!subscriber || this.eventLoopStopped || !this.started || this.disposed) {
      return
    }
    this.eventStreamAbort?.abort()
    const controller = new AbortController()
    this.eventStreamAbort = controller
    void this.runEventLoop(subscriber, controller)
  }

  private async runEventLoop(subscriber: AgentEventSubscriber, controller: AbortController): Promise<void> {
    let reconnectFailures = 0
    let reconnecting = false
    let reconnectFailedAnnounced = false
    let restartMessage = "OpenCode event stream disconnected; reconnecting."
    try {
      const subscription = await this.client.event.subscribe(undefined, {
        signal: controller.signal,
        onSseError: (error) => {
          if (this.eventLoopStopped || controller.signal.aborted) {
            return
          }
          reconnectFailures += 1
          reconnecting = true
          const message = error instanceof Error ? error.message : String(error)
          if (reconnectFailures <= eventStreamMaxReconnectAttempts) {
            subscriber.onConnectionStatus?.({
              status: "reconnecting",
              attempt: reconnectFailures,
              maxAttempts: eventStreamMaxReconnectAttempts,
              message,
            })
          }
          if (reconnectFailures >= eventStreamMaxReconnectAttempts && !reconnectFailedAnnounced) {
            reconnectFailedAnnounced = true
            subscriber.onConnectionStatus?.({
              status: "failed",
              attempt: reconnectFailures,
              maxAttempts: eventStreamMaxReconnectAttempts,
              message,
            })
          }
        },
        onSseEvent: () => {
          if ((!reconnecting && !reconnectFailedAnnounced) || this.eventLoopStopped || controller.signal.aborted) {
            return
          }
          subscriber.onConnectionStatus?.({
            status: "reconnected",
            attempt: reconnectFailures,
            maxAttempts: eventStreamMaxReconnectAttempts,
          })
          reconnectFailures = 0
          reconnecting = false
          reconnectFailedAnnounced = false
          this.eventLoopRestartFailures = 0
        },
      })
      const stream = (
        subscription as {
          stream: AsyncIterable<{ type: string; data?: Record<string, unknown>; properties?: Record<string, unknown> }>
        }
      ).stream
      for await (const event of stream) {
        if (this.eventLoopStopped) {
          break
        }
        this.eventLoopRestartFailures = 0
        // OpenCode 每十秒发送一次保活；它不承载业务状态，不应触发周期性诊断写盘。
        if (event.type !== "server.heartbeat") {
          this.eventMetrics.record(event.type)
        }
        try {
          subscriber.onEvent(event)
        } catch (error) {
          console.error("[wanta] opencode event handling failed:", error)
          logDiagnostic(
            "opencode-event-stream",
            "opencode event handling failed",
            {
              error,
              eventType: event.type,
            },
            "error",
          )
        }
      }
      if (!this.eventLoopStopped && !controller.signal.aborted) {
        console.warn("[wanta] opencode event stream ended without error")
        logDiagnostic("opencode-event-stream", "opencode event stream ended without error", {}, "warn")
      }
    } catch (error) {
      if (!this.eventLoopStopped && !controller.signal.aborted) {
        console.error("[wanta] opencode event stream ended:", error)
        logDiagnostic("opencode-event-stream", "opencode event stream ended", { error }, "error")
        restartMessage = error instanceof Error ? error.message : String(error)
      }
    } finally {
      const shouldRestart =
        this.eventStreamAbort === controller &&
        !this.eventLoopStopped &&
        !this.disposed &&
        this.started &&
        this.eventSubscriber === subscriber &&
        !controller.signal.aborted
      if (this.eventStreamAbort === controller) {
        this.eventStreamAbort = null
      }
      if (shouldRestart) {
        this.scheduleEventLoopRestart(subscriber, restartMessage)
      }
    }
  }

  private scheduleEventLoopRestart(subscriber: AgentEventSubscriber, message: string): void {
    const nextAttempt = this.eventLoopRestartFailures + 1
    if (nextAttempt > eventStreamMaxReconnectAttempts) {
      this.eventLoopRestartFailures = eventStreamMaxReconnectAttempts
      subscriber.onConnectionStatus?.({
        status: "failed",
        attempt: eventStreamMaxReconnectAttempts,
        maxAttempts: eventStreamMaxReconnectAttempts,
        message,
      })
      return
    }
    this.eventLoopRestartFailures = nextAttempt
    const delayMs = Math.min(
      eventStreamRestartInitialDelayMs * 2 ** Math.max(0, nextAttempt - 1),
      eventStreamRestartMaxDelayMs,
    )
    subscriber.onConnectionStatus?.({
      status: "reconnecting",
      attempt: nextAttempt,
      maxAttempts: eventStreamMaxReconnectAttempts,
      message,
    })
    const timer = setTimeout(() => {
      if (
        this.eventLoopStopped ||
        this.disposed ||
        !this.started ||
        this.eventSubscriber !== subscriber ||
        this.eventStreamAbort
      ) {
        return
      }
      this.restartEventLoop()
    }, delayMs)
    timer.unref?.()
  }

  public async listSessions(): Promise<SessionInfo[]> {
    if (!this.started) {
      return []
    }
    const result = await this.client.session.list()
    assertOpencodeSuccess(result, "session.list")
    const sessions = (result.data ?? []) as RawSession[]
    return sessions
      .filter(isUserVisibleSession)
      .map(toSessionInfo)
      .sort((a, b) => b.updatedAt - a.updatedAt)
  }

  public async createSession(title?: string): Promise<SessionInfo> {
    const result = await this.client.session.create(title ? { title } : {})
    assertOpencodeSuccess(result, "session.create")
    if (!result.data) throw new Error("session.create failed: no data")
    return toSessionInfo(result.data as RawSession)
  }

  public async renameSession(id: string, title: string): Promise<void> {
    const result = await this.client.session.update({ sessionID: id, title })
    assertOpencodeSuccess(result, "session.update")
  }

  public async deleteSession(id: string): Promise<void> {
    const result = await this.client.session.delete({ sessionID: id })
    assertOpencodeSuccess(result, "session.delete")
  }

  public generateSessionTitle(input: GenerateSessionTitleRequest): Promise<GeneratedSessionTitle> {
    return generateTitle(input, (choice) => this.resolveSessionTitleTarget(choice))
  }
  private resolveSessionTitleTarget(choice: ModelChoice | undefined): {
    apiKey: string
    baseUrl: string
    modelID: string
  } {
    const effectiveChoice = choice ?? this.options.defaultModel
    if (this.options.modelAccess.kind !== "oomol") {
      const customModel = this.resolveLocalCustomModel(effectiveChoice)
      return { apiKey: customModel.apiKey, baseUrl: customModel.baseUrl, modelID: customModel.modelName }
    }
    const resolved = this.resolveModel(effectiveChoice)
    if (effectiveChoice?.kind !== "custom") {
      return { apiKey: this.options.modelAccess.sessionToken, baseUrl: llmBaseUrl, modelID: resolved.modelID }
    }
    const customModel = this.options.customModels?.find((item) => item.id === effectiveChoice.id)
    if (!customModel) {
      throw new Error("Selected custom model is no longer available.")
    }
    return { apiKey: customModel.apiKey, baseUrl: customModel.baseUrl, modelID: resolved.modelID }
  }

  public async getMessages(sessionId: string): Promise<ChatMessage[]> {
    if (!this.started) {
      return []
    }
    const result = await this.client.session.messages({ sessionID: sessionId })
    assertOpencodeSuccess(result, "session.messages")
    const raw = (result.data ?? []) as Array<{ info?: unknown; parts?: unknown }>
    const messages: ChatMessage[] = []
    for (const item of raw) {
      const normalized = normalizeMessage(item)
      if (normalized) {
        messages.push(normalized)
      }
    }
    return messages
      .map((message, index) => ({ index, message }))
      .sort((left, right) => left.message.createdAt - right.message.createdAt || left.index - right.index)
      .map((item) => item.message)
  }

  public async getPendingQuestions(sessionId: string): Promise<ChatQuestionRequest[]> {
    return this.getPendingQuestionsForSessions([sessionId])
  }

  public async getPendingQuestionsForSessions(sessionIds: readonly string[]): Promise<ChatQuestionRequest[]> {
    if (!this.started) {
      return []
    }
    const requestedSessionIds = new Set(sessionIds)
    if (requestedSessionIds.size === 0) return []
    const result = await this.client.question.list()
    assertOpencodeSuccess(result, "question.list")
    const raw = Array.isArray(result.data) ? result.data : []
    return raw
      .map(normalizeQuestionRequest)
      .filter((request): request is ChatQuestionRequest => Boolean(request))
      .filter((request) => requestedSessionIds.has(request.sessionId))
  }

  public async answerQuestion(_sessionId: string, requestId: string, answers: string[][]): Promise<void> {
    const result = await this.client.question.reply({
      requestID: requestId,
      answers,
    })
    assertOpencodeSuccess(result, "question.reply")
  }

  public async rejectQuestion(_sessionId: string, requestId: string): Promise<void> {
    const result = await this.client.question.reject({ requestID: requestId })
    assertOpencodeSuccess(result, "question.reject")
  }

  public async getPendingPermissions(sessionId: string): Promise<ChatPermissionRequest[]> {
    return this.getPendingPermissionsForSessions([sessionId])
  }

  public async getPendingPermissionsForSessions(sessionIds: readonly string[]): Promise<ChatPermissionRequest[]> {
    if (!this.started) {
      return []
    }
    const requestedSessionIds = new Set(sessionIds)
    if (requestedSessionIds.size === 0) return []
    const result = await this.client.permission.list()
    assertOpencodeSuccess(result, "permission.list")
    const raw = Array.isArray(result.data) ? result.data : []
    return raw
      .map(normalizePermissionRequest)
      .filter((request): request is ChatPermissionRequest => Boolean(request))
      .filter((request) => requestedSessionIds.has(request.sessionId))
  }

  public async answerPermission(_sessionId: string, requestId: string, reply: ChatPermissionReply): Promise<void> {
    const result = await this.client.permission.reply({ requestID: requestId, reply })
    assertOpencodeSuccess(result, "permission.reply")
  }

  /**
   * 非阻塞发送：立即返回，内容经事件流推送。
   * R4：默认每轮把"账号存在已授权 Link provider"的事实注入系统提示末尾（body.system 经实测追加
   * 在 agent.prompt 之后），不列 provider 名，避免可用性上下文变成工具使用诱导。稳定前缀
   * （人格/工具/契约）留在 agent.prompt 以利缓存。
   */
  public async promptStreaming(sessionId: string, text: string, options: PromptStreamingOptions = {}): Promise<void> {
    if (options.signal?.aborted) {
      return
    }
    const tail = mergeSystemPrompts(
      this.options.linkRuntime?.kind === "oomol" ? buildWorkspaceIdentitySystem(options.teamName) : undefined,
      await this.buildAuthorizedSystem(options.teamName, options.signal),
      options.system,
      buildArtifactSystem(options.artifactDir, options.outputProjectRoot),
      buildProcessSystem(options.processDir),
    )
    if (options.signal?.aborted) {
      return
    }
    const abortPrompt = (): void => {
      void this.abort(sessionId).catch((error) => {
        console.warn("[wanta] abort prompt after signal failed:", error)
      })
    }
    options.signal?.addEventListener("abort", abortPrompt, { once: true })
    try {
      if (options.signal?.aborted) {
        return
      }
      const variant = this.resolveReasoningVariant(options.model, options.reasoningLevel)
      const attachmentCapabilities = this.resolveAttachmentCapabilities(options.model)
      const body: NonNullable<SessionPromptAsyncData["body"]> = {
        agent: normalizeWantaAgentMode(options.mode),
        ...(options.messageId ? { messageID: options.messageId } : {}),
        model: this.resolveModel(options.model),
        ...(tail ? { system: tail } : {}),
        ...(variant ? { variant } : {}),
        parts: await buildPromptParts(text, options.attachments, attachmentCapabilities),
      }
      const result = await this.client.session.promptAsync(
        { sessionID: sessionId, ...body },
        { signal: options.signal },
      )
      if (options.signal?.aborted) {
        return
      }
      assertOpencodeSuccess(result, "session.promptAsync")
    } finally {
      options.signal?.removeEventListener("abort", abortPrompt)
    }
  }

  /** R4：构建注入系统提示末尾的已授权 Link 可用性提示（无已授权则 undefined）。 */
  public async buildAuthorizedSystem(teamName?: string, signal?: AbortSignal): Promise<string | undefined> {
    if (!this.options.linkRuntime) return undefined
    const services = await this.authorizedServicesForPrompt(teamName, signal)
    if (services.length === 0) {
      return undefined
    }
    return (
      `Some Link providers are already authorized for the active workspace. ` +
      `This is availability awareness only: it is not a recommendation to use Link tools and does not indicate that any provider fits the current task. ` +
      `For questions about which providers are connected, use list_apps. When, and only when, the user's request needs private/account-specific SaaS data or actions, use Link tools to discover the appropriate action; search results include whether a provider is authenticated. ` +
      `Ignore this note for direct answers, local files, commands, concrete URLs, webpage fetching, and general web browsing.`
    )
  }

  /** 提示词关键路径只等待很短预算；过期值可立即复用，刷新在后台完成。 */
  private async authorizedServicesForPrompt(teamName?: string, signal?: AbortSignal): Promise<string[]> {
    const cacheKey =
      this.options.linkRuntime?.kind === "openconnector"
        ? `openconnector:${this.options.linkRuntime.baseUrl}`
        : `oomol:${connectorBaseUrl}:team:${normalizeTeamName(teamName) ?? ""}`
    const cached = this.authorizedServicesCache.get(cacheKey)
    if (cached && Date.now() - cached.loadedAt < authorizedServicesCacheTtlMs) {
      return cached.services
    }
    let load = this.authorizedServicesLoads.get(cacheKey)
    if (!load) {
      const controller = new AbortController()
      load = this.listAuthorizedServices(teamName, controller.signal).then((services) => {
        if (!this.disposed && this.authorizedServicesLoads.get(cacheKey) === load) {
          this.authorizedServicesCache.set(cacheKey, { loadedAt: Date.now(), services })
        }
        return services
      })
      this.authorizedServicesLoadControllers.set(cacheKey, controller)
      this.authorizedServicesLoads.set(cacheKey, load)
      const finishLoad = () => {
        if (this.authorizedServicesLoads.get(cacheKey) === load) {
          this.authorizedServicesLoads.delete(cacheKey)
          this.authorizedServicesLoadControllers.delete(cacheKey)
        }
      }
      void load.then(finishLoad, finishLoad)
    }
    if (cached) {
      return cached.services
    }
    return settleWithinPromptBudget(load, authorizedServicesPromptBudgetMs, signal)
  }

  /** 直查 connector /v1/apps，返回已授权（active）service 名清单（R4 动态系统提示用）。 */
  public async listAuthorizedServices(teamName?: string, signal?: AbortSignal): Promise<string[]> {
    if (!this.started || !this.options.linkRuntime) {
      return []
    }
    if (this.options.linkRuntime.kind === "openconnector") {
      return this.options.listOpenConnectorAuthorizedServices?.(signal) ?? []
    }
    const normalizedTeamName = normalizeTeamName(teamName)
    const requestSignal = signalWithTimeout(signal, 15_000)
    try {
      const response = await fetch(`${connectorBaseUrl}/v1/apps`, {
        headers: {
          Authorization: `Bearer ${this.options.linkRuntime.sessionToken}`,
          ...(normalizedTeamName ? { "x-oo-organization-name": normalizedTeamName } : {}),
        },
        signal: requestSignal.signal,
      })
      if (!response.ok) {
        console.warn("[wanta] authorized service lookup failed:", response.status, response.statusText)
        logDiagnostic(
          "agent",
          "authorized service lookup failed",
          {
            status: response.status,
            statusText: response.statusText,
          },
          "warn",
        )
        return []
      }
      const payload = (await response.json()) as { data?: Array<{ service?: string; status?: string }> }
      const apps = payload.data ?? []
      return apps.filter((a) => a.status === "active" && a.service).map((a) => a.service as string)
    } catch (error) {
      if (!signal?.aborted) {
        console.warn("[wanta] authorized service lookup failed:", error)
        logDiagnostic("agent", "authorized service lookup failed", { error }, "warn")
      }
      return []
    } finally {
      requestSignal.cleanup()
    }
  }

  public async abort(sessionId: string): Promise<void> {
    const result = await this.client.session.abort({ sessionID: sessionId })
    assertOpencodeSuccess(result, "session.abort")
  }

  public async createArtifactDir(sessionId: string, projectRoot?: string): Promise<string> {
    if (projectRoot) {
      return this.createProjectArtifactDir(sessionId, projectRoot)
    }
    return this.createTurnDir("artifacts", sessionId)
  }

  public artifactSessionDir(sessionId: string, projectRoot?: string): string {
    if (projectRoot) {
      return path.resolve(projectRoot, ".wanta", "artifacts", sanitizeArtifactPathSegment(sessionId))
    }
    return this.sessionTurnRoot("artifacts", sessionId)
  }

  public async createProcessDir(sessionId: string): Promise<string> {
    return this.createTurnDir("process", sessionId)
  }

  private async createTurnDir(kind: "artifacts" | "process", sessionId: string): Promise<string> {
    const root = this.sessionTurnRoot(kind, sessionId)
    await mkdir(root, { recursive: true })
    return createUniqueTurnDir(root)
  }

  private async createProjectArtifactDir(sessionId: string, projectRoot: string): Promise<string> {
    const requestedProjectRoot = path.resolve(projectRoot)
    const requestedProjectStat = await lstat(requestedProjectRoot)
    if (!requestedProjectStat.isDirectory() || requestedProjectStat.isSymbolicLink()) {
      throw new Error("Project artifact root is not a directory.")
    }
    const resolvedProjectRoot = await realpath(requestedProjectRoot)
    const resolvedProjectStat = await lstat(resolvedProjectRoot)
    if (!resolvedProjectStat.isDirectory() || resolvedProjectStat.isSymbolicLink()) {
      throw new Error("Project artifact root is not a directory.")
    }
    const sessionRoot = await ensureProjectArtifactSessionRoot(resolvedProjectRoot, sessionId)
    return createUniqueTurnDir(sessionRoot)
  }

  private sessionTurnRoot(kind: "artifacts" | "process", sessionId: string): string {
    const root = path.resolve(this.options.rootDir, kind)
    const dir = path.resolve(root, sanitizeArtifactPathSegment(sessionId))
    if (!pathInside(root, dir)) {
      throw new Error("Invalid session directory segment.")
    }
    return dir
  }

  /** 阻塞发送（headless 验证用）：发送并返回该会话全部消息。 */
  public async sendMessage(text: string, sessionId?: string, system?: string): Promise<SendMessageResult> {
    let id = sessionId
    if (!id) {
      id = (await this.createSession(branding.appName)).id
    }
    const prompted = await this.client.session.prompt({
      sessionID: id,
      agent: normalizeWantaAgentMode(undefined),
      model: { providerID: WANTA_PROVIDER_ID, modelID: WANTA_MODEL_ID },
      ...(system ? { system } : {}),
      parts: [{ type: "text", text }],
    })
    assertOpencodeSuccess(prompted, "session.prompt")
    const messageResult = await this.client.session.messages({ sessionID: id })
    assertOpencodeSuccess(messageResult, "session.messages")
    const messages = messageResult.data
    return { sessionId: id, messages }
  }

  private async writeTeamScope(teamName: string | undefined): Promise<void> {
    if (!this.teamScopePath) {
      return
    }
    const content = JSON.stringify({
      teamName: teamName ?? "",
      sessionKnowledgeBaseIds: Object.fromEntries(this.sessionKnowledgeBaseIds),
      sessionTeams: Object.fromEntries(this.sessionTeamNames),
    })
    await atomicWriteText(this.teamScopePath, content)
  }

  private async writeTeamState(teamName: string | undefined): Promise<void> {
    const previousTeamName = this.teamName
    await this.writeOoIdentity(teamName)
    try {
      await this.writeTeamScope(teamName)
    } catch (error) {
      try {
        await this.writeOoIdentity(previousTeamName)
      } catch (rollbackError) {
        throw new AggregateError([error, rollbackError], "Failed to persist and rollback agent team state.")
      }
      throw error
    }
  }

  private async writeOoIdentity(teamName: string | undefined): Promise<void> {
    await writeOoIdentitySettings(path.join(this.options.rootDir, "oo-store", "config"), teamName)
  }

  /**
   * 销毁 agent：同步摘掉事件流与引用，返回 sidecar 进程树回收的 Promise。
   * 退出路径应 await（确保 opencode 及其工具子进程被连根回收后再退出主进程，
   * 否则残留孤儿会被 macOS 判为"正在后台运行"）；重启路径可 fire-and-forget。
   */
  public dispose(): Promise<void> {
    this.disposed = true
    this.eventLoopStopped = true
    this.eventStreamAbort?.abort()
    this.eventStreamAbort = null
    this.eventSubscriber = null
    this.started = false
    this.eventMetrics.dispose()
    this.authorizedServicesCache.clear()
    for (const controller of this.authorizedServicesLoadControllers.values()) {
      controller.abort(new Error("Agent manager was disposed."))
    }
    this.authorizedServicesLoadControllers.clear()
    this.authorizedServicesLoads.clear()
    // 同时回收"启动中"的实例：退出/重启可能正卡在 startSidecar 的 await 上，此时 this.sidecar 仍为
    // null，但 startingSidecar 已 spawn opencode，必须一并连根回收，否则它会成为漏网孤儿。
    const sidecar = this.sidecar ?? this.startingSidecar
    this.sidecar = null
    this.startingSidecar = null
    return sidecar?.dispose() ?? Promise.resolve()
  }

  private resolveModel(choice: ModelChoice | undefined): { providerID: string; modelID: string } {
    const effectiveChoice = choice ?? this.options.defaultModel
    if (this.options.modelAccess.kind !== "oomol") {
      const customModel = this.resolveLocalCustomModel(effectiveChoice)
      return { providerID: customProviderId(customModel.id), modelID: customModel.modelName }
    }
    if (!effectiveChoice || effectiveChoice.kind === "builtin") {
      const modelID =
        effectiveChoice && isBuiltinModelId(effectiveChoice.id) ? effectiveChoice.id : DEFAULT_BUILTIN_MODEL_ID
      return resolveBuiltinModel(modelID).runtime
    }
    const model = this.options.customModels?.find((item) => item.id === effectiveChoice.id)
    if (!model) {
      throw new Error("Selected custom model is no longer available.")
    }
    return { providerID: customProviderId(model.id), modelID: model.modelName }
  }

  private resolveReasoningVariant(
    choice: ModelChoice | undefined,
    level: ReasoningLevel | undefined,
  ): string | undefined {
    const variant = opencodeReasoningVariant(level)
    if (!variant) {
      return undefined
    }
    const effectiveChoice = choice ?? this.options.defaultModel
    if (this.options.modelAccess.kind !== "oomol") {
      const model = this.resolveLocalCustomModel(effectiveChoice)
      return model.reasoningVariants?.includes(variant) ? variant : undefined
    }
    if (effectiveChoice?.kind === "custom") {
      const model = this.options.customModels?.find((item) => item.id === effectiveChoice.id)
      return model?.reasoningVariants?.includes(variant) ? variant : undefined
    }
    const modelID =
      effectiveChoice && isBuiltinModelId(effectiveChoice.id) ? effectiveChoice.id : DEFAULT_BUILTIN_MODEL_ID
    const model = resolveBuiltinModel(modelID)
    return model.capabilities.reasoningVariants?.includes(variant) ? variant : undefined
  }

  private resolveAttachmentCapabilities(choice: ModelChoice | undefined): { images: boolean; pdf: boolean } {
    const effectiveChoice = choice ?? this.options.defaultModel
    if (this.options.modelAccess.kind !== "oomol") {
      const model = this.resolveLocalCustomModel(effectiveChoice)
      return { images: model.supportsImages === true, pdf: false }
    }
    if (effectiveChoice?.kind === "custom") {
      const model = this.options.customModels?.find((item) => item.id === effectiveChoice.id)
      return { images: model?.supportsImages === true, pdf: false }
    }
    const modelID =
      effectiveChoice && isBuiltinModelId(effectiveChoice.id) ? effectiveChoice.id : DEFAULT_BUILTIN_MODEL_ID
    const capabilities = resolveBuiltinModel(modelID).capabilities
    return { images: capabilities.supportsImages, pdf: capabilities.supportsPdf }
  }

  private resolveLocalCustomModel(choice: ModelChoice | undefined): RuntimeCustomModel {
    const modelId = choice?.kind === "custom" ? choice.id : this.options.defaultModel?.id
    const model = this.options.customModels?.find((item) => item.id === modelId)
    if (model) {
      return model
    }
    if (choice?.kind === "custom") {
      throw new Error("Selected custom model is no longer available.")
    }
    throw new Error("A custom model is required for the local Agent runtime.")
  }
}

export function buildWorkspaceIdentitySystem(teamName?: string): string {
  const normalizedTeamName = normalizeTeamName(teamName)
  if (!normalizedTeamName) {
    throw new Error("Team workspace identity is unavailable")
  }
  return `Current-turn Link workspace: team ${JSON.stringify(normalizedTeamName)}; raw oo selector: --organization ${JSON.stringify(normalizedTeamName)}.`
}

async function buildPromptParts(
  text: string,
  attachments: ChatAttachment[] | undefined,
  capabilities: { images: boolean; pdf: boolean },
): Promise<Array<TextPartInput | FilePartInput>> {
  const parts: Array<TextPartInput | FilePartInput> = []
  for (const input of await planAttachmentInputs(attachments, capabilities)) {
    if (input.kind === "internal-text") {
      parts.push({
        type: "text",
        text: input.text,
        synthetic: true,
        metadata: {
          wantaPurpose: input.purpose,
          wantaVisibility: "internal",
        },
      })
      continue
    }
    parts.push({
      type: "file",
      mime: input.mime,
      filename: input.name,
      url: pathToFileUrl(input.path),
      source: {
        type: "file",
        path: input.path,
        text: { value: input.name, start: 0, end: input.name.length },
      },
    })
  }
  parts.push({ type: "text", text })
  return parts
}

function signalWithTimeout(
  signal: AbortSignal | undefined,
  timeoutMs: number,
): { signal: AbortSignal; cleanup: () => void } {
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs)
  const abort = (): void => {
    controller.abort(signal?.reason)
  }
  if (signal?.aborted) {
    abort()
  } else {
    signal?.addEventListener("abort", abort, { once: true })
  }
  return {
    signal: controller.signal,
    cleanup: () => {
      clearTimeout(timeoutId)
      signal?.removeEventListener("abort", abort)
    },
  }
}

function settleWithinPromptBudget(
  request: Promise<string[]>,
  timeoutMs: number,
  signal?: AbortSignal,
): Promise<string[]> {
  return new Promise((resolve) => {
    let completed = false
    const settle = (services: string[]): void => {
      if (completed) {
        return
      }
      completed = true
      clearTimeout(timer)
      signal?.removeEventListener("abort", abort)
      resolve(services)
    }
    const abort = (): void => settle([])
    const timer = setTimeout(() => {
      settle([])
    }, timeoutMs)
    timer.unref?.()
    if (signal?.aborted) {
      settle([])
    } else {
      signal?.addEventListener("abort", abort, { once: true })
    }
    void request.then(
      (services) => settle(services),
      () => settle([]),
    )
  })
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms)
    timer.unref?.()
  })
}

export function buildArtifactSystem(artifactDir: string | undefined, outputProjectRoot?: string): string | undefined {
  if (!artifactDir) {
    return undefined
  }
  const projectPublication = outputProjectRoot
    ? [
        `- This turn belongs to a folder project. Wanta will publish final deliverables from this managed directory into the visible project directory: ${outputProjectRoot}`,
        "- Use descriptive user-facing file and directory names. Preserve any project-relative output layout explicitly requested by the user inside this managed directory; Wanta will reproduce that layout in the project.",
        "- Do not write a second copy directly into the project directory. Wanta performs the checked, collision-safe publication after the turn completes.",
        "- In the final response, refer to deliverables by their user-facing names or requested project-relative locations. Do not present the managed artifact path as the final project location.",
      ]
    : []
  return [
    "Artifact output contract for this turn:",
    `- Use this exact directory for files you create, convert, export, download, or modify as user-facing deliverables: ${artifactDir}`,
    "- Do not create files just because this artifact directory is provided.",
    ...projectPublication,
    "- For edits to an existing local project, modify the requested project files in place; even when this artifact directory is inside the project, use it only for exported deliverables, generated assets, converted files, reports, or packaged outputs.",
    "- Wanta indexes the directory recursively and determines the artifact type from the actual files. Do not create a manifest or describe files that do not exist.",
    "- Treat HTML reports, images, PDFs, charts, spreadsheets, presentations, archives, and documents as user-facing deliverables.",
    "- For image sets, save every final image in display order with stable padded names such as 001.jpg and 002.jpg.",
    "- Image preview and artifact persistence are separate outputs, and both are required for every final generated image whenever the source can be materialized. Preserve a useful inline preview whenever an image provider or tool returns a viewable image, even when that preview is remote, data-backed, or temporary.",
    "- Persist every final generated image into this directory. If a tool returns only a remote, data-backed, or temporary preview, keep the preview reference intact so Wanta can materialize the same image during turn finalization. Do not describe it as a saved local file until persistence succeeds.",
    "- When the final deliverable is one to four image files and inline viewing helps the user, include Markdown image references in the final response using their absolute local paths, for example ![short title](</absolute/path/image.png>).",
    "- If only a provider-backed image preview is available, keep that preview visible in the final response instead of omitting it. Wanta will materialize supported preview sources and independently report persistence failures.",
    "- When there are many images, such as crawled or downloaded image sets, do not inline every image in the final response. Summarize the set and rely on the artifact browser.",
    "- Do not reuse output folders from earlier turns or other chats.",
    "- If you reuse a script from an earlier turn, copy or update it before running and replace every embedded output path with this turn's artifact directory. Never run a prior-turn script while it still targets an earlier output directory.",
    "- Do not write deliverables to Desktop, Downloads, the OpenCode workspace, or prior output directories unless the user explicitly requested that exact destination.",
    outputProjectRoot
      ? "- When you finish, summarize the deliverable contents and names in prose; Wanta will surface the checked final project locations after publication."
      : "- When you finish, summarize the deliverable contents and report generated file paths in prose or inline code, not fenced code blocks; fenced blocks are only for code or multi-line text.",
    "- Do not open generated files with system commands unless the user explicitly asks you to open them externally; the app is responsible for surfacing artifacts in the UI.",
  ].join("\n")
}

function buildProcessSystem(processDir: string | undefined): string | undefined {
  if (!processDir) {
    return undefined
  }
  const pythonEnvironmentDir = managedPythonEnvironmentPath(processDir)
  const pythonExecutable = managedPythonExecutable(processDir)
  const createPythonEnvironment =
    process.platform === "win32"
      ? `py -3 -m venv ${JSON.stringify(pythonEnvironmentDir)}`
      : `python3 -m venv ${JSON.stringify(pythonEnvironmentDir)}`
  return [
    "Intermediate process file contract for this turn:",
    `- Use this exact directory for temporary scripts, raw service responses, debug logs, scratch data, and other implementation files that help you complete the task but are not the user-facing deliverable: ${processDir}`,
    "- Do not put final deliverables in this process directory.",
    "- Do not put process files in the artifact directory unless the user explicitly asked for source code or scripts as the deliverable.",
    "- When a task needs third-party Python modules, create and use this task-private virtual environment instead of the system Python:",
    `  - Create it when needed: ${createPythonEnvironment}`,
    `  - Install direct requirements for temporary work with: ${JSON.stringify(pythonExecutable)} -m pip install <package ...>`,
    "  - Direct requirements with no explicit source override are normally approved automatically regardless of package popularity. Ordinary extras, version constraints, and convenience flags are accepted; do not add a version constraint unless the task needs one.",
    "  - Do not use pip or pip3 directly, --user, --break-system-packages, sudo, alternative indexes, local paths, URLs, or requirements files.",
    "- When a task needs third-party Node.js modules only for temporary processing, install direct packages with no explicit source override in this process directory using an explicit target such as `cd <process-directory> && npm install <package ...>`. Package popularity does not affect approval, and package runners may be used when they are the shortest reliable path. Do not use global installation, custom registries, Git/URL/local sources, or user config.",
    "- Prefer short, descriptive filenames such as create_presentation.js, transform_data.py, raw-input.json, or render-log.txt.",
    "- Do not mention process files in the final response unless the user asks for implementation details, debugging details, or source files.",
  ].join("\n")
}

function mergeSystemPrompts(...parts: Array<string | undefined>): string | undefined {
  const merged = parts
    .map((part) => part?.trim())
    .filter((part): part is string => Boolean(part))
    .join("\n\n")
  return merged || undefined
}

function pathToFileUrl(filePath: string): string {
  return pathToFileURL(path.resolve(filePath)).toString()
}

function sanitizeArtifactPathSegment(value: string): string {
  const cleaned = value.replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 120)
  return cleaned || "session"
}

async function createUniqueTurnDir(root: string): Promise<string> {
  const resolvedDir = path.resolve(root, `${Date.now()}-${randomUUID()}`)
  if (!pathInside(root, resolvedDir)) {
    throw new Error("Invalid turn directory segment.")
  }
  await mkdir(resolvedDir)
  return resolvedDir
}

async function ensurePlainDirectory(parent: string, name: string): Promise<string> {
  const directory = path.join(parent, name)
  try {
    await mkdir(directory)
  } catch (error) {
    if (!(error instanceof Error && "code" in error && error.code === "EEXIST")) {
      throw error
    }
  }
  const directoryStat = await lstat(directory)
  if (!directoryStat.isDirectory() || directoryStat.isSymbolicLink()) {
    throw new Error("Project artifact path contains a non-directory or symbolic link.")
  }
  return directory
}

async function ensureProjectArtifactSessionRoot(projectRoot: string, sessionId: string): Promise<string> {
  const wantaRoot = await ensurePlainDirectory(projectRoot, ".wanta")
  const artifactsRoot = await ensurePlainDirectory(wantaRoot, "artifacts")
  const sessionRoot = await ensurePlainDirectory(artifactsRoot, sanitizeArtifactPathSegment(sessionId))
  const resolvedSessionRoot = await realpath(sessionRoot)
  if (!pathInside(projectRoot, resolvedSessionRoot)) {
    throw new Error("Project artifact directory resolves outside the project.")
  }
  return resolvedSessionRoot
}

function pathInside(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate)
  return relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative)
}
