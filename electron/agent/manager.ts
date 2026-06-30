import type { AgentMode, ChatAttachment, ChatMessage, ReasoningLevel } from "../chat/common.ts"
import type { ModelChoice } from "../models/common.ts"
import type { PersistedCustomModel } from "../models/store.ts"
import type { SessionInfo } from "../session/common.ts"
import type { BuildSessionTitleInput } from "../session/title.ts"
import type { OpencodeClient, Prompt, PromptFileAttachment, SessionMessage, V2Event } from "@opencode-ai/sdk/v2/client"

import { randomBytes, randomUUID } from "node:crypto"
import { mkdir, writeFile } from "node:fs/promises"
import path from "node:path"
import { pathToFileURL } from "node:url"
import { branding } from "../branding.ts"
import { connectorBaseUrl, llmBaseUrl } from "../domain.ts"
import { DEFAULT_BUILTIN_MODEL_ID, isBuiltinModelId, resolveBuiltinModel } from "../models/builtin.ts"
import { buildFallbackSessionTitle, sanitizeGeneratedSessionTitle } from "../session/title.ts"
import { buildOpencodeConfig, customProviderId, WANTA_MODEL_ID, WANTA_PROVIDER_ID } from "./config.ts"
import { normalizeMessage, normalizeSyncMessage } from "./event-translator.ts"
import { normalizeWantaAgentMode } from "./mode.ts"
import { buildOoEnv } from "./oo.ts"
import { appendWantaPromptContext } from "./prompt-context.ts"
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
    await writeScope(currentName).catch(() => undefined)
    throw error
  }
}

export interface SendMessageResult {
  sessionId: string
  messages: unknown
}

export interface PromptStreamingResult {
  messageId?: string
}

export interface PromptStreamingOptions {
  system?: string
  attachments?: ChatAttachment[]
  mode?: AgentMode
  model?: ModelChoice
  reasoningLevel?: ReasoningLevel
  artifactDir?: string
  processDir?: string
  signal?: AbortSignal
}

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
const sessionListPageSize = 200
const sessionMessagesPageSize = 200
const sessionMessagesMaxPages = 20
const v2PromptExecutionUnavailableMessage =
  "OpenCode V2 prompt execution is unavailable in the pinned sidecar. Wanta is configured for V2-only prompt execution and will not fall back to legacy prompt_async."

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

function normalizeSessionMessages(raw: SessionMessage[]): ChatMessage[] {
  const messages: ChatMessage[] = []
  for (const item of raw) {
    const normalized = normalizeMessage(item)
    if (normalized) {
      messages.push(normalized)
    }
  }
  return messages
}

interface SyncHistoryEvent {
  aggregateID?: string
  aggregate_id?: string
  data?: {
    info?: unknown
    messageID?: string
    part?: unknown
    partID?: string
    sessionID?: string
  }
  seq?: number
  type?: string
}

interface SyncMessageDraft {
  info?: unknown
  parts: Map<string, unknown>
}

function syncEventSessionId(event: SyncHistoryEvent): string | undefined {
  const data = event.data
  if (typeof data?.sessionID === "string") {
    return data.sessionID
  }
  if (
    data?.info &&
    typeof data.info === "object" &&
    "sessionID" in data.info &&
    typeof data.info.sessionID === "string"
  ) {
    return data.info.sessionID
  }
  if (
    data?.part &&
    typeof data.part === "object" &&
    "sessionID" in data.part &&
    typeof data.part.sessionID === "string"
  ) {
    return data.part.sessionID
  }
  if (event.aggregate_id?.startsWith("ses_")) {
    return event.aggregate_id
  }
  if (event.aggregateID?.startsWith("ses_")) {
    return event.aggregateID
  }
  return undefined
}

function syncMessageIdFromInfo(info: unknown): string | undefined {
  return info && typeof info === "object" && "id" in info && typeof info.id === "string" ? info.id : undefined
}

