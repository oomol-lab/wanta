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
  trustedProjectPaths?: Iterable<string> & Pick<Set<string>, "delete">
}

const invalidSessionScope: SessionScope = {
  organizationId: "__invalid__",
  organizationName: "__invalid__",
}

function normalizeSessionScope(scope: SessionScope | undefined): SessionScope {
  if (scope) {
    const organizationId = scope.organizationId.trim()
    const organizationName = scope.organizationName.trim()
    if (!organizationId || !organizationName) {
      return invalidSessionScope
    }
    return {
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
  return { organizationId, organizationName }
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
  private mutationQueue: Promise<void> = Promise.resolve()
  private runtimeRevision = 0

  public constructor(agent: AgentManager | null = null, deps: SessionServiceDeps = {}) {
    super(SessionServiceName)
    this.agent = agent
    this.deps = deps
  }

  /** 登录 / 登出时由 main 重新装配 agent。 */
  public setAgent(agent: AgentManager | null): void {
    this.runtimeRevision += 1
    this.agent = agent
    if (!agent) {
      // 替换容器而不是原地 clear，避免旧 runtime 的在途持久化拿到新账号的容器引用。
      this.sessionActivityAt = new Map()
      this.activityLoaded = false
      this.activityLoadPromise = null
      this.sessionMetadata = new Map()
      this.metadataLoaded = false
      this.metadataLoadPromise = null
      this.projects = new Map()
      this.projectsLoaded = false
      this.projectsLoadPromise = null
    }
  }

  public async list(req: SessionScopeRequest): Promise<SessionInfo[]> {
    const agent = this.agent
    const revision = this.runtimeRevision
    if (!agent) {
      return []
    }
    await Promise.all([this.ensureActivityLoaded(), this.ensureMetadataLoaded(), this.ensureProjectsLoaded()])
    if (!this.runtimeMatches(agent, revision)) {
      return []
    }
    const sessions = await agent.listSessions()
    if (!this.runtimeMatches(agent, revision)) {
      return []
    }
    return this.mergeLocalState(
      sessions,
      "active",
      normalizeRequestedSessionScope(req.scope),
      normalizeSessionPlacement(req.placement),
    )
  }

  public async listArchived(req: SessionScopeRequest): Promise<SessionInfo[]> {
    const agent = this.agent
    const revision = this.runtimeRevision
    if (!agent) {
      return []
    }
    await Promise.all([this.ensureActivityLoaded(), this.ensureMetadataLoaded(), this.ensureProjectsLoaded()])
    if (!this.runtimeMatches(agent, revision)) {
      return []
    }
    const sessions = await agent.listSessions()
    if (!this.runtimeMatches(agent, revision)) {
      return []
    }
    return this.mergeLocalState(
      sessions,
      "archived",
      normalizeRequestedSessionScope(req.scope),
      normalizeSessionPlacement(req.placement),
    )
  }

  public async listProjects(req: SessionScopeRequest): Promise<SessionProject[]> {
    const agent = this.agent
    const revision = this.runtimeRevision
    if (!agent) {
      return []
    }
    await this.ensureProjectsLoaded()
    if (!this.runtimeMatches(agent, revision)) {
      return []
    }
    const requestedScope = normalizeRequestedSessionScope(req.scope)
    return [...this.projects.values()]
      .filter((project) => !project.archivedAt)
      .filter((project) => sessionScopeMatches(project.scope, requestedScope))
      .sort((a, b) => {
        const pinnedDiff = (b.pinnedAt ?? 0) - (a.pinnedAt ?? 0)
        return pinnedDiff || b.updatedAt - a.updatedAt
      })
  }

  public create(req: CreateSessionRequest): Promise<SessionInfo> {
    return this.enqueueMutation((revision) => this.createMutation(req, revision))
  }

  private async createMutation(req: CreateSessionRequest, revision: number): Promise<SessionInfo> {
    const agent = this.agent
    if (!agent) {
      throw new Error("Agent not configured (sign in first)")
    }
    const scope = normalizeRequestedSessionScope(req.scope)
    const projectId = req.projectId?.trim() || undefined
    const info = await agent.createSession(req.title)
    if (!this.runtimeMatches(agent, revision)) {
      try {
        await agent.deleteSession(info.id)
      } catch (rollbackError) {
        this.logFailure("failed to roll back session after agent runtime changed", rollbackError, {
          sessionId: info.id,
        })
      }
      throw this.runtimeChangedError()
    }
    await this.ensureMetadataLoaded(revision)
    await this.ensureProjectsLoaded(revision)
    if (!this.runtimeMatches(agent, revision)) {
      try {
        await agent.deleteSession(info.id)
      } catch (rollbackError) {
        this.logFailure("failed to roll back session after agent runtime changed", rollbackError, {
          sessionId: info.id,
        })
      }
      throw this.runtimeChangedError()
    }
    const project = projectId ? this.projects.get(projectId) : undefined
    const scopedProjectId = project && sessionScopeMatches(project.scope, scope) ? project.id : undefined
    const previousMetadata = this.sessionMetadata.get(info.id)
    this.setMetadataEntry(info.id, {
      ...this.sessionMetadata.get(info.id),
      scope,
      ...(scopedProjectId ? { projectId: scopedProjectId } : {}),
    })
    try {
      await this.persistMetadata()
    } catch (error) {
      if (previousMetadata) this.sessionMetadata.set(info.id, previousMetadata)
      else this.sessionMetadata.delete(info.id)
      try {
        await agent.deleteSession(info.id)
      } catch (rollbackError) {
        throw new AggregateError([error, rollbackError], "Failed to persist and roll back the created session")
      }
      throw error
    }
    this.broadcastChangedBestEffort("create session")
    return { ...info, scope, ...(scopedProjectId ? { projectId: scopedProjectId } : {}) }
  }

  public createProject(req: CreateProjectRequest): Promise<SessionProject> {
    return this.enqueueMutation((revision) => this.createProjectMutation(req, revision))
  }

  private async createProjectMutation(req: CreateProjectRequest, revision: number): Promise<SessionProject> {
    const projectPath = normalizeProjectPath(req.path)
    if (!projectPath) {
      throw new Error("Project path is required")
    }
    if (this.deps.trustedProjectPaths) {
      const trustedPath = [...this.deps.trustedProjectPaths].find(
        (candidate) => normalizeProjectPath(candidate) === projectPath,
      )
      if (!trustedPath) throw new Error("Project path was not selected with the native directory picker")
      this.deps.trustedProjectPaths.delete(trustedPath)
    }
    await this.ensureProjectsLoaded(revision)
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

  public assignSessionProject(req: AssignSessionProjectRequest): Promise<void> {
    return this.enqueueMutation((revision) => this.assignSessionProjectMutation(req, revision))
  }

  private async assignSessionProjectMutation(req: AssignSessionProjectRequest, revision: number): Promise<void> {
    await this.ensureMetadataLoaded(revision)
    await this.ensureProjectsLoaded(revision)
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

  public setPermissionMode(req: SetSessionPermissionModeRequest): Promise<void> {
    return this.enqueueMutation((revision) => this.setPermissionModeMutation(req, revision))
  }

  private async setPermissionModeMutation(req: SetSessionPermissionModeRequest, revision: number): Promise<void> {
    await this.ensureMetadataLoaded(revision)
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

  public setKnowledgeBases(req: SetSessionKnowledgeBasesRequest): Promise<void> {
    return this.enqueueMutation((revision) => this.setKnowledgeBasesMutation(req, revision))
  }

  private async setKnowledgeBasesMutation(req: SetSessionKnowledgeBasesRequest, revision: number): Promise<void> {
    await this.ensureMetadataLoaded(revision)
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

  public renameProject(req: { id: string; name: string }): Promise<void> {
    return this.enqueueMutation((revision) => this.renameProjectMutation(req, revision))
  }

  private async renameProjectMutation(req: { id: string; name: string }, revision: number): Promise<void> {
    const name = req.name.trim()
    if (!name) {
      throw new Error("Project name is required")
    }
    await this.ensureProjectsLoaded(revision)
    const current = this.projects.get(req.id)
    if (!current || current.archivedAt) {
      return
    }
    this.projects.set(req.id, { ...current, name, updatedAt: Date.now() })
    await this.persistProjects()
    this.broadcastChangedBestEffort("rename project")
  }

  public pinProject(req: { id: string; pinned: boolean }): Promise<void> {
    return this.enqueueMutation((revision) => this.pinProjectMutation(req, revision))
  }

  private async pinProjectMutation(req: { id: string; pinned: boolean }, revision: number): Promise<void> {
    await this.ensureProjectsLoaded(revision)
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

  public archiveProject(id: string): Promise<void> {
    return this.enqueueMutation((revision) => this.archiveProjectMutation(id, revision))
  }

  private async archiveProjectMutation(id: string, revision: number): Promise<void> {
    await this.ensureMetadataLoaded(revision)
    await this.ensureProjectsLoaded(revision)
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

  public removeProject(id: string): Promise<void> {
    return this.enqueueMutation((revision) => this.removeProjectMutation(id, revision))
  }

  private async removeProjectMutation(id: string, revision: number): Promise<void> {
    await this.ensureMetadataLoaded(revision)
    await this.ensureProjectsLoaded(revision)
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
    const agent = this.agent
    const revision = this.runtimeRevision
    if (!agent) {
      throw new Error("Agent not configured (sign in first)")
    }
    const result = await agent.generateSessionTitle(req)
    this.assertRuntimeMatches(agent, revision)
    return result
  }

  public async rename(req: { id: string; title: string }): Promise<void> {
    const agent = this.requireAgent()
    const revision = this.runtimeRevision
    await agent.renameSession(req.id, req.title)
    this.assertRuntimeMatches(agent, revision)
    this.broadcastChangedBestEffort("rename session")
  }

  public pin(req: { id: string; pinned: boolean }): Promise<void> {
    return this.enqueueMutation((revision) => this.pinMutation(req, revision))
  }

  private async pinMutation(req: { id: string; pinned: boolean }, revision: number): Promise<void> {
    await this.ensureMetadataLoaded(revision)
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

  public archive(id: string): Promise<void> {
    return this.enqueueMutation((revision) => this.archiveMutation(id, revision))
  }

  private async archiveMutation(id: string, revision: number): Promise<void> {
    await this.ensureMetadataLoaded(revision)
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

  public unarchive(id: string): Promise<SessionInfo | null> {
    return this.enqueueMutation((revision) => this.unarchiveMutation(id, revision))
  }

  private async unarchiveMutation(id: string, revision: number): Promise<SessionInfo | null> {
    const agent = this.requireAgent()
    await this.ensureMetadataLoaded(revision)
    await this.ensureProjectsLoaded(revision)
    this.assertRuntimeMatches(agent, revision)
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

  public remove(id: string): Promise<void> {
    return this.enqueueMutation((revision) => this.removeMutation(id, revision))
  }

  private async removeMutation(id: string, revision: number): Promise<void> {
    const agent = this.requireAgent()
    await this.ensureActivityLoaded(revision)
    await this.ensureMetadataLoaded(revision)
    this.assertRuntimeMatches(agent, revision)
    await agent.deleteSession(id)
    this.assertRuntimeMatches(agent, revision)
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

  public recordUseAndEmit(id: string, usedAt = Date.now()): Promise<void> {
    return this.enqueueMutation((revision) => this.recordUseAndEmitMutation(id, usedAt, revision))
  }

  private async recordUseAndEmitMutation(id: string, usedAt: number, revision: number): Promise<void> {
    await this.ensureActivityLoaded(revision)
    if (!this.markUsed(id, usedAt)) {
      return
    }
    await this.persistActivity()
    try {
      await this.send("sessionsChanged", {
        activity: { sessionId: id, usedAt },
        reason: "record session use",
      })
    } catch (error) {
      this.logFailure("failed to broadcast sessions changed", error, { action: "record session use", sessionId: id })
    }
  }

  private async ensureActivityLoaded(expectedRevision?: number): Promise<void> {
    while (!this.activityLoaded) {
      if (!this.activityLoadPromise) {
        const revision = this.runtimeRevision
        const loadPromise = (async () => {
          const persisted = await this.deps.activityStore?.read()
          if (revision !== this.runtimeRevision) {
            return
          }
          for (const [id, usedAt] of persisted ?? []) {
            const current = this.sessionActivityAt.get(id) ?? 0
            if (usedAt > current) {
              this.sessionActivityAt.set(id, usedAt)
            }
          }
          this.activityLoaded = true
        })()
        this.activityLoadPromise = loadPromise
      }
      const loadPromise = this.activityLoadPromise
      try {
        await loadPromise
        if (expectedRevision !== undefined) this.assertRevisionMatches(expectedRevision)
      } finally {
        if (this.activityLoadPromise === loadPromise) {
          this.activityLoadPromise = null
        }
      }
    }
    if (expectedRevision !== undefined) {
      await Promise.resolve()
      this.assertRevisionMatches(expectedRevision)
    }
  }

  private async persistActivity(): Promise<void> {
    await this.deps.activityStore?.write(this.sessionActivityAt)
  }

  private async ensureMetadataLoaded(expectedRevision?: number): Promise<void> {
    while (!this.metadataLoaded) {
      if (!this.metadataLoadPromise) {
        const revision = this.runtimeRevision
        const loadPromise = (async () => {
          const persisted = await this.deps.metadataStore?.read()
          if (revision !== this.runtimeRevision) {
            return
          }
          for (const [id, metadata] of persisted ?? []) {
            this.setMetadataEntry(id, metadata)
          }
          this.metadataLoaded = true
        })()
        this.metadataLoadPromise = loadPromise
      }
      const loadPromise = this.metadataLoadPromise
      try {
        await loadPromise
        if (expectedRevision !== undefined) this.assertRevisionMatches(expectedRevision)
      } finally {
        if (this.metadataLoadPromise === loadPromise) {
          this.metadataLoadPromise = null
        }
      }
    }
    if (expectedRevision !== undefined) {
      await Promise.resolve()
      this.assertRevisionMatches(expectedRevision)
    }
  }

  private async persistMetadata(): Promise<void> {
    await this.deps.metadataStore?.write(this.sessionMetadata)
  }

  private async ensureProjectsLoaded(expectedRevision?: number): Promise<void> {
    while (!this.projectsLoaded) {
      if (!this.projectsLoadPromise) {
        const revision = this.runtimeRevision
        const loadPromise = (async () => {
          const persisted = await this.deps.projectStore?.read()
          if (revision !== this.runtimeRevision) {
            return
          }
          for (const [id, project] of persisted ?? []) {
            this.projects.set(id, project)
          }
          this.projectsLoaded = true
        })()
        this.projectsLoadPromise = loadPromise
      }
      const loadPromise = this.projectsLoadPromise
      try {
        await loadPromise
        if (expectedRevision !== undefined) this.assertRevisionMatches(expectedRevision)
      } finally {
        if (this.projectsLoadPromise === loadPromise) {
          this.projectsLoadPromise = null
        }
      }
    }
    if (expectedRevision !== undefined) {
      await Promise.resolve()
      this.assertRevisionMatches(expectedRevision)
    }
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

  private requireAgent(): AgentManager {
    if (!this.agent) throw new Error("Agent not configured (sign in first)")
    return this.agent
  }

  private runtimeMatches(agent: AgentManager, revision: number): boolean {
    return this.agent === agent && this.runtimeRevision === revision
  }

  private assertRuntimeMatches(agent: AgentManager, revision: number): void {
    if (!this.runtimeMatches(agent, revision)) {
      throw this.runtimeChangedError()
    }
  }

  private assertRevisionMatches(revision: number): void {
    if (this.runtimeRevision !== revision) {
      throw this.runtimeChangedError()
    }
  }

  private runtimeChangedError(): Error {
    return new Error("Agent runtime changed while the session operation was pending")
  }

  private async enqueueMutation<T>(mutation: (revision: number) => Promise<T>): Promise<T> {
    const revision = this.runtimeRevision
    const previous = this.mutationQueue
    let release!: () => void
    this.mutationQueue = new Promise<void>((resolve) => {
      release = resolve
    })
    await previous.catch(() => undefined)
    try {
      this.assertRevisionMatches(revision)
      return await mutation(revision)
    } finally {
      release()
    }
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
