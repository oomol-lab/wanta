import type { ChatAttachment, ChatMessage } from "../chat/common.ts"
import type { ModelChoice } from "../models/common.ts"
import type { PersistedCustomModel } from "../models/store.ts"
import type { SessionInfo } from "../session/common.ts"
import type { BuildSessionTitleInput } from "../session/title.ts"
import type { FilePartInput, TextPartInput } from "@opencode-ai/sdk"
import type { OpencodeClient } from "@opencode-ai/sdk"

import { randomBytes, randomUUID } from "node:crypto"
import { mkdir } from "node:fs/promises"
import path from "node:path"
import { pathToFileURL } from "node:url"
import { connectorBaseUrl, llmBaseUrl } from "../domain.ts"
import { DEFAULT_BUILTIN_MODEL_ID, isBuiltinModelId, resolveBuiltinModel } from "../models/builtin.ts"
import {
  buildFallbackSessionTitle,
  isGeneratedSessionTitleAcceptable,
  sanitizeGeneratedSessionTitle,
} from "../session/title.ts"
import { buildOpencodeConfig, customProviderId, LUMO_AGENT_NAME, LUMO_MODEL_ID, LUMO_PROVIDER_ID } from "./config.ts"
import { normalizeMessage } from "./event-translator.ts"
import { buildOoEnv } from "./oo.ts"
import { OpencodeSidecar } from "./sidecar.ts"
import { ensureAgentWorkspace } from "./workspace.ts"

export interface AgentManagerOptions {
  apiKey: string
  /** opencode 二进制绝对路径。 */
  opencodeBinPath: string
  /** oo 二进制绝对路径。 */
  ooBinPath: string
  /** App 私有根目录（userData 下）：workspace / oo-store / isolation 都在其下。 */
  rootDir: string
  /** 自定义 OpenAI-compatible 模型配置。apiKey 只进入 sidecar env config，不落到 OpenCode 文件。 */
  customModels?: PersistedCustomModel[]
  /** 关闭 sidecar Basic Auth（默认开，随机口令）。 */
  disableServerAuth?: boolean
}

export interface SendMessageResult {
  sessionId: string
  messages: unknown
}

export interface PromptStreamingOptions {
  system?: string
  attachments?: ChatAttachment[]
  model?: ModelChoice
  artifactDir?: string
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
  "Generate a short chat title as a task label.",
  'Return JSON only, exactly like {"title":"Gmail 三日报告"}.',
  "Keep the user's language when possible.",
  "Length rules:",
  "- Chinese/Japanese/Korean or mixed CJK+English: at most 8 CJK characters and at most 2 Latin words.",
  "- English or other Latin-script languages: 2-4 words.",
  "- Other languages: 2-5 words or at most 32 characters.",
  "Quality rules:",
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

