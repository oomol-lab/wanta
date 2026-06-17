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
import { buildFallbackSessionTitle, sanitizeGeneratedSessionTitle } from "../session/title.ts"
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

  public async generateSessionTitle(input: BuildSessionTitleInput): Promise<string> {
    const fallback = buildFallbackSessionTitle(input)
    const titleSource = buildTitleSource(input)
    if (!titleSource) {
      return fallback
    }

    try {
      const response = await fetch(`${llmBaseUrl}/chat/completions`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.options.apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: LUMO_MODEL_ID,
          temperature: 0.2,
          max_tokens: 40,
          messages: [
            {
              role: "system",
              content:
                "Generate a concise chat title for the user's task. Output only the title. Keep the user's language. Use 3-6 English words or 6-14 Chinese characters when possible. Do not output a URL, punctuation wrapper, markdown, or explanations.",
            },
            {
              role: "user",
              content: titleSource,
            },
          ],
        }),
        signal: AbortSignal.timeout(12_000),
      })
      if (!response.ok) {
        return fallback
      }
      const payload = (await response.json()) as ChatCompletionResponse
      return sanitizeGeneratedSessionTitle(payload.choices?.[0]?.message?.content ?? "", input)
    } catch {
      return fallback
    }
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
   * R4：默认每轮把"已连接 provider 清单"注入系统提示末尾（body.system 经实测追加在 agent.prompt 之后），
   * 作为可用性上下文，而不是使用指令；若任务确实需要这些 provider，可跳过 discovery
   * （但仍需 inspect_action 查 schema 再 call_action）。稳定前缀（人格/工具/契约）留在 agent.prompt 以利缓存。
   */
  public async promptStreaming(sessionId: string, text: string, options: PromptStreamingOptions = {}): Promise<void> {
    const tail = mergeSystemPrompts(
      await this.buildAuthorizedSystem(),
      options.system,
      buildArtifactSystem(options.artifactDir),
    )
    const result = await this.client.session.promptAsync({
      path: { id: sessionId },
      body: {
        agent: LUMO_AGENT_NAME,
        model: this.resolveModel(options.model),
        ...(tail ? { system: tail } : {}),
        parts: buildPromptParts(text, options.attachments),
      },
    })
    if (result.error) {
      throw new Error(`session.promptAsync failed: ${JSON.stringify(result.error)}`)
    }
  }

  /** R4：构建注入系统提示末尾的已连接清单块（无已连接则 undefined）。 */
  public async buildAuthorizedSystem(): Promise<string | undefined> {
    const services = await this.listAuthorizedServices()
    if (services.length === 0) {
      return undefined
    }
    return (
      `Connected Link providers available if relevant to the user's request: ${services.join(", ")}. ` +
      `This list is availability context only, not an instruction to use them. ` +
      `Use a provider only when the task requires that account or service. ` +
      `If you choose one of these providers, you may skip search_actions for provider discovery, but still call inspect_action before call_action so the params match the action's schema.`
    )
  }

  /** 直查 connector /v1/apps，返回已授权（active）service 名清单（R4 动态系统提示用）。 */
  public async listAuthorizedServices(): Promise<string[]> {
    if (!this.started) {
      return []
    }
    try {
      const response = await fetch(`${connectorBaseUrl}/v1/apps`, {
        headers: { Authorization: `Bearer ${this.options.apiKey}` },
        signal: AbortSignal.timeout(15_000),
      })
      if (!response.ok) {
        return []
      }
      const payload = (await response.json()) as { data?: Array<{ service?: string; status?: string }> }
      const apps = payload.data ?? []
      return apps.filter((a) => a.status === "active" && a.service).map((a) => a.service as string)
    } catch {
      return []
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
      return { providerID: LUMO_PROVIDER_ID, modelID: LUMO_MODEL_ID }
    }
    const model = this.options.customModels?.find((item) => item.id === choice.id)
    if (!model) {
      throw new Error("Selected custom model is no longer available.")
    }
    return { providerID: customProviderId(model.id), modelID: model.modelName }
  }
}

function buildPromptParts(
  text: string,
  attachments: ChatAttachment[] | undefined,
): Array<TextPartInput | FilePartInput> {
  const parts: Array<TextPartInput | FilePartInput> = []
  for (const attachment of attachments ?? []) {
    parts.push({
      type: "file",
      mime: attachment.mime || "application/octet-stream",
      filename: attachment.name,
      url: pathToFileUrl(attachment.path),
      source: {
        type: "file",
        path: attachment.path,
        text: { value: attachment.name, start: 0, end: attachment.name.length },
      },
    })
  }
  parts.push({ type: "text", text })
  return parts
}

function buildArtifactSystem(artifactDir: string | undefined): string | undefined {
  if (!artifactDir) {
    return undefined
  }
  return [
    "Artifact output contract for this turn:",
    `- Use this exact directory for files you create, convert, export, download, or modify as user-facing deliverables: ${artifactDir}`,
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
