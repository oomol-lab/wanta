import type { ChatMessage } from "../chat/common.ts"
import type { SessionInfo } from "../session/common.ts"
import type { OpencodeClient } from "@opencode-ai/sdk"

import { randomBytes } from "node:crypto"
import path from "node:path"
import { connectorBaseUrl } from "../domain.ts"
import { buildOpencodeConfig, LUMO_AGENT_NAME, LUMO_MODEL_ID, LUMO_PROVIDER_ID } from "./config.ts"
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
  /** 关闭 sidecar Basic Auth（默认开，随机口令）。 */
  disableServerAuth?: boolean
}

export interface SendMessageResult {
  sessionId: string
  messages: unknown
}

interface RawSession {
  id: string
  title?: string
  time?: { created?: number; updated?: number }
}

function toSessionInfo(session: RawSession): SessionInfo {
  return {
    id: session.id,
    title: session.title ?? "新会话",
    createdAt: session.time?.created ?? 0,
    updatedAt: session.time?.updated ?? session.time?.created ?? 0,
  }
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
    const { apiKey, opencodeBinPath, ooBinPath, rootDir, disableServerAuth } = this.options
    const workspaceDir = path.join(rootDir, "workspace")
    const isolationDir = path.join(rootDir, "isolation")
    const storeDir = path.join(rootDir, "oo-store")

    await ensureAgentWorkspace(workspaceDir)

    const config = buildOpencodeConfig({ apiKey })
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
    return sessions.map(toSessionInfo).sort((a, b) => b.updatedAt - a.updatedAt)
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
   * R4：默认每轮把"已授权 provider 清单"注入系统提示末尾（body.system 经实测追加在 agent.prompt 之后），
   * 让已授权 provider 跳过 discovery（但仍需 inspect_action 查 schema 再 call_action）。稳定前缀（人格/工具/契约）留在 agent.prompt 以利缓存。
   */
  public async promptStreaming(sessionId: string, text: string, system?: string): Promise<void> {
    const tail = system ?? (await this.buildAuthorizedSystem())
    const result = await this.client.session.promptAsync({
      path: { id: sessionId },
      body: {
        agent: LUMO_AGENT_NAME,
        model: { providerID: LUMO_PROVIDER_ID, modelID: LUMO_MODEL_ID },
        ...(tail ? { system: tail } : {}),
        parts: [{ type: "text", text }],
      },
    })
    if (result.error) {
      throw new Error(`session.promptAsync failed: ${JSON.stringify(result.error)}`)
    }
  }

  /** R4：构建注入系统提示末尾的已授权清单块（无已授权则 undefined）。 */
  public async buildAuthorizedSystem(): Promise<string | undefined> {
    const services = await this.listAuthorizedServices()
    if (services.length === 0) {
      return undefined
    }
    return (
      `Authorized providers you can use directly (already connected): ${services.join(", ")}. ` +
      `For these you may skip search_actions, but still call inspect_action before call_action so the params match the action's schema. For any other service, discover with search_actions first.`
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
}
