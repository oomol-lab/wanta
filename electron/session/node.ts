import type { AgentManager } from "../agent/manager.ts"
import type { SessionActivityStore } from "./activity-store.ts"
import type { GenerateSessionTitleRequest, GenerateSessionTitleResult, SessionInfo, SessionService } from "./common.ts"
import type { IConnectionService } from "@oomol/connection"

import { ConnectionService } from "@oomol/connection"
import { SessionService as SessionServiceName } from "./common.ts"

interface SessionServiceDeps {
  activityStore?: SessionActivityStore
}

export class SessionServiceImpl
  extends ConnectionService<SessionService>
  implements IConnectionService<SessionService>
{
  private agent: AgentManager | null
  private readonly deps: SessionServiceDeps
  private activityLoaded = false
  private activityLoadPromise: Promise<void> | null = null
  private sessionActivityAt = new Map<string, number>()

  public constructor(agent: AgentManager | null = null, deps: SessionServiceDeps = {}) {
    super(SessionServiceName)
    this.agent = agent
    this.deps = deps
  }

  /** 登录 / 登出时由 main 重新装配 agent。 */
  public setAgent(agent: AgentManager | null): void {
    this.agent = agent
    if (!agent) {
      this.sessionActivityAt.clear()
      this.activityLoaded = false
      this.activityLoadPromise = null
    }
  }

  public async list(): Promise<SessionInfo[]> {
    if (!this.agent) {
      return []
    }
    await this.ensureActivityLoaded()
    return this.mergeLocalActivity(await this.agent.listSessions())
  }

  public async create(title?: string): Promise<SessionInfo> {
    if (!this.agent) {
      throw new Error("Agent not configured (sign in first)")
    }
    const info = await this.agent.createSession(title)
    void this.broadcastChanged()
    return info
  }

  public async generateTitle(req: GenerateSessionTitleRequest): Promise<GenerateSessionTitleResult> {
    if (!this.agent) {
      throw new Error("Agent not configured (sign in first)")
    }
    return this.agent.generateSessionTitle(req)
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
    await this.ensureActivityLoaded()
    this.sessionActivityAt.delete(id)
    await this.persistActivity()
    await this.agent.deleteSession(id)
    void this.broadcastChanged()
  }

  public markUsed(id: string, usedAt = Date.now()): boolean {
    if (!Number.isFinite(usedAt) || usedAt <= 0) {
      return false
    }
    const current = this.sessionActivityAt.get(id) ?? 0
    if (usedAt <= current) {
      return false
    }
    this.sessionActivityAt.set(id, usedAt)
    return true
  }

  public async refreshAndEmit(): Promise<void> {
    await this.broadcastChanged()
  }

  public async recordUseAndEmit(id: string, usedAt = Date.now()): Promise<void> {
    await this.ensureActivityLoaded()
    if (!this.markUsed(id, usedAt)) {
      return
    }
    await this.persistActivity()
    await this.refreshAndEmit()
  }

  private async ensureActivityLoaded(): Promise<void> {
    if (this.activityLoaded) {
      return
    }
    if (this.activityLoadPromise) {
      return this.activityLoadPromise
    }
    this.activityLoadPromise = (async () => {
      const persisted = await this.deps.activityStore?.read()
      for (const [id, usedAt] of persisted ?? []) {
        const current = this.sessionActivityAt.get(id) ?? 0
        if (usedAt > current) {
          this.sessionActivityAt.set(id, usedAt)
        }
      }
      this.activityLoaded = true
      this.activityLoadPromise = null
    })()
    return this.activityLoadPromise
  }

  private async persistActivity(): Promise<void> {
    await this.deps.activityStore?.write(this.sessionActivityAt)
  }

  private mergeLocalActivity(sessions: SessionInfo[]): SessionInfo[] {
    return sessions
      .map((session) => {
        const usedAt = this.sessionActivityAt.get(session.id)
        if (!usedAt || usedAt <= session.updatedAt) {
          return session
        }
        return { ...session, updatedAt: usedAt }
      })
      .sort((a, b) => b.updatedAt - a.updatedAt)
  }

  private async broadcastChanged(): Promise<void> {
    if (!this.agent) {
      return
    }
    const sessions = await this.list()
    await this.send("sessionsChanged", { sessions })
  }
}
