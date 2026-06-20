import type { AgentManager } from "../agent/manager.ts"
import type { SessionActivityStore } from "./activity-store.ts"
import type { GenerateSessionTitleRequest, GenerateSessionTitleResult, SessionInfo, SessionService } from "./common.ts"
import type { SessionMetadata, SessionMetadataStore } from "./metadata-store.ts"
import type { IConnectionService } from "@oomol/connection"

import { ConnectionService } from "@oomol/connection"
import { SessionService as SessionServiceName } from "./common.ts"

interface SessionServiceDeps {
  activityStore?: SessionActivityStore
  metadataStore?: SessionMetadataStore
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
  private metadataLoaded = false
  private metadataLoadPromise: Promise<void> | null = null
  private sessionMetadata = new Map<string, SessionMetadata>()

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
      this.sessionMetadata.clear()
      this.metadataLoaded = false
      this.metadataLoadPromise = null
    }
  }

  public async list(): Promise<SessionInfo[]> {
    if (!this.agent) {
      return []
    }
    await this.ensureActivityLoaded()
    await this.ensureMetadataLoaded()
    return this.mergeLocalState(await this.agent.listSessions(), "active")
  }

  public async listArchived(): Promise<SessionInfo[]> {
    if (!this.agent) {
      return []
    }
    await this.ensureActivityLoaded()
    await this.ensureMetadataLoaded()
    return this.mergeLocalState(await this.agent.listSessions(), "archived")
  }

  public async create(title?: string): Promise<SessionInfo> {
    if (!this.agent) {
      throw new Error("Agent not configured (sign in first)")
    }
    const info = await this.agent.createSession(title)
    void this.broadcastChanged().catch(() => undefined)
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
    void this.broadcastChanged().catch(() => undefined)
  }

  public async pin(req: { id: string; pinned: boolean }): Promise<void> {
    if (!this.agent) {
      return
    }
    await this.ensureMetadataLoaded()
    const current = this.sessionMetadata.get(req.id) ?? {}
    if (current.archivedAt) {
      return
    }
    if (req.pinned) {
      this.sessionMetadata.set(req.id, { ...current, pinnedAt: Date.now() })
    } else {
      const next = { ...current }
      delete next.pinnedAt
      this.setMetadataEntry(req.id, next)
    }
    await this.persistMetadata()
    void this.broadcastChanged().catch(() => undefined)
  }

  public async archive(id: string): Promise<void> {
    if (!this.agent) {
      return
    }
    await this.ensureMetadataLoaded()
    const current = this.sessionMetadata.get(id) ?? {}
    this.sessionMetadata.set(id, { ...current, archivedAt: Date.now(), pinnedAt: undefined })
    await this.persistMetadata()
    void this.broadcastChanged().catch(() => undefined)
  }

  public async unarchive(id: string): Promise<void> {
    if (!this.agent) {
      return
    }
    await this.ensureMetadataLoaded()
    const current = this.sessionMetadata.get(id)
    if (!current) {
      return
    }
    const next = { ...current }
    delete next.archivedAt
    this.setMetadataEntry(id, next)
    await this.persistMetadata()
    void this.broadcastChanged().catch(() => undefined)
  }

  public async remove(id: string): Promise<void> {
    if (!this.agent) {
      return
    }
    await this.ensureActivityLoaded()
    await this.ensureMetadataLoaded()
    this.sessionActivityAt.delete(id)
    this.sessionMetadata.delete(id)
    await this.persistActivity()
    await this.persistMetadata()
    await this.agent.deleteSession(id)
    void this.broadcastChanged().catch(() => undefined)
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

  private async ensureMetadataLoaded(): Promise<void> {
    if (this.metadataLoaded) {
      return
    }
    if (this.metadataLoadPromise) {
      return this.metadataLoadPromise
    }
    this.metadataLoadPromise = (async () => {
      const persisted = await this.deps.metadataStore?.read()
      for (const [id, metadata] of persisted ?? []) {
        this.setMetadataEntry(id, metadata)
      }
      this.metadataLoaded = true
      this.metadataLoadPromise = null
    })()
    return this.metadataLoadPromise
  }

  private async persistMetadata(): Promise<void> {
    await this.deps.metadataStore?.write(this.sessionMetadata)
  }

  private setMetadataEntry(id: string, metadata: SessionMetadata): void {
    if (metadata.pinnedAt || metadata.archivedAt) {
      this.sessionMetadata.set(id, metadata)
    } else {
      this.sessionMetadata.delete(id)
    }
  }

  private mergeLocalState(sessions: SessionInfo[], visibility: "active" | "archived"): SessionInfo[] {
    return sessions
      .map((session) => {
        const usedAt = this.sessionActivityAt.get(session.id)
        const metadata = this.sessionMetadata.get(session.id)
        return {
          ...session,
          ...(usedAt && usedAt > session.updatedAt ? { updatedAt: usedAt } : {}),
          ...(metadata?.pinnedAt ? { pinnedAt: metadata.pinnedAt } : {}),
          ...(metadata?.archivedAt ? { archivedAt: metadata.archivedAt } : {}),
        }
      })
      .filter((session) => (visibility === "archived" ? Boolean(session.archivedAt) : !session.archivedAt))
      .map((session) => {
        if (session.archivedAt && session.pinnedAt) {
          const next = { ...session }
          delete next.pinnedAt
          return next
        }
        return session
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
