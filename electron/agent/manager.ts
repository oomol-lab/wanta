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
import type { PersistedCustomModel } from "../models/store.ts"
import type { SessionInfo } from "../session/common.ts"
import type { BuildSessionTitleInput } from "../session/title.ts"
import type { FilePartInput, SessionPromptAsyncData, TextPartInput } from "@opencode-ai/sdk/v2/client"
import type { OpencodeClient } from "@opencode-ai/sdk/v2/client"

import { randomBytes, randomUUID } from "node:crypto"
import { mkdir, writeFile } from "node:fs/promises"
import path from "node:path"
import { pathToFileURL } from "node:url"
import { branding } from "../branding.ts"
import { logDiagnostic } from "../diagnostics-log.ts"
import { connectorBaseUrl, llmBaseUrl } from "../domain.ts"
import { DEFAULT_BUILTIN_MODEL_ID, isBuiltinModelId, resolveBuiltinModel } from "../models/builtin.ts"
import { buildFallbackSessionTitle, sanitizeGeneratedSessionTitle } from "../session/title.ts"
import { buildOpencodeConfig, customProviderId, WANTA_MODEL_ID, WANTA_PROVIDER_ID } from "./config.ts"
import { normalizeMessage, normalizePermissionRequest, normalizeQuestionRequest } from "./event-translator.ts"
import { normalizeWantaAgentMode } from "./mode.ts"
import { writeOoIdentitySettings } from "./oo-identity.ts"
import { buildOoEnv } from "./oo.ts"
import { opencodeReasoningVariant } from "./reasoning.ts"
import { OpencodeSidecar } from "./sidecar.ts"
import { ensureAgentWorkspace } from "./workspace.ts"

export interface AgentManagerOptions {
  /** 网关鉴权凭证：现为会话 token（网关层接受 cookie/token/api-key）。LLM 网关 / connector / oo-cli 共用。 */
  authToken: string
  /** opencode 二进制绝对路径。 */
  opencodeBinPath: string
  /** oo 二进制绝对路径。 */
  ooBinPath: string
  /** 内置 oo skill 源目录（resources/skills 或打包 Resources/skills）；启动时拷进 .opencode/skill/。 */
  bundledSkillsDir?: string
  /** 当前组织工作区名称；未设置表示个人空间。 */
  organizationName?: string
  /** App 私有根目录（userData 下）：workspace / oo-store / isolation 都在其下。 */
  rootDir: string
  /** 自定义 OpenAI-compatible 模型配置。apiKey 只进入 sidecar env config，不落到 OpenCode 文件。 */
  customModels?: PersistedCustomModel[]
  /** 关闭 sidecar Basic Auth（默认开，随机口令）。 */
  disableServerAuth?: boolean
}

function normalizeOrganizationName(organizationName: string | undefined): string | undefined {
  const normalized = organizationName?.trim()
  return normalized ? normalized : undefined
}

export interface OrganizationScopePersistenceOptions {
  currentName: string | undefined
  nextName: string | undefined
  writeScope: (organizationName: string | undefined) => Promise<void>
}

export async function persistOrganizationScopeUpdate({
  currentName,
  nextName,
  writeScope,
}: OrganizationScopePersistenceOptions): Promise<void> {
  try {
    await writeScope(nextName)
  } catch (error) {
    try {
      await writeScope(currentName)
    } catch (rollbackError) {
      console.warn("[wanta] failed to rollback agent organization scope:", rollbackError)
      logDiagnostic(
        "agent",
        "failed to rollback agent organization scope",
        { error: rollbackError, organizationName: currentName },
        "warn",
      )
      throw new AggregateError([error, rollbackError], "Failed to persist and rollback agent organization scope.")
    }
    throw error
  }
}

export interface SendMessageResult {
  sessionId: string
  messages: unknown
}