function syncPartIds(part: unknown): { messageId?: string; partId?: string } {
  if (!part || typeof part !== "object") {
    return {}
  }
  const record = part as { id?: unknown; messageID?: unknown }
  return {
    messageId: typeof record.messageID === "string" ? record.messageID : undefined,
    partId: typeof record.id === "string" ? record.id : undefined,
  }
}

function normalizeSyncHistoryMessages(sessionId: string, events: SyncHistoryEvent[]): ChatMessage[] {
  const drafts = new Map<string, SyncMessageDraft>()
  const sorted = [...events]
    .filter((event) => syncEventSessionId(event) === sessionId)
    .sort((a, b) => (a.seq ?? 0) - (b.seq ?? 0))
  for (const event of sorted) {
    const data = event.data
    if (!data) {
      continue
    }
    if (event.type === "message.updated.1") {
      const messageId = syncMessageIdFromInfo(data.info)
      if (!messageId) {
        continue
      }
      const draft = drafts.get(messageId) ?? { parts: new Map<string, unknown>() }
      draft.info = data.info
      drafts.set(messageId, draft)
    } else if (event.type === "message.removed.1") {
      if (typeof data.messageID === "string") {
        drafts.delete(data.messageID)
      }
    } else if (event.type === "message.part.updated.1") {
      const { messageId, partId } = syncPartIds(data.part)
      if (!messageId || !partId) {
        continue
      }
      const draft = drafts.get(messageId) ?? { parts: new Map<string, unknown>() }
      draft.parts.set(partId, data.part)
      drafts.set(messageId, draft)
    } else if (event.type === "message.part.removed.1") {
      if (typeof data.messageID === "string" && typeof data.partID === "string") {
        drafts.get(data.messageID)?.parts.delete(data.partID)
      }
    }
  }
  return Array.from(drafts.values())
    .map((draft) => normalizeSyncMessage({ info: draft.info, parts: Array.from(draft.parts.values()) }))
    .filter((message): message is ChatMessage => Boolean(message && message.parts.length > 0))
    .sort((a, b) => a.createdAt - b.createdAt)
}

function isV2PromptExecutionUnavailable(error: unknown): boolean {
  if (!error || typeof error !== "object") {
    return false
  }
  const record = error as { _tag?: unknown; service?: unknown }
  return record._tag === "ServiceUnavailableError" && record.service === "session.wait"
}

