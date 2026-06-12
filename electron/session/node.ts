import type { AgentManager } from "../agent/manager.ts"
import type { SessionInfo, SessionService } from "./common.ts"
import type { IConnectionService } from "@oomol/connection"

import { ConnectionService } from "@oomol/connection"
import { SessionService as SessionServiceName } from "./common.ts"

export class SessionServiceImpl
  extends ConnectionService<SessionService>
  implements IConnectionService<SessionService>
{
  private agent: AgentManager | null

  public constructor(agent: AgentManager | null = null) {
    super(SessionServiceName)
    this.agent = agent
  }

  /** 登录 / 登出时由 main 重新装配 agent。 */
  public setAgent(agent: AgentManager | null): void {
    this.agent = agent
  }

  public async list(): Promise<SessionInfo[]> {
    if (!this.agent) {
      return []
    }
    return this.agent.listSessions()
  }

  public async create(title?: string): Promise<SessionInfo> {
    if (!this.agent) {
      throw new Error("Agent not configured (sign in first)")
    }
    const info = await this.agent.createSession(title)
    void this.broadcastChanged()
    return info
  }

  public async rename(req: { id: string; title: string }): Promise<void> {
    if (!this.agent) {
      return
    }
    await this.agent.renameSession(req.id, req.title)
    void this.broadcastChanged()
  }

  public async remove(id: string): Promise<void> {
    if (!this.agent) {
      return
    }
    await this.agent.deleteSession(id)
    void this.broadcastChanged()
  }

  private async broadcastChanged(): Promise<void> {
    if (!this.agent) {
      return
    }
    const sessions = await this.agent.listSessions()
    await this.send("sessionsChanged", { sessions })
  }
}
