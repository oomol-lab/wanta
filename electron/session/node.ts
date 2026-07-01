import type { AgentManager } from "../agent/manager.ts"
import type { SessionActivityStore } from "./activity-store.ts"
import type {
  AssignSessionProjectRequest,
  CreateProjectRequest,
  CreateSessionRequest,
  GenerateSessionTitleRequest,
  GenerateSessionTitleResult,
  SessionInfo,
  SessionPlacement,
  SessionProject,
  SessionScope,
  SessionScopeRequest,
  SessionService,
} from "./common.ts"
import type { SessionMetadata, SessionMetadataStore } from "./metadata-store.ts"
import type { SessionProjectStore } from "./project-store.ts"
import type { IConnectionService } from "@oomol/connection"

import { ConnectionService } from "@oomol/connection"
import { randomUUID } from "node:crypto"
import path from "node:path"
import { SessionService as SessionServiceName } from "./common.ts"

interface SessionServiceDeps {
  activityStore?: SessionActivityStore
  metadataStore?: SessionMetadataStore
  onSessionRemoved?: (sessionId: string) => Promise<void> | void
  projectStore?: SessionProjectStore
}

const personalSessionScope: SessionScope = { type: "personal" }

function normalizeSessionScope(scope: SessionScope | undefined): SessionScope {
  if (scope?.type === "organization") {
    const organizationId = scope.organizationId.trim()
    const organizationName = scope.organizationName.trim()
    if (!organizationId || !organizationName) {
      return personalSessionScope
    }
    return {
      type: "organization",
      organizationId,
      organizationName,
    }
  }
  return personalSessionScope
}

function sessionScopeMatches(sessionScope: SessionScope | undefined, requestedScope: SessionScope): boolean {
  const normalizedSessionScope = normalizeSessionScope(sessionScope)
  if (requestedScope.type === "personal") {
    return normalizedSessionScope.type === "personal"
  }
  return (
    normalizedSessionScope.type === "organization" &&
    normalizedSessionScope.organizationId === requestedScope.organizationId
  )
}

function createRequestTitle(req?: CreateSessionRequest | string): string | undefined {
  return typeof req === "string" ? req : req?.title
}

function createRequestScope(req?: CreateSessionRequest | string): SessionScope {
  return normalizeSessionScope(typeof req === "string" ? undefined : req?.scope)
}

function createRequestProjectId(req?: CreateSessionRequest | string): string | undefined {
  const projectId = typeof req === "string" ? undefined : req?.projectId?.trim()
  return projectId || undefined
}

function normalizeSessionPlacement(placement: SessionPlacement | undefined): SessionPlacement {
  return placement === "project" || placement === "task" ? placement : "all"
}

function normalizeProjectPath(projectPath: string): string {
  return projectPath.trim().replace(/[\\/]+$/, "")
}

