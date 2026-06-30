import type { ChatAttachment, ChatMessage, ReasoningLevel } from "../chat/common.ts"
import type { ModelChoice } from "../models/common.ts"
import type { PersistedCustomModel } from "../models/store.ts"
import type { SessionInfo } from "../session/common.ts"
import type { BuildSessionTitleInput } from "../session/title.ts"
import type { FilePartInput, SessionPromptAsyncData, TextPartInput } from "@opencode-ai/sdk"
import type { OpencodeClient } from "@opencode-ai/sdk"

import { randomBytes, randomUUID } from "node:crypto"
import { mkdir, writeFile } from "node:fs/promises"
import path from "node:path"
import { pathToFileURL } from "node:url"
import { branding } from "../branding.ts"
import { connectorBaseUrl, llmBaseUrl } from "../domain.ts"
import { DEFAULT_BUILTIN_MODEL_ID, isBuiltinModelId, resolveBuiltinModel } from "../models/builtin.ts"
import { buildFallbackSessionTitle, sanitizeGeneratedSessionTitle } from "../session/title.ts"
import { buildOpencodeConfig, customProviderId, WANTA_AGENT_NAME, WANTA_MODEL_ID, WANTA_PROVIDER_ID } from "./config.ts"
import { normalizeMessage } from "./event-translator.ts"
import { buildOoEnv } from "./oo.ts"
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

export interface PromptStreamingOptions {
  system?: string
  attachments?: ChatAttachment[]
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
  private started = false
  private eventLoopStopped = false
  private organizationName: string | undefined
  private organizationScopePath: string | undefined
  private organizationUpdateChain: Promise<void> = Promise.resolve()

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
    this.started = true
  }

  /** 订阅 OpenCode 全局 SSE 事件流。回调收到原始 OpenCode 事件 {type, properties}。返回停止函数。 */
  public subscribe(onEvent: (event: { type: string; properties?: Record<string, unknown> }) => void): () => void {
    this.eventLoopStopped = false
    void this.runEventLoop(onEvent)
    return () => {
      this.eventLoopStopped = true
    }
  }

  private async runEventLoop(
    onEvent: (event: { type: string; properties?: Record<string, unknown> }) => void,
  ): Promise<void> {
    try {
      const subscription = await this.client.event.subscribe()
      const stream = (subscription as { stream: AsyncIterable<{ type: string; properties?: Record<string, unknown> }> })
        .stream
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
    const result = await this.client.session.list()
    const sessions = (result.data ?? []) as RawSession[]
    return sessions
      .filter(isUserVisibleSession)
      .map(toSessionInfo)
      .sort((a, b) => b.updatedAt - a.updatedAt)
  }

  public async createSession(title?: string): Promise<SessionInfo> {
    const result = await this.client.session.create({ body: title ? { title } : {} })
    if (result.error || !result.data) {
      throw new Error(`session.create failed: ${JSON.stringify(result.error ?? "no data")}`)
    }
    return toSessionInfo(result.data as RawSession)
  }

  public async renameSession(id: string, title: string): Promise<void> {
    await this.client.session.update({ path: { id }, body: { title } })
  }

  public async deleteSession(id: string): Promise<void> {
    await this.client.session.delete({ path: { id } })
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
    const result = await this.client.session.messages({ path: { id: sessionId } })
    const raw = (result.data ?? []) as Array<{ info?: unknown; parts?: unknown }>
    const messages: ChatMessage[] = []
    for (const item of raw) {
      const normalized = normalizeMessage(item)
      if (normalized) {
        messages.push(normalized)
      }
    }
    return messages
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
      await this.buildAuthorizedSystem(options.signal),
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
      const variant = opencodeReasoningVariant(options.reasoningLevel)
      const body: NonNullable<SessionPromptAsyncData["body"]> & { variant?: string } = {
        agent: WANTA_AGENT_NAME,
        model: this.resolveModel(options.model),
        ...(tail ? { system: tail } : {}),
        ...(variant ? { variant } : {}),
        parts: buildPromptParts(text, options.attachments),
      }
      const result = await this.client.session.promptAsync({
        path: { id: sessionId },
        signal: options.signal,
        body,
      })
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
    await this.client.session.abort({ path: { id: sessionId } })
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
      path: { id },
      body: {
        agent: WANTA_AGENT_NAME,
        model: { providerID: WANTA_PROVIDER_ID, modelID: WANTA_MODEL_ID },
        ...(system ? { system } : {}),
        parts: [{ type: "text", text }],
      },
    })
    if (prompted.error) {
      throw new Error(`session.prompt failed: ${JSON.stringify(prompted.error)}`)
    }
    const messages = (await this.client.session.messages({ path: { id } })).data
    return { sessionId: id, messages }
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
}

function opencodeReasoningVariant(level: ReasoningLevel | undefined): string | undefined {
  return level && level !== "default" ? level : undefined
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