export interface PromptStreamingOptions {
  system?: string
  attachments?: ChatAttachment[]
  mode?: AgentMode
  model?: ModelChoice
  organizationName?: string
  reasoningLevel?: ReasoningLevel
  artifactDir?: string
  processDir?: string
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

interface ChatCompletionResponse {
  choices?: Array<{ message?: { content?: string } }>
}

export interface GeneratedSessionTitle {
  title: string
  generated: boolean
}

const sessionTitleSystemPrompt = [
  "Generate a concise chat title as a task label.",
  'Return JSON only, exactly like {"title":"Gmail 三日报告"}.',
  "Keep the user's language when possible.",
  "Aim for a short phrase, usually 2-8 words.",
  "- Preserve complete brand, product, app, domain, and file names. Never cut Gmail to Gma or truncate any word.",
  "- Prefer the core action and object; remove polite wording such as help me, 请, 帮我, 麻烦.",
  "- No URLs, no ellipses, no markdown, no explanations, no trailing punctuation.",
  "Examples:",
  'User: 你帮我分析一下我最近三天的 Gmail 信息，然后给我总结出一个报告 -> {"title":"Gmail 三日报告"}',
  'User: 你帮我将这个店铺中商品相关的图片都抓下来 -> {"title":"抓取店铺商品图片"}',
  'User: Search 1688 product images with Metaso and Puppeteer -> {"title":"1688 Product Images"}',
].join("\n")
const sessionTitleModelID = resolveBuiltinModel("oopilot").runtime.modelID
const eventStreamMaxReconnectAttempts = 5
const eventStreamRestartInitialDelayMs = 500
const eventStreamRestartMaxDelayMs = 5_000
const runtimeRestartMaxAttempts = 5
const runtimeRestartInitialDelayMs = 1_000
const runtimeRestartMaxDelayMs = 10_000

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
  private eventStreamAbort: AbortController | null = null
  private eventSubscriber: AgentEventSubscriber | null = null
  private eventLoopRestartFailures = 0
  private disposed = false
  private runtimeRecovery: Promise<void> | null = null
  private started = false
  private eventLoopStopped = false
  private organizationName: string | undefined
  private organizationScopePath: string | undefined
  private organizationUpdateChain: Promise<void> = Promise.resolve()
  private sessionOrganizationNames = new Map<string, string>()