  public constructor(options: AgentManagerOptions) {
    this.options = options
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

  public async start(): Promise<void> {
    const { apiKey, opencodeBinPath, ooBinPath, rootDir, disableServerAuth, customModels } = this.options
    const workspaceDir = path.join(rootDir, "workspace")
    const isolationDir = path.join(rootDir, "isolation")
    const storeDir = path.join(rootDir, "oo-store")

    await ensureAgentWorkspace(workspaceDir)

    const config = buildOpencodeConfig({ apiKey, customModels })
    const ooEnv = buildOoEnv({ apiKey, storeDir, ooBinPath })
    const ooDir = path.dirname(ooBinPath)
    const env: Record<string, string> = {
      ...ooEnv,
      // LUMO_OO_BIN 已给绝对路径；同时前置注入 PATH 作兜底。
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
        console.error("[lumo] opencode event stream ended:", error)
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
      const first = await this.requestSessionTitle(titleSource)
      const firstTitle = sanitizeGeneratedSessionTitle(first, input)
      if (!firstTitle.usedFallback && isGeneratedSessionTitleAcceptable(firstTitle.title)) {
        return { generated: true, title: firstTitle.title }
      }

      const retry = await this.requestSessionTitle(titleSource, firstTitle.title)
      const retryTitle = sanitizeGeneratedSessionTitle(retry, input)
      return !retryTitle.usedFallback && isGeneratedSessionTitleAcceptable(retryTitle.title)
        ? { generated: true, title: retryTitle.title }
        : { generated: false, title: fallback }
    } catch (error) {
      console.warn("[lumo] failed to generate session title, using fallback:", error)
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
        Authorization: `Bearer ${this.options.apiKey}`,
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
    )
    if (options.signal?.aborted) {
      return
    }
    const abortPrompt = (): void => {
      void this.abort(sessionId).catch((error) => {
        console.warn("[lumo] abort prompt after signal failed:", error)
      })
    }
    options.signal?.addEventListener("abort", abortPrompt, { once: true })
    try {
      if (options.signal?.aborted) {
        return
      }
      const result = await this.client.session.promptAsync({
        path: { id: sessionId },
        signal: options.signal,
        body: {
          agent: LUMO_AGENT_NAME,
          model: this.resolveModel(options.model),
          ...(tail ? { system: tail } : {}),
          parts: buildPromptParts(text, options.attachments, trustedAgentAttachmentRoot(this.options.rootDir)),
        },
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
      `Some Link providers are already authorized for this account. ` +
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
        headers: { Authorization: `Bearer ${this.options.apiKey}` },
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
    const artifactsRoot = path.join(this.options.rootDir, "artifacts")
    const dir = path.join(artifactsRoot, sanitizeArtifactPathSegment(sessionId), `${Date.now()}-${randomUUID()}`)
    const resolvedRoot = path.resolve(artifactsRoot)
    const resolvedDir = path.resolve(dir)
    if (!resolvedDir.startsWith(`${resolvedRoot}${path.sep}`)) {
      throw new Error("Invalid artifact directory segment.")
    }
    await mkdir(resolvedDir, { recursive: true })
    return resolvedDir
  }

  /** 阻塞发送（headless 验证用）：发送并返回该会话全部消息。 */
  public async sendMessage(text: string, sessionId?: string, system?: string): Promise<SendMessageResult> {
    let id = sessionId
    if (!id) {
      id = (await this.createSession("Lumo")).id
    }
    const prompted = await this.client.session.prompt({
      path: { id },
      body: {
        agent: LUMO_AGENT_NAME,
        model: { providerID: LUMO_PROVIDER_ID, modelID: LUMO_MODEL_ID },
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

export function trustedAgentAttachmentRoot(agentRootDir: string): string {
  return path.join(path.dirname(agentRootDir), "attachments", "clipboard")
}

function isPathInside(rootDir: string, candidate: string): boolean {
  if (!path.isAbsolute(candidate)) {
    return false
  }
  const root = path.resolve(rootDir)
  const target = path.resolve(candidate)
  const relative = path.relative(root, target)
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative))
}

function trustedAgentInput(
  attachment: ChatAttachment,
  agentAttachmentRoot: string | undefined,
): { mime: string; name: string; path: string } | undefined {
  if (!attachment.agentPath || !agentAttachmentRoot || !isPathInside(agentAttachmentRoot, attachment.agentPath)) {
    return undefined
  }
  return {
    mime: attachment.agentMime ?? attachment.mime,
    name: attachment.agentName ?? attachment.name,
    path: attachment.agentPath,
  }
}

export function buildPromptParts(
  text: string,
  attachments: ChatAttachment[] | undefined,
  agentAttachmentRoot?: string,
): Array<TextPartInput | FilePartInput> {
  const parts: Array<TextPartInput | FilePartInput> = []
  for (const attachment of attachments ?? []) {
    const agentInput = trustedAgentInput(attachment, agentAttachmentRoot)
    const inputPath = agentInput?.path ?? attachment.path
    const inputName = agentInput?.name ?? attachment.name
    const inputMime = agentInput?.mime ?? attachment.mime
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
    "- Treat that directory as one user-facing artifact pack. Create a machine-readable manifest named .lumo-artifact.json in the artifact directory when you create any deliverable files.",
    "- The manifest must be valid JSON with: version: 1, title, kind, display, optional summary, items, and optional supporting. Choose kind from image_set, document, spreadsheet, presentation, web_page, code_project, archive, mixed. Choose display from gallery, document, table, project, file_list, single.",
    "- Manifest item paths must be relative paths inside the artifact directory. Mark each item with role primary, supporting, summary, or metadata. Do not mark temporary scripts, caches, raw connector JSON, or intermediate files as primary.",
    "- For image sets, put the primary images in display order, use stable padded names such as 001.jpg and 002.jpg, set kind to image_set, set display to gallery, and include only user-facing images as primary items.",
    "- Do not reuse output folders from earlier turns or other chats.",
    "- Do not write deliverables to Desktop, Downloads, the OpenCode workspace, or prior output directories unless the user explicitly requested that exact destination.",
    "- When you finish, report generated file paths in prose or inline code, not fenced code blocks; fenced blocks are only for code or multi-line text.",
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
