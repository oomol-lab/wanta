import type { AgentManager } from "../agent/manager.ts"
import type { SessionActivityStore } from "./activity-store.ts"
import type {
  AssignSessionProjectRequest,
  CreateProjectRequest,
  CreateSessionRequest,
  GenerateSessionTitleRequest,
  GenerateSessionTitleResult,
  SetSessionPermissionModeRequest,
  SetSessionKnowledgeBasesRequest,
  SessionInfo,
  SessionPlacement,
  SessionProject,
  SessionPermissionMode,
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
import { logDiagnostic } from "../diagnostics-log.ts"
import { SessionService as SessionServiceName } from "./common.ts"
import { normalizeKnowledgeBaseIds } from "./metadata-store.ts"

interface SessionServiceDeps {
  activityStore?: SessionActivityStore
  metadataStore?: SessionMetadataStore
  onSessionArchived?: (sessionId: string) => Promise<void> | void
  onSessionRemoved?: (sessionId: string) => Promise<void> | void
  projectStore?: SessionProjectStore
}

const invalidSessionScope: SessionScope = {
  organizationId: "__invalid__",
  organizationName: "__invalid__",
  type: "organization",
}

function normalizeSessionScope(scope: SessionScope | undefined): SessionScope {
  if (scope?.type === "organization") {
    const organizationId = scope.organizationId.trim()
    const organizationName = scope.organizationName.trim()
    if (!organizationId || !organizationName) {
      return invalidSessionScope
    }
    return {
      type: "organization",
      organizationId,
      organizationName,
    }
  }
  return invalidSessionScope
}

function normalizeRequestedSessionScope(scope: SessionScope | undefined): SessionScope {
  if (!scope) {
    throw new Error("Organization scope is required")
  }
  const organizationId = scope.organizationId.trim()
  const organizationName = scope.organizationName.trim()
  if (!organizationId || !organizationName) {
    throw new Error("Organization scope is invalid")
  }
  return { type: "organization", organizationId, organizationName }
}

function sessionScopeMatches(sessionScope: SessionScope | undefined, requestedScope: SessionScope): boolean {
  const normalizedSessionScope = normalizeSessionScope(sessionScope)
  return normalizedSessionScope.organizationId === requestedScope.organizationId
}

function normalizeSessionPlacement(placement: SessionPlacement | undefined): SessionPlacement {
  return placement === "project" || placement === "task" ? placement : "all"
}

function normalizeSessionPermissionMode(mode: SessionPermissionMode): SessionPermissionMode {
  return mode === "full_access" ? "full_access" : "default"
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

  public async list(req: SessionScopeRequest): Promise<SessionInfo[]> {
    if (!this.agent) {
      return []
    }
    await this.ensureActivityLoaded()
    await this.ensureMetadataLoaded()
    await this.ensureProjectsLoaded()
    return this.mergeLocalState(
      await this.agent.listSessions(),
      "active",
      normalizeRequestedSessionScope(req.scope),
      normalizeSessionPlacement(req.placement),
    )
  }

  public async listArchived(req: SessionScopeRequest): Promise<SessionInfo[]> {
    if (!this.agent) {
      return []
    }
    await this.ensureActivityLoaded()
    await this.ensureMetadataLoaded()
    await this.ensureProjectsLoaded()
    return this.mergeLocalState(
      await this.agent.listSessions(),
      "archived",
      normalizeRequestedSessionScope(req.scope),
      normalizeSessionPlacement(req.placement),
    )
  }

  public async listProjects(req: SessionScopeRequest): Promise<SessionProject[]> {
    if (!this.agent) {
      return []
    }
    await this.ensureProjectsLoaded()
    const requestedScope = normalizeRequestedSessionScope(req.scope)
    return [...this.projects.values()]
      .filter((project) => !project.archivedAt)
      .filter((project) => sessionScopeMatches(project.scope, requestedScope))
      .sort((a, b) => {
        const pinnedDiff = (b.pinnedAt ?? 0) - (a.pinnedAt ?? 0)
        return pinnedDiff || b.updatedAt - a.updatedAt
      })
  }

  public async create(req: CreateSessionRequest): Promise<SessionInfo> {
    if (!this.agent) {
      throw new Error("Agent not configured (sign in first)")
    }
    const scope = normalizeRequestedSessionScope(req.scope)
    const projectId = req.projectId?.trim() || undefined
    const info = await this.agent.createSession(req.title)
    await this.ensureMetadataLoaded()
    await this.ensureProjectsLoaded()
    const project = projectId ? this.projects.get(projectId) : undefined
    const scopedProjectId = project && sessionScopeMatches(project.scope, scope) ? project.id : undefined
    this.setMetadataEntry(info.id, {
      ...this.sessionMetadata.get(info.id),
      scope,
      ...(scopedProjectId ? { projectId: scopedProjectId } : {}),
    })
    await this.persistMetadata()
    this.broadcastChangedBestEffort("create session")
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
    const scope = normalizeRequestedSessionScope(req.scope)
    const existing = [...this.projects.values()].find(
      (project) => project.path === projectPath && sessionScopeMatches(project.scope, scope),
    )
    if (existing) {
      const wasArchived = Boolean(existing.archivedAt)
      const next = { ...existing, updatedAt: Date.now() }
      delete next.archivedAt
      if (wasArchived) {
        delete next.pinnedAt
      }
      this.projects.set(existing.id, next)
      await this.persistProjects()
      this.broadcastChangedBestEffort("create project")
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
    this.broadcastChangedBestEffort("create project")
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
    const project = projectId ? this.projects.get(projectId) : undefined
    const scope = normalizeSessionScope(current.scope)
    if (project && !project.archivedAt && sessionScopeMatches(project.scope, scope)) {
      next.projectId = project.id
    } else {
      delete next.projectId
    }
    this.setMetadataEntry(req.sessionId, next)
    await this.persistMetadata()
    this.broadcastChangedBestEffort("assign session project")
  }

  public async setPermissionMode(req: SetSessionPermissionModeRequest): Promise<void> {
    if (!this.agent) {
      return
    }
    await this.ensureMetadataLoaded()
    const current = this.sessionMetadata.get(req.id) ?? {}
    const next = { ...current }
    const permissionMode = normalizeSessionPermissionMode(req.permissionMode)
    if (normalizeSessionPermissionMode(current.permissionMode ?? "default") === permissionMode) {
      return
    }
    if (permissionMode === "full_access") {
      next.permissionMode = permissionMode
    } else {
      delete next.permissionMode
    }
    this.setMetadataEntry(req.id, next)
    await this.persistMetadata()
    this.broadcastChangedBestEffort("set session permission mode")
  }

  public async setKnowledgeBases(req: SetSessionKnowledgeBasesRequest): Promise<void> {
    if (!this.agent) return
    await this.ensureMetadataLoaded()
    const current = this.sessionMetadata.get(req.id) ?? {}
    const knowledgeBaseIds = normalizeKnowledgeBaseIds(req.knowledgeBaseIds) ?? []
    const currentIds = current.knowledgeBaseIds ?? []
    const currentIdSet = new Set(currentIds)
    if (currentIds.length === knowledgeBaseIds.length && knowledgeBaseIds.every((id) => currentIdSet.has(id))) return
    const next = { ...current }
    if (knowledgeBaseIds.length > 0) next.knowledgeBaseIds = knowledgeBaseIds
    else delete next.knowledgeBaseIds
    this.setMetadataEntry(req.id, next)
    await this.persistMetadata()
    this.broadcastChangedBestEffort("set session knowledge bases")
  }

  public async renameProject(req: { id: string; name: string }): Promise<void> {
    if (!this.agent) {
      return
    }
    const name = req.name.trim()
    if (!name) {
      throw new Error("Project name is required")
    }
    await this.ensureProjectsLoaded()
    const current = this.projects.get(req.id)
    if (!current || current.archivedAt) {
      return
    }
    this.projects.set(req.id, { ...current, name, updatedAt: Date.now() })
    await this.persistProjects()
    this.broadcastChangedBestEffort("rename project")
  }

  public async pinProject(req: { id: string; pinned: boolean }): Promise<void> {
    if (!this.agent) {
      return
    }
    await this.ensureProjectsLoaded()
    const current = this.projects.get(req.id)
    if (!current || current.archivedAt) {
      return
    }
    const next = { ...current }
    if (req.pinned) {
      next.pinnedAt = Date.now()
    } else {
      delete next.pinnedAt
    }
    this.projects.set(req.id, next)
    await this.persistProjects()
    this.broadcastChangedBestEffort("pin project")
  }

  public async archiveProject(id: string): Promise<void> {
    if (!this.agent) {
      return
    }
    await this.ensureMetadataLoaded()
    await this.ensureProjectsLoaded()
    const current = this.projects.get(id)
    if (!current || current.archivedAt) {
      return
    }
    const now = Date.now()
    const previousProject = current
    const previousMetadata = new Map<string, SessionMetadata>()
    const nextProject = { ...current, archivedAt: now }
    delete nextProject.pinnedAt
    this.projects.set(id, nextProject)
    for (const [sessionId, metadata] of this.sessionMetadata.entries()) {
      if (metadata.projectId !== id) {
        continue
      }
      previousMetadata.set(sessionId, metadata)
      const nextMetadata = { ...metadata, archivedAt: now }
      delete nextMetadata.pinnedAt
      this.setMetadataEntry(sessionId, nextMetadata)
    }
    try {
      await this.persistProjects()
      await this.persistMetadata()
    } catch (error) {
      this.projects.set(id, previousProject)
      for (const [sessionId, metadata] of previousMetadata) {
        this.setMetadataEntry(sessionId, metadata)
      }
      try {
        await this.persistProjects()
        await this.persistMetadata()
      } catch (rollbackError) {
        // 回滚落盘是 best-effort；仍向调用方暴露原始持久化错误。
        this.logFailure("failed to rollback project archive", rollbackError, { projectId: id })
      }
      throw error
    }
    await Promise.all(
      [...previousMetadata.keys()].map(async (sessionId) => {
        try {
          await this.deps.onSessionArchived?.(sessionId)
        } catch (error) {
          this.logFailure("failed to notify session archived", error, { sessionId })
        }
      }),
    )
    this.broadcastChangedBestEffort("archive project")
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
    this.broadcastChangedBestEffort("remove project")
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
    this.broadcastChangedBestEffort("rename session")
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
    this.broadcastChangedBestEffort("pin session")
  }

  public async archive(id: string): Promise<void> {
    if (!this.agent) {
      return
    }
    await this.ensureMetadataLoaded()
    const current = this.sessionMetadata.get(id) ?? {}
    const next = { ...current, archivedAt: Date.now() }
    delete next.pinnedAt
    this.sessionMetadata.set(id, next)
    await this.persistMetadata()
    try {
      await this.deps.onSessionArchived?.(id)
    } catch (error) {
      this.logFailure("failed to notify session archived", error, { sessionId: id })
    }
    this.broadcastChangedBestEffort("archive session")
  }

  public async unarchive(id: string): Promise<SessionInfo | null> {
    if (!this.agent) {
      return null
    }
    await this.ensureMetadataLoaded()
    await this.ensureProjectsLoaded()
    const current = this.sessionMetadata.get(id)
    if (!current) {
      return null
    }
    const previousMetadata = current
    const scope = normalizeSessionScope(current.scope)
    const project = current.projectId ? this.projects.get(current.projectId) : undefined
    const shouldRestoreProject = Boolean(project?.archivedAt && sessionScopeMatches(project.scope, scope))
    const previousProject = shouldRestoreProject && project ? project : null
    const next = { ...current }
    delete next.archivedAt
    delete next.pinnedAt
    this.setMetadataEntry(id, next)
    if (previousProject) {
      const restoredProject = { ...previousProject, updatedAt: Date.now() }
      delete restoredProject.archivedAt
      delete restoredProject.pinnedAt
      this.projects.set(previousProject.id, restoredProject)
    }
    try {
      if (previousProject) {
        await this.persistProjects()
      }
      await this.persistMetadata()
    } catch (error) {
      this.setMetadataEntry(id, previousMetadata)
      if (previousProject) {
        this.projects.set(previousProject.id, previousProject)
      }
      try {
        if (previousProject) {
          await this.persistProjects()
        }
        await this.persistMetadata()
      } catch (rollbackError) {
        // 回滚落盘是 best-effort；仍向调用方暴露原始持久化错误。
        this.logFailure("failed to rollback session unarchive", rollbackError, { sessionId: id })
      }
      throw error
    }
    const restored = await this.resolveSession(id, "active")
    this.broadcastChangedBestEffort("unarchive session")
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
    this.broadcastChangedBestEffort("remove session")
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
    await this.broadcastChanged("refresh")
  }

  public async recordUseAndEmit(id: string, usedAt = Date.now()): Promise<void> {
    await this.ensureActivityLoaded()
    if (!this.markUsed(id, usedAt)) {
      return
    }
    await this.persistActivity()
    try {
      await this.refreshAndEmit()
    } catch (error) {
      this.logFailure("failed to broadcast sessions changed", error, { action: "record session use", sessionId: id })
    }
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

  private setMetadataEntry(id: string, metadata: SessionMetadata): void {
    if (
      metadata.scope ||
      metadata.projectId ||
      metadata.permissionMode ||
      metadata.knowledgeBaseIds ||
      metadata.pinnedAt ||
      metadata.archivedAt
    ) {
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
      ...(metadata?.permissionMode ? { permissionMode: metadata.permissionMode } : {}),
      ...(metadata?.knowledgeBaseIds ? { knowledgeBaseIds: metadata.knowledgeBaseIds } : {}),
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
          ...(metadata?.permissionMode ? { permissionMode: metadata.permissionMode } : {}),
          ...(metadata?.knowledgeBaseIds ? { knowledgeBaseIds: metadata.knowledgeBaseIds } : {}),
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

  private async broadcastChanged(reason: string): Promise<void> {
    if (!this.agent) {
      return
    }
    await this.send("sessionsChanged", { reason })
  }

  private broadcastChangedBestEffort(action: string): void {
    void this.broadcastChanged(action).catch((error: unknown) => {
      this.logFailure("failed to broadcast sessions changed", error, { action })
    })
  }

  private logFailure(message: string, error: unknown, fields: Record<string, unknown> = {}): void {
    console.warn(`[wanta] ${message}:`, error)
    logDiagnostic("session-service", message, { error, ...fields }, "warn")
  }
}