  public constructor(options: AgentManagerOptions) {
    this.options = options
    this.organizationName = normalizeOrganizationName(options.organizationName)
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

  /** 更新 Link 工具使用的组织工作区，不重启 sidecar，避免刷新会话列表。 */
  public async setOrganizationName(organizationName?: string): Promise<void> {
    const nextOrganizationName = normalizeOrganizationName(organizationName)
    await this.queueOrganizationUpdate(async () => {
      if (nextOrganizationName === this.organizationName) {
        return
      }
      const previousOrganizationName = this.organizationName
      await persistOrganizationScopeUpdate({
        currentName: previousOrganizationName,
        nextName: nextOrganizationName,
        writeScope: (name) => this.writeOrganizationState(name),
      })
      this.organizationName = nextOrganizationName
    })
  }

  /** 记录单个 OpenCode session 的 Link 组织身份，供并发工具调用按 session 隔离读取。 */
  public async setSessionOrganizationName(sessionId: string, organizationName?: string): Promise<void> {
    const normalizedSessionId = sessionId.trim()
    if (!normalizedSessionId) {
      throw new Error("Session id is required")
    }
    const nextOrganizationName = normalizeOrganizationName(organizationName) ?? ""
    await this.queueOrganizationUpdate(async () => {
      if (this.sessionOrganizationNames.get(normalizedSessionId) === nextOrganizationName) {
        return
      }
      this.sessionOrganizationNames.set(normalizedSessionId, nextOrganizationName)
      await this.writeOrganizationScope(this.organizationName)
    })
  }

  public async clearSessionOrganizationName(sessionId: string): Promise<void> {
    const normalizedSessionId = sessionId.trim()
    if (!normalizedSessionId) {
      return
    }
    await this.queueOrganizationUpdate(async () => {
      if (!this.sessionOrganizationNames.delete(normalizedSessionId)) {
        return
      }
      await this.writeOrganizationScope(this.organizationName)
    })
  }

  private async queueOrganizationUpdate(update: () => Promise<void>): Promise<void> {
    const task = this.organizationUpdateChain.then(update, update)
    this.organizationUpdateChain = task.catch((error: unknown) => {
      logDiagnostic("agent", "agent organization scope update failed", { error }, "warn")
    })
    await task
  }

  public async start(): Promise<void> {
    this.disposed = false
    await this.prepareWorkspace()
    await this.startSidecar()
  }

  private async prepareWorkspace(): Promise<void> {
    const { bundledSkillsDir, rootDir } = this.options
    const workspaceDir = path.join(rootDir, "workspace")
    const organizationScopePath = path.join(rootDir, "organization-scope.json")

    await ensureAgentWorkspace(workspaceDir, bundledSkillsDir)
    this.organizationScopePath = organizationScopePath
    await this.writeOrganizationState(this.organizationName)
  }

  private async startSidecar(): Promise<void> {
    const { authToken, opencodeBinPath, ooBinPath, rootDir, disableServerAuth, customModels } = this.options
    const workspaceDir = path.join(rootDir, "workspace")
    const isolationDir = path.join(rootDir, "isolation")
    const storeDir = path.join(rootDir, "oo-store")
    const organizationScopePath = this.organizationScopePath ?? path.join(rootDir, "organization-scope.json")

    const config = buildOpencodeConfig({ authToken, customModels })
    const ooEnv = buildOoEnv({
      authToken,
      organizationName: this.organizationName,
      organizationScopePath,
      storeDir,
      ooBinPath,
    })
    const ooDir = path.dirname(ooBinPath)
    const env: Record<string, string> = {
      ...ooEnv,
      // WANTA_OO_BIN 已给绝对路径；同时前置注入 PATH 作兜底。
      PATH: `${ooDir}${path.delimiter}${process.env.PATH ?? ""}`,
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
    // 仅在 sidecar 完全就绪后才赋值并标记 ready，避免 client 在启动期被访问。
    await sidecar.start()
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
    const sessions = (result.data ?? []) as RawSession[]
    return sessions
      .filter(isUserVisibleSession)
      .map(toSessionInfo)
      .sort((a, b) => b.updatedAt - a.updatedAt)
  }

  public async createSession(title?: string): Promise<SessionInfo> {
    const result = await this.client.session.create(title ? { title } : {})
    if (result.error || !result.data) {
      throw new Error(`session.create failed: ${JSON.stringify(result.error ?? "no data")}`)
    }
    return toSessionInfo(result.data as RawSession)
  }

  public async renameSession(id: string, title: string): Promise<void> {
    await this.client.session.update({ sessionID: id, title })
  }

  public async deleteSession(id: string): Promise<void> {
    await this.client.session.delete({ sessionID: id })
  }

  public async generateSessionTitle(input: BuildSessionTitleInput): Promise<GeneratedSessionTitle> {
    const fallback = buildFallbackSessionTitle(input)
    const titleSource = buildTitleSource(input)
    if (!titleSource) {
      return { generated: false, title: fallback }
    }

    try {
      const rawTitle = await this.requestSessionTitle(titleSource)
      const title = sanitizeGeneratedSessionTitle(rawTitle, input)
      return title.usedFallback ? { generated: false, title: fallback } : { generated: true, title: title.title }
    } catch (error) {
      console.warn("[wanta] failed to generate session title, using fallback:", error)
      return { generated: false, title: fallback }
    }
  }

  private async requestSessionTitle(titleSource: string, previousTitle?: string): Promise<string> {
    const messages = [
      {
        role: "system",
        content: sessionTitleSystemPrompt,
      },
      {
        role: "user",
        content: previousTitle
          ? `Rewrite the title because it violated the length or quality rules: ${JSON.stringify(previousTitle)}\n\nSource:\n${titleSource}`
          : titleSource,
      },
    ]
    const response = await fetch(`${llmBaseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.options.authToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: sessionTitleModelID,
        temperature: 0.1,
        max_tokens: 80,
        messages,
      }),
      signal: AbortSignal.timeout(12_000),
    })
    if (!response.ok) {
      throw new Error(`session title request failed: ${response.status} ${response.statusText}`)
    }
    const payload = (await response.json()) as ChatCompletionResponse
    return payload.choices?.[0]?.message?.content ?? ""
  }

  public async getMessages(sessionId: string): Promise<ChatMessage[]> {
    if (!this.started) {
      return []
    }
    const result = await this.client.session.messages({ sessionID: sessionId })
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
    if (!this.started) {
      return []
    }
    const result = await this.client.v2.session.question.list({ sessionID: sessionId })
    const raw = Array.isArray(result.data) ? result.data : []
    return raw
      .map(normalizeQuestionRequest)
      .filter((request): request is ChatQuestionRequest => Boolean(request))
      .filter((request) => request.sessionId === sessionId)
  }

  public async answerQuestion(sessionId: string, requestId: string, answers: string[][]): Promise<void> {
    await this.client.v2.session.question.reply({
      sessionID: sessionId,
      requestID: requestId,
      questionV2Reply: { answers },
    })
  }

  public async rejectQuestion(sessionId: string, requestId: string): Promise<void> {
    await this.client.v2.session.question.reject({ sessionID: sessionId, requestID: requestId })
  }

  public async getPendingPermissions(sessionId: string): Promise<ChatPermissionRequest[]> {
    if (!this.started) {
      return []
    }
    const result = await this.client.permission.list()
    const raw = Array.isArray(result.data) ? result.data : []
    return raw
      .map(normalizePermissionRequest)
      .filter((request): request is ChatPermissionRequest => Boolean(request))
      .filter((request) => request.sessionId === sessionId)
  }

  public async answerPermission(_sessionId: string, requestId: string, reply: ChatPermissionReply): Promise<void> {
    await this.client.permission.reply({ requestID: requestId, reply })
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
      await this.buildAuthorizedSystem(options.organizationName, options.signal),
      options.system,
      buildArtifactSystem(options.artifactDir),
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
      const body: NonNullable<SessionPromptAsyncData["body"]> = {
        agent: normalizeWantaAgentMode(options.mode),
        model: this.resolveModel(options.model),
        ...(tail ? { system: tail } : {}),
        ...(variant ? { variant } : {}),
        parts: buildPromptParts(text, options.attachments),
      }
      const result = await this.client.session.promptAsync(
        { sessionID: sessionId, ...body },
        { signal: options.signal },
      )
      if (options.signal?.aborted) {
        return
      }
      if (result.error) {
        throw new Error(`session.promptAsync failed: ${JSON.stringify(result.error)}`)
      }
    } finally {
      options.signal?.removeEventListener("abort", abortPrompt)
    }
  }

  /** R4：构建注入系统提示末尾的已授权 Link 可用性提示（无已授权则 undefined）。 */
  public async buildAuthorizedSystem(organizationName?: string, signal?: AbortSignal): Promise<string | undefined> {
    const services = await this.listAuthorizedServices(organizationName, signal)
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

  /** 直查 connector /v1/apps，返回已授权（active）service 名清单（R4 动态系统提示用）。 */
  public async listAuthorizedServices(organizationName?: string, signal?: AbortSignal): Promise<string[]> {
    if (!this.started) {
      return []
    }
    const normalizedOrganizationName = normalizeOrganizationName(organizationName)
    const requestSignal = signalWithTimeout(signal, 15_000)
    try {
      const response = await fetch(`${connectorBaseUrl}/v1/apps`, {
        headers: {
          Authorization: `Bearer ${this.options.authToken}`,
          ...(normalizedOrganizationName ? { "x-oo-organization-name": normalizedOrganizationName } : {}),
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
    await this.client.session.abort({ sessionID: sessionId })
  }

  public async createArtifactDir(sessionId: string): Promise<string> {
    return this.createTurnDir("artifacts", sessionId)
  }

  public async createProcessDir(sessionId: string): Promise<string> {
    return this.createTurnDir("process", sessionId)
  }

  private async createTurnDir(kind: "artifacts" | "process", sessionId: string): Promise<string> {
    const root = path.join(this.options.rootDir, kind)
    const dir = path.join(root, sanitizeArtifactPathSegment(sessionId), `${Date.now()}-${randomUUID()}`)
    const resolvedRoot = path.resolve(root)
    const resolvedDir = path.resolve(dir)
    if (!resolvedDir.startsWith(`${resolvedRoot}${path.sep}`)) {
      throw new Error("Invalid turn directory segment.")
    }
    await mkdir(resolvedDir, { recursive: true })
    return resolvedDir
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
    if (prompted.error) {
      throw new Error(`session.prompt failed: ${JSON.stringify(prompted.error)}`)
    }
    const messages = (await this.client.session.messages({ sessionID: id })).data
    return { sessionId: id, messages }
  }

  private async writeOrganizationScope(organizationName: string | undefined): Promise<void> {
    if (!this.organizationScopePath) {
      return
    }
    await mkdir(path.dirname(this.organizationScopePath), { recursive: true })
    await writeFile(
      this.organizationScopePath,
      JSON.stringify({
        organizationName: organizationName ?? "",
        sessionOrganizations: Object.fromEntries(this.sessionOrganizationNames),
      }),
      "utf8",
    )
  }

  private async writeOrganizationState(organizationName: string | undefined): Promise<void> {
    const previousOrganizationName = this.organizationName
    await this.writeOoIdentity(organizationName)
    try {
      await this.writeOrganizationScope(organizationName)
    } catch (error) {
      try {
        await this.writeOoIdentity(previousOrganizationName)
      } catch (rollbackError) {
        throw new AggregateError([error, rollbackError], "Failed to persist and rollback agent organization state.")
      }
      throw error
    }
  }

  private async writeOoIdentity(organizationName: string | undefined): Promise<void> {
    await writeOoIdentitySettings(path.join(this.options.rootDir, "oo-store", "config"), organizationName)
  }

  public dispose(): void {
    this.disposed = true
    this.eventLoopStopped = true
    this.eventStreamAbort?.abort()
    this.eventStreamAbort = null
    this.eventSubscriber = null
    this.started = false
    this.sidecar?.dispose()
    this.sidecar = null
  }

  private resolveModel(choice: ModelChoice | undefined): { providerID: string; modelID: string } {
    if (!choice || choice.kind === "builtin") {
      const modelID = choice && isBuiltinModelId(choice.id) ? choice.id : DEFAULT_BUILTIN_MODEL_ID
      return resolveBuiltinModel(modelID).runtime
    }
    const model = this.options.customModels?.find((item) => item.id === choice.id)
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
    if (choice?.kind === "custom") {
      const model = this.options.customModels?.find((item) => item.id === choice.id)
      return model?.reasoningVariants?.includes(variant) ? variant : undefined
    }
    const modelID = choice && isBuiltinModelId(choice.id) ? choice.id : DEFAULT_BUILTIN_MODEL_ID
    const model = resolveBuiltinModel(modelID)
    return model.capabilities.reasoningVariants?.includes(variant) ? variant : undefined
  }
}

function buildPromptParts(
  text: string,
  attachments: ChatAttachment[] | undefined,
): Array<TextPartInput | FilePartInput> {
  const parts: Array<TextPartInput | FilePartInput> = []
  for (const attachment of attachments ?? []) {
    const inputPath = attachment.agentPath ?? attachment.path
    const inputName = attachment.agentName ?? attachment.name
    const inputMime = attachment.agentMime ?? attachment.mime
    parts.push({
      type: "file",
      mime: inputMime || "application/octet-stream",
      filename: inputName,
      url: pathToFileUrl(inputPath),
      source: {
        type: "file",
        path: inputPath,
        text: { value: inputName, start: 0, end: inputName.length },
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

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms)
    timer.unref?.()
  })
}

function buildArtifactSystem(artifactDir: string | undefined): string | undefined {
  if (!artifactDir) {
    return undefined
  }
  return [
    "Artifact output contract for this turn:",
    `- Use this exact directory for files you create, convert, export, download, or modify as user-facing deliverables: ${artifactDir}`,
    "- Do not create files just because this artifact directory is provided.",
    "- For edits to an existing local project, modify the requested project files in place; use the artifact directory only for exported deliverables, generated assets, converted files, reports, or packaged outputs.",
    "- Treat that directory as one user-facing artifact pack. Create a machine-readable manifest named .wanta-artifact.json in the artifact directory when you create any deliverable files.",
    "- The manifest must be valid JSON with: version: 1, title, kind, display, optional summary, items, and optional supporting. Choose kind from image_set, document, spreadsheet, presentation, web_page, code_project, archive, mixed. Choose display from gallery, document, table, project, file_list, single.",
    "- Manifest item paths must be relative paths inside the artifact directory. Mark each main user-facing deliverable with role primary. Use summary only for a separate short summary file, never for the main report itself. Do not mark temporary scripts, caches, raw connector JSON, or intermediate files as primary.",
    "- Treat HTML reports, images, PDFs, charts, spreadsheets, presentations, archives, and documents as user-facing deliverables. For a single HTML report, use kind web_page or document, display single or document, and include the HTML file as a primary item.",
    "- For image sets, put the primary images in display order, use stable padded names such as 001.jpg and 002.jpg, set kind to image_set, set display to gallery, and include only user-facing images as primary items.",
    "- When the final deliverable is one to four image files and inline viewing helps the user, include Markdown image references in the final response using their absolute local paths, for example ![short title](</absolute/path/image.png>).",
    "- When there are many images, such as crawled or downloaded image sets, do not inline every image in the final response. Summarize the set and rely on the artifact pack for browsing.",
    "- Do not reuse output folders from earlier turns or other chats.",
    "- Do not write deliverables to Desktop, Downloads, the OpenCode workspace, or prior output directories unless the user explicitly requested that exact destination.",
    "- When you finish, summarize the deliverable contents and report generated file paths in prose or inline code, not fenced code blocks; fenced blocks are only for code or multi-line text.",
    "- Do not open generated files with system commands unless the user explicitly asks you to open them externally; the app is responsible for surfacing artifacts in the UI.",
  ].join("\n")
}

function buildProcessSystem(processDir: string | undefined): string | undefined {
  if (!processDir) {
    return undefined
  }
  return [
    "Intermediate process file contract for this turn:",
    `- Use this exact directory for temporary scripts, raw service responses, debug logs, scratch data, and other implementation files that help you complete the task but are not the user-facing deliverable: ${processDir}`,
    "- Do not put final deliverables in this process directory.",
    "- Do not put process files in the artifact manifest unless the user explicitly asked for source code or scripts as the deliverable.",
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

function buildTitleSource(input: BuildSessionTitleInput): string {
  const parts = [input.text, ...(input.attachmentNames ?? []).map((name) => `Attachment: ${name}`)]
    .map((part) => part.trim())
    .filter(Boolean)
  return parts.join("\n").slice(0, 1600)
}

function pathToFileUrl(filePath: string): string {
  return pathToFileURL(path.resolve(filePath)).toString()
}

function sanitizeArtifactPathSegment(value: string): string {
  const cleaned = value.replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 120)
  return cleaned || "session"
}