function projectNameFromPath(projectPath: string): string {
  return path.basename(normalizeProjectPath(projectPath)) || projectPath
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
  private projectsLoaded = false
  private projectsLoadPromise: Promise<void> | null = null
  private projects = new Map<string, SessionProject>()

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
      this.projects.clear()
      this.projectsLoaded = false
      this.projectsLoadPromise = null
    }
  }

  public async list(req: SessionScopeRequest = {}): Promise<SessionInfo[]> {
    if (!this.agent) {
      return []
    }
    await this.ensureActivityLoaded()
    await this.ensureMetadataLoaded()
    await this.ensureProjectsLoaded()
    return this.mergeLocalState(
      await this.agent.listSessions(),
      "active",
      normalizeSessionScope(req.scope),
      normalizeSessionPlacement(req.placement),
    )
  }

  public async listArchived(req: SessionScopeRequest = {}): Promise<SessionInfo[]> {
    if (!this.agent) {
      return []
    }
    await this.ensureActivityLoaded()
    await this.ensureMetadataLoaded()
    await this.ensureProjectsLoaded()
    return this.mergeLocalState(
      await this.agent.listSessions(),
      "archived",
      normalizeSessionScope(req.scope),
      normalizeSessionPlacement(req.placement),
    )
  }

  public async listProjects(req: SessionScopeRequest = {}): Promise<SessionProject[]> {
    if (!this.agent) {
      return []
    }
    await this.ensureProjectsLoaded()
    const requestedScope = normalizeSessionScope(req.scope)
    return [...this.projects.values()]
      .filter((project) => !project.archivedAt)
      .filter((project) => sessionScopeMatches(project.scope, requestedScope))
      .sort((a, b) => b.updatedAt - a.updatedAt)
  }

  public async create(req?: CreateSessionRequest | string): Promise<SessionInfo> {
    if (!this.agent) {
      throw new Error("Agent not configured (sign in first)")
    }
    const scope = createRequestScope(req)
    const projectId = createRequestProjectId(req)
    const info = await this.agent.createSession(createRequestTitle(req))
    await this.ensureMetadataLoaded()
    await this.ensureProjectsLoaded()
    const project = projectId ? this.projects.get(projectId) : undefined
    const scopedProjectId = project && sessionScopeMatches(project.scope, scope) ? project.id : undefined
    this.setMetadataEntry(info.id, {
      ...this.sessionMetadata.get(info.id),
      scope,
      ...(scopedProjectId ? { projectId: scopedProjectId } : {}),
    })
    if (scopedProjectId) {
      this.touchProject(scopedProjectId, info.updatedAt)
      await this.persistProjects()
    }
    await this.persistMetadata()
    void this.broadcastChanged().catch(() => undefined)
    return { ...info, scope, ...(scopedProjectId ? { projectId: scopedProjectId } : {}) }
  }

  public async createProject(req: CreateProjectRequest): Promise<SessionProject> {
    if (!this.agent) {
      throw new Error("Agent not configured (sign in first)")
    }
    const projectPath = normalizeProjectPath(req.path)
    if (!projectPath) {
      throw new Error("Project path is required")
    }
    await this.ensureProjectsLoaded()
    const scope = normalizeSessionScope(req.scope)
    const existing = [...this.projects.values()].find(
      (project) => project.path === projectPath && sessionScopeMatches(project.scope, scope),
    )
    if (existing) {
      const next = { ...existing, updatedAt: Date.now() }
      this.projects.set(existing.id, next)
      await this.persistProjects()
      return next
    }
    const now = Date.now()
    const project: SessionProject = {
      id: randomUUID(),
      name: req.name?.trim() || projectNameFromPath(projectPath),
      path: projectPath,
      createdAt: now,
      updatedAt: now,
      scope,
    }
    this.projects.set(project.id, project)
    await this.persistProjects()
    void this.broadcastChanged().catch(() => undefined)
    return project
  }

  public async assignSessionProject(req: AssignSessionProjectRequest): Promise<void> {
    if (!this.agent) {
      return
    }
    await this.ensureMetadataLoaded()
    await this.ensureProjectsLoaded()
    const current = this.sessionMetadata.get(req.sessionId) ?? {}
    const projectId = req.projectId?.trim()
    const next = { ...current }
    if (projectId && this.projects.has(projectId)) {
      next.projectId = projectId
      this.touchProject(projectId)
      await this.persistProjects()
    } else {
      delete next.projectId
    }
    this.setMetadataEntry(req.sessionId, next)
    await this.persistMetadata()
    void this.broadcastChanged().catch(() => undefined)
  }

  public async removeProject(id: string): Promise<void> {
    if (!this.agent) {
      return
    }
    await this.ensureMetadataLoaded()
    await this.ensureProjectsLoaded()
    if (!this.projects.delete(id)) {
      return
    }
    for (const [sessionId, metadata] of this.sessionMetadata.entries()) {
      if (metadata.projectId !== id) {
        continue
      }
      const next = { ...metadata }
      delete next.projectId
      this.setMetadataEntry(sessionId, next)
    }
    await this.persistProjects()
    await this.persistMetadata()
    void this.broadcastChanged().catch(() => undefined)
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

  public async unarchive(id: string): Promise<SessionInfo | null> {
    if (!this.agent) {
      return null
    }
    await this.ensureMetadataLoaded()
    const current = this.sessionMetadata.get(id)
    if (!current) {
      return null
    }
    const next = { ...current }
    delete next.archivedAt
    this.setMetadataEntry(id, next)
    await this.persistMetadata()
    const restored = await this.resolveSession(id, "active")
    void this.broadcastChanged().catch(() => undefined)
    return restored
  }

  public async remove(id: string): Promise<void> {
    if (!this.agent) {
      return
    }
    await this.ensureActivityLoaded()
    await this.ensureMetadataLoaded()
    await this.agent.deleteSession(id)
    this.sessionActivityAt.delete(id)
    this.sessionMetadata.delete(id)
    await this.deps.onSessionRemoved?.(id)
    await this.persistActivity()
    await this.persistMetadata()
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
    await this.ensureMetadataLoaded()
    await this.ensureProjectsLoaded()
    const projectId = this.sessionMetadata.get(id)?.projectId
    if (projectId && this.touchProject(projectId, usedAt)) {
      await this.persistProjects()
    }
    await this.persistActivity()
    await this.refreshAndEmit().catch(() => undefined)
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

  private async ensureProjectsLoaded(): Promise<void> {
    if (this.projectsLoaded) {
      return
    }
    if (this.projectsLoadPromise) {
      return this.projectsLoadPromise
    }
    this.projectsLoadPromise = (async () => {
      const persisted = await this.deps.projectStore?.read()
      for (const [id, project] of persisted ?? []) {
        this.projects.set(id, project)
      }
      this.projectsLoaded = true
      this.projectsLoadPromise = null
    })()
    return this.projectsLoadPromise
  }

  private async persistProjects(): Promise<void> {
    await this.deps.projectStore?.write(this.projects)
  }

  private touchProject(id: string, updatedAt = Date.now()): boolean {
    const current = this.projects.get(id)
    if (!current || updatedAt <= current.updatedAt) {
      return false
    }
    this.projects.set(id, { ...current, updatedAt })
    return true
  }

  private setMetadataEntry(id: string, metadata: SessionMetadata): void {
    if (metadata.scope || metadata.projectId || metadata.pinnedAt || metadata.archivedAt) {
      this.sessionMetadata.set(id, metadata)
    } else {
      this.sessionMetadata.delete(id)
    }
  }

  private async resolveSession(id: string, visibility: "active" | "archived"): Promise<SessionInfo | null> {
    if (!this.agent) {
      return null
    }
    await this.ensureActivityLoaded()
    await this.ensureMetadataLoaded()
    await this.ensureProjectsLoaded()
    const session = (await this.agent.listSessions()).find((item) => item.id === id)
    if (!session) {
      return null
    }

    const usedAt = this.sessionActivityAt.get(session.id)
    const metadata = this.sessionMetadata.get(session.id)
    const scope = normalizeSessionScope(metadata?.scope)
    const project = this.resolveValidSessionProject(metadata?.projectId, scope)
    const resolved: SessionInfo = {
      ...session,
      scope,
      ...(project ? { projectId: project.id } : {}),
      ...(usedAt && usedAt > session.updatedAt ? { updatedAt: usedAt } : {}),
      ...(metadata?.pinnedAt ? { pinnedAt: metadata.pinnedAt } : {}),
      ...(metadata?.archivedAt ? { archivedAt: metadata.archivedAt } : {}),
    }
    if (visibility === "archived" ? !resolved.archivedAt : resolved.archivedAt) {
      return null
    }
    if (resolved.archivedAt && resolved.pinnedAt) {
      const next = { ...resolved }
      delete next.pinnedAt
      return next
    }
    return resolved
  }

  private mergeLocalState(
    sessions: SessionInfo[],
    visibility: "active" | "archived",
    requestedScope: SessionScope,
    placement: SessionPlacement,
  ): SessionInfo[] {
    return sessions
      .map((session) => {
        const usedAt = this.sessionActivityAt.get(session.id)
        const metadata = this.sessionMetadata.get(session.id)
        const scope = normalizeSessionScope(metadata?.scope)
        const project = this.resolveValidSessionProject(metadata?.projectId, scope)
        return {
          ...session,
          scope,
          ...(project ? { projectId: project.id } : {}),
          ...(usedAt && usedAt > session.updatedAt ? { updatedAt: usedAt } : {}),
          ...(metadata?.pinnedAt ? { pinnedAt: metadata.pinnedAt } : {}),
          ...(metadata?.archivedAt ? { archivedAt: metadata.archivedAt } : {}),
        }
      })
      .filter((session) => sessionScopeMatches(session.scope, requestedScope))
      .filter((session) => this.sessionPlacementMatches(session, placement))
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

  private sessionPlacementMatches(session: SessionInfo, placement: SessionPlacement): boolean {
    if (placement === "all") {
      return true
    }
    const hasValidProject = Boolean(
      this.resolveValidSessionProject(session.projectId, normalizeSessionScope(session.scope)),
    )
    return placement === "project" ? hasValidProject : !hasValidProject
  }

  private resolveValidSessionProject(
    projectId: string | undefined,
    sessionScope: SessionScope,
  ): SessionProject | undefined {
    const project = projectId ? this.projects.get(projectId) : undefined
    if (!project || project.archivedAt || !sessionScopeMatches(project.scope, sessionScope)) {
      return undefined
    }
    return project
  }

  private async broadcastChanged(): Promise<void> {
    if (!this.agent) {
      return
    }
    const sessions = await this.list()
    await this.send("sessionsChanged", { sessions })
  }
}