/** Agent 内核管理器：编排 OpenCode sidecar + 非编码 agent + 自定义连接器工具。electron-free，便于 headless 测试。 */
export class AgentManager {
  private options: AgentManagerOptions
  private sidecar: OpencodeSidecar | null = null
  private started = false
  private eventLoopStopped = false
  private organizationName: string | undefined
  private organizationScopePath: string | undefined
  private organizationUpdateChain: Promise<void> = Promise.resolve()
  private workspaceDir: string | undefined

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
    const update = async (): Promise<void> => {
      if (nextOrganizationName === this.organizationName) {
        return
      }
      const previousOrganizationName = this.organizationName
      await persistOrganizationScopeUpdate({
        currentName: previousOrganizationName,
        nextName: nextOrganizationName,
        writeScope: (name) => this.writeOrganizationScope(name),
      })
      this.organizationName = nextOrganizationName
    }
    const task = this.organizationUpdateChain.then(update, update)
    this.organizationUpdateChain = task.catch(() => undefined)
    await task
  }

  public async start(): Promise<void> {
    const { authToken, opencodeBinPath, ooBinPath, bundledSkillsDir, rootDir, disableServerAuth, customModels } =
      this.options
    const workspaceDir = path.join(rootDir, "workspace")
    const isolationDir = path.join(rootDir, "isolation")
    const storeDir = path.join(rootDir, "oo-store")
    const organizationScopePath = path.join(rootDir, "organization-scope.json")

    await ensureAgentWorkspace(workspaceDir, bundledSkillsDir)
    this.organizationScopePath = organizationScopePath
    await this.writeOrganizationScope()

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
    })
    // 仅在 sidecar 完全就绪后才赋值并标记 ready，避免 client 在启动期被访问。
    await sidecar.start()
    this.sidecar = sidecar
    this.workspaceDir = workspaceDir
    this.started = true
  }

  /** 订阅 OpenCode V2 原生 SSE 事件流。回调收到原始 V2 event。返回停止函数。 */
  public subscribe(onEvent: (event: V2Event) => void): () => void {
    this.eventLoopStopped = false
    void this.runEventLoop(onEvent)
    return () => {
      this.eventLoopStopped = true
    }
  }

  private async runEventLoop(onEvent: (event: V2Event) => void): Promise<void> {
    try {
      const subscription = await this.client.v2.event.subscribe()
      const stream = (subscription as { stream: AsyncIterable<V2Event> }).stream
      for await (const event of stream) {
        if (this.eventLoopStopped) {
          break
        }
        onEvent(event)
      }
    } catch (error) {
      if (!this.eventLoopStopped) {
        console.error("[wanta] opencode event stream ended:", error)
      }
    }
  }

  public async listSessions(): Promise<SessionInfo[]> {
    if (!this.started) {
      return []
    }
    const sessions: RawSession[] = []
    let cursor: string | undefined
    while (true) {
      const result = await this.client.v2.session.list(
        cursor
          ? { directory: this.workspaceDir, cursor, limit: sessionListPageSize }
          : { directory: this.workspaceDir, order: "desc", limit: sessionListPageSize },
      )
      if (result.error) {
        throw new Error(`v2.session.list failed: ${JSON.stringify(result.error)}`)
      }
      sessions.push(...((result.data?.data ?? []) as RawSession[]))
      cursor = result.data?.cursor?.next
      if (!cursor) {
        break
      }
    }
    return sessions
      .filter(isUserVisibleSession)
      .map(toSessionInfo)
      .sort((a, b) => b.updatedAt - a.updatedAt)
  }

  public async createSession(_title?: string): Promise<SessionInfo> {
    const result = await this.client.v2.session.create({
      agent: normalizeWantaAgentMode(undefined),
      location: { directory: this.workspaceDir ?? this.options.rootDir },
      model: { id: WANTA_MODEL_ID, providerID: WANTA_PROVIDER_ID },
    })
    if (result.error || !result.data?.data) {
      throw new Error(`v2.session.create failed: ${JSON.stringify(result.error ?? "no data")}`)
    }
    return toSessionInfo(result.data.data as RawSession)
  }

  public async renameSession(id: string, title: string): Promise<void> {
    void id
    void title
  }

  public async deleteSession(id: string): Promise<void> {
    void id
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
    const raw: SessionMessage[] = []
    let cursor: string | undefined
    for (let page = 0; page < sessionMessagesMaxPages; page += 1) {
      const result = await this.client.v2.session.messages(
        cursor
          ? { sessionID: sessionId, cursor, limit: sessionMessagesPageSize }
          : { sessionID: sessionId, order: "asc", limit: sessionMessagesPageSize },
      )
      if (result.error) {
        throw new Error(`v2.session.messages failed: ${JSON.stringify(result.error)}`)
      }
      raw.push(...((result.data?.data ?? []) as SessionMessage[]))
      cursor = result.data?.cursor?.next
      if (!cursor) {
        break
      }
    }
    const messages = normalizeSessionMessages(raw)
    if (messages.length > 0) {
      return messages
    }
    return this.getSyncHistoryMessages(sessionId)
  }

  private async getSyncHistoryMessages(sessionId: string): Promise<ChatMessage[]> {
    const result = await this.client.sync.history.list({
      ...(this.workspaceDir ? { directory: this.workspaceDir } : {}),
      // SDK 会剔除空对象 body；放一个不存在的 aggregate key 以请求完整 V2 sync history。
      body: { _: 0 },
    })
    if (result.error) {
      throw new Error(`sync.history.list failed: ${JSON.stringify(result.error)}`)
    }
    return normalizeSyncHistoryMessages(sessionId, (result.data ?? []) as SyncHistoryEvent[])
  }

  /**
   * 非阻塞发送：立即返回，内容经事件流推送。
   * R4：只走 OpenCode V2 stable session API；当前钉死 sidecar 若未接入 V2 execution
   * service，则在 admission 前失败，避免 UI 卡在“发送中”。
   */
  public async promptStreaming(
    sessionId: string,
    text: string,
    options: PromptStreamingOptions = {},
  ): Promise<PromptStreamingResult> {
    if (options.signal?.aborted) {
      return {}
    }
    await this.assertV2PromptExecutionAvailable(sessionId, options.signal)
    if (options.signal?.aborted) {
      return {}
    }
    const tail = mergeSystemPrompts(
      await this.buildAuthorizedSystem(options.signal),
      options.system,
      buildArtifactSystem(options.artifactDir),
      buildProcessSystem(options.processDir),
    )
    if (options.signal?.aborted) {
      return {}
    }
    const variant = this.resolveReasoningVariant(options.model, options.reasoningLevel)
    await this.configureSessionForPrompt(sessionId, options.mode, options.model, variant, options.signal)
    if (options.signal?.aborted) {
      return {}
    }
    const result = await this.client.v2.session.prompt(
      {
        sessionID: sessionId,
        delivery: "queue",
        resume: true,
        prompt: buildPrompt(text, options.attachments, tail),
      },
      { signal: options.signal },
    )
    if (options.signal?.aborted) {
      return {}
    }
    if (result.error) {
      throw new Error(`v2.session.prompt failed: ${JSON.stringify(result.error)}`)
    }
    const admitted = result.data?.data as { id?: unknown } | undefined
    return typeof admitted?.id === "string" ? { messageId: admitted.id } : {}
  }

  /** R4：构建注入系统提示末尾的已授权 Link 可用性提示（无已授权则 undefined）。 */
  public async buildAuthorizedSystem(signal?: AbortSignal): Promise<string | undefined> {
    const services = await this.listAuthorizedServices(signal)
    if (services.length === 0) {
      return undefined
    }
    return (
      `Some Link providers are already authorized for the active workspace. ` +
      `This is availability awareness only: it is not a recommendation to use Link tools and does not indicate that any provider fits the current task. ` +
      `When, and only when, the user's request needs private/account-specific SaaS data or actions, use Link tools to discover the appropriate action; search results include whether a provider is authenticated. ` +
      `Ignore this note for direct answers, local files, commands, concrete URLs, webpage fetching, and general web browsing.`
    )
  }

  /** 直查 connector /v1/apps，返回已授权（active）service 名清单（R4 动态系统提示用）。 */
  public async listAuthorizedServices(signal?: AbortSignal): Promise<string[]> {
    if (!this.started) {
      return []
    }
    const requestSignal = signalWithTimeout(signal, 15_000)
    try {
      const response = await fetch(`${connectorBaseUrl}/v1/apps`, {
        headers: {
          Authorization: `Bearer ${this.options.authToken}`,
          ...(this.organizationName ? { "x-oo-organization-name": this.organizationName } : {}),
        },
        signal: requestSignal.signal,
      })
      if (!response.ok) {
        return []
      }
      const payload = (await response.json()) as { data?: Array<{ service?: string; status?: string }> }
      const apps = payload.data ?? []
      return apps.filter((a) => a.status === "active" && a.service).map((a) => a.service as string)
    } catch {
      return []
    } finally {
      requestSignal.cleanup()
    }
  }

  public async abort(sessionId: string): Promise<void> {
    void sessionId
    // 当前钉死 sidecar 的 OpenCode V2 stable session API 没有 abort endpoint；
    // 停止生成只做本地收尾，等上游提供 V2 中断 API 后再接入。
  }

  public async rejectPermission(sessionId: string, requestId: string, message: string): Promise<void> {
    const result = await this.client.v2.session.permission.reply({
      sessionID: sessionId,
      requestID: requestId,
      reply: "reject",
      message,
    })
    if (result.error) {
      throw new Error(`v2.session.permission.reply failed: ${JSON.stringify(result.error)}`)
    }
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
    await this.assertV2PromptExecutionAvailable(id)
    await this.configureSessionForPrompt(id, undefined, undefined, undefined)
    const prompted = await this.client.v2.session.prompt({
      sessionID: id,
      delivery: "queue",
      resume: true,
      prompt: buildPrompt(text, undefined, system),
    })
    if (prompted.error) {
      throw new Error(`v2.session.prompt failed: ${JSON.stringify(prompted.error)}`)
    }
    const waited = await this.client.v2.session.wait({ sessionID: id })
    if (waited.error) {
      throw new Error(`v2.session.wait failed: ${JSON.stringify(waited.error)}`)
    }
    const messages = await this.getMessages(id)
    return { sessionId: id, messages }
  }

  private async assertV2PromptExecutionAvailable(sessionId: string, signal?: AbortSignal): Promise<void> {
    const waited = await this.client.v2.session.wait({ sessionID: sessionId }, { signal })
    if (signal?.aborted) {
      return
    }
    if (!waited.error) {
      return
    }
    if (isV2PromptExecutionUnavailable(waited.error)) {
      throw new Error(v2PromptExecutionUnavailableMessage)
    }
    throw new Error(`v2.session.wait failed: ${JSON.stringify(waited.error)}`)
  }

  private async writeOrganizationScope(organizationName = this.organizationName): Promise<void> {
    if (!this.organizationScopePath) {
      return
    }
    await mkdir(path.dirname(this.organizationScopePath), { recursive: true })
    await writeFile(this.organizationScopePath, JSON.stringify({ organizationName: organizationName ?? "" }), "utf8")
  }

  public dispose(): void {
    this.eventLoopStopped = true
    this.started = false
    this.sidecar?.dispose()
    this.sidecar = null
    this.workspaceDir = undefined
  }

  private async configureSessionForPrompt(
    sessionId: string,
    mode: AgentMode | undefined,
    choice: ModelChoice | undefined,
    variant: string | undefined,
    signal?: AbortSignal,
  ): Promise<void> {
    const agent = normalizeWantaAgentMode(mode)
    const agentResult = await this.client.v2.session.switchAgent({ sessionID: sessionId, agent }, { signal })
    if (agentResult.error) {
      throw new Error(`v2.session.switchAgent failed: ${JSON.stringify(agentResult.error)}`)
    }
    if (signal?.aborted) {
      return
    }
    const model = this.resolveModel(choice)
    const modelResult = await this.client.v2.session.switchModel(
      {
        sessionID: sessionId,
        model: {
          id: model.modelID,
          providerID: model.providerID,
          ...(variant ? { variant } : {}),
        },
      },
      { signal },
    )
    if (modelResult.error) {
      throw new Error(`v2.session.switchModel failed: ${JSON.stringify(modelResult.error)}`)
    }
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
    if (!variant || (choice && choice.kind === "custom")) {
      return undefined
    }
    const modelID = choice && isBuiltinModelId(choice.id) ? choice.id : DEFAULT_BUILTIN_MODEL_ID
    const model = resolveBuiltinModel(modelID)
    return model.capabilities.reasoningVariants?.includes(variant) ? variant : undefined
  }
}

function buildPrompt(text: string, attachments: ChatAttachment[] | undefined, context: string | undefined): Prompt {
  const files = buildPromptFiles(attachments)
  return {
    text: appendWantaPromptContext(text, context),
    ...(files.length > 0 ? { files } : {}),
  }
}

function buildPromptFiles(attachments: ChatAttachment[] | undefined): PromptFileAttachment[] {
  const files: PromptFileAttachment[] = []
  for (const attachment of attachments ?? []) {
    const inputPath = attachment.agentPath ?? attachment.path
    const inputName = attachment.agentName ?? attachment.name
    const inputMime = attachment.agentMime ?? attachment.mime
    files.push({
      mime: inputMime || "application/octet-stream",
      name: inputName,
      uri: pathToFileUrl(inputPath),
      source: {
        text: inputName,
        start: 0,
        end: inputName.length,
      },
    })
  }
  return files
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
