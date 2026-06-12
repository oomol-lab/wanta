import type { AgentManager } from "../agent/manager.ts"
import type { ChatMessage, ChatService, SendMessageRequest } from "./common.ts"
import type { IConnectionService } from "@oomol/connection"

import { ConnectionService } from "@oomol/connection"
import { translateOpencodeEvent } from "../agent/event-translator.ts"
import { ChatService as ChatServiceName } from "./common.ts"

export class ChatServiceImpl extends ConnectionService<ChatService> implements IConnectionService<ChatService> {
  private agent: AgentManager | null
  private bridged = false

  public constructor(agent: AgentManager | null = null) {
    super(ChatServiceName)
    this.agent = agent
  }

  /** 登录 / 登出时由 main 重新装配 agent（旧 agent 的事件流随其 dispose 终止）。 */
  public setAgent(agent: AgentManager | null): void {
    this.agent = agent
    this.bridged = false
  }

  /** agent 就绪后调用：订阅 OpenCode SSE，转译为 ServerEvents 广播给渲染层。 */
  public startEventBridge(): void {
    if (!this.agent || this.bridged) {
      return
    }
    this.bridged = true
    const emit = this.send.bind(this) as (event: string, data: unknown) => Promise<void>
    this.agent.subscribe((event) => {
      for (const translated of translateOpencodeEvent(event)) {
        void emit(translated.event, translated.data)
      }
    })
  }

  public async isReady(): Promise<boolean> {
    return this.agent?.isReady() ?? false
  }

  public async sendMessage(req: SendMessageRequest): Promise<void> {
    if (!this.agent) {
      throw new Error("Agent not configured (sign in first)")
    }
    await this.agent.promptStreaming(req.sessionId, req.text)
  }

  public async stopGeneration(sessionId: string): Promise<void> {
    if (!this.agent) {
      return
    }
    await this.agent.abort(sessionId)
  }

  public async getMessages(sessionId: string): Promise<ChatMessage[]> {
    if (!this.agent) {
      return []
    }
    return this.agent.getMessages(sessionId)
  }
}
