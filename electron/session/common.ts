import type { ModelChoice } from "../models/common.ts"
import type { ServiceName } from "@oomol/connection"

import { serviceName } from "../branding.ts"

export interface SessionInfo {
  id: string
  title: string
  createdAt: number
  updatedAt: number
  scope?: SessionScope
  projectId?: string
  permissionMode?: SessionPermissionMode
  knowledgeBaseIds?: string[]
  pinnedAt?: number
  archivedAt?: number
}

export type SessionPermissionMode = "default" | "full_access"

export interface LocalSessionScope {
  kind: "local"
  workspaceId: string
  workspaceName: string
}

export interface TeamSessionScope {
  kind: "team"
  teamId: string
  teamName: string
}

export type SessionScope = LocalSessionScope | TeamSessionScope

export const DEFAULT_LOCAL_WORKSPACE: LocalSessionScope = {
  kind: "local",
  workspaceId: "local",
  workspaceName: "Local",
}

interface LegacyTeamSessionScope {
  organizationId?: unknown
  organizationName?: unknown
  teamId?: unknown
  teamName?: unknown
}

export function normalizeSessionScopeValue(value: unknown): SessionScope | undefined {
  if (!value || typeof value !== "object") {
    return undefined
  }
  const source = value as Partial<LocalSessionScope> & LegacyTeamSessionScope & { kind?: unknown }
  if (source.kind === "local") {
    const workspaceId = typeof source.workspaceId === "string" ? source.workspaceId.trim() : ""
    const workspaceName = typeof source.workspaceName === "string" ? source.workspaceName.trim() : ""
    return workspaceId && workspaceName ? { kind: "local", workspaceId, workspaceName } : undefined
  }
  const normalizeTeamPair = (id: unknown, name: unknown): TeamSessionScope | undefined => {
    const teamId = typeof id === "string" ? id.trim() : undefined
    const teamName = typeof name === "string" ? name.trim() : undefined
    return teamId && teamName ? { kind: "team", teamId, teamName } : undefined
  }
  if (source.kind !== undefined && source.kind !== "team") {
    return undefined
  }
  return (
    normalizeTeamPair(source.teamId, source.teamName) ??
    normalizeTeamPair(source.organizationId, source.organizationName)
  )
}

export function sessionScopeKey(scope: SessionScope): string {
  return scope.kind === "local" ? `local:${scope.workspaceId}` : `team:${scope.teamId}`
}

export function sessionScopesEqual(left: SessionScope, right: SessionScope): boolean {
  return sessionScopeKey(left) === sessionScopeKey(right)
}

export type SessionPlacement = "all" | "project" | "task"

export interface SessionScopeRequest {
  placement?: SessionPlacement
  scope: SessionScope
}

export interface SessionProject {
  id: string
  name: string
  path: string
  createdAt: number
  updatedAt: number
  scope?: SessionScope
  pinnedAt?: number
  archivedAt?: number
}

export interface CreateProjectRequest {
  name?: string
  path: string
  scope: SessionScope
}

export interface AssignSessionProjectRequest {
  projectId?: string
  sessionId: string
}

export interface SetSessionPermissionModeRequest {
  id: string
  permissionMode: SessionPermissionMode
}

export interface SetSessionKnowledgeBasesRequest {
  id: string
  knowledgeBaseIds: string[]
}

export interface SessionsChangedEvent {
  activity?: {
    sessionId: string
    usedAt: number
  }
  reason: string
}

export interface CreateSessionRequest {
  projectId?: string
  scope: SessionScope
  title?: string
}

export interface GenerateSessionTitleRequest {
  text: string
  attachmentNames?: string[]
  model?: ModelChoice
}

export interface GenerateSessionTitleResult {
  title: string
  generated: boolean
}

export type SessionService = typeof SessionService
export const SessionService = serviceName("session-service") as ServiceName<{
  ServerEvents: {
    sessionsChanged: SessionsChangedEvent
  }
  ClientInvokes: {
    list(req: SessionScopeRequest): Promise<SessionInfo[]>
    listArchived(req: SessionScopeRequest): Promise<SessionInfo[]>
    listProjects(req: SessionScopeRequest): Promise<SessionProject[]>
    create(req: CreateSessionRequest): Promise<SessionInfo>
    createProject(req: CreateProjectRequest): Promise<SessionProject>
    assignSessionProject(req: AssignSessionProjectRequest): Promise<void>
    setPermissionMode(req: SetSessionPermissionModeRequest): Promise<void>
    setKnowledgeBases(req: SetSessionKnowledgeBasesRequest): Promise<void>
    renameProject(req: { id: string; name: string }): Promise<void>
    pinProject(req: { id: string; pinned: boolean }): Promise<void>
    archiveProject(id: string): Promise<void>
    removeProject(id: string): Promise<void>
    generateTitle(req: GenerateSessionTitleRequest): Promise<GenerateSessionTitleResult>
    rename(req: { id: string; title: string }): Promise<void>
    pin(req: { id: string; pinned: boolean }): Promise<void>
    archive(id: string): Promise<void>
    unarchive(id: string): Promise<SessionInfo | null>
    remove(id: string): Promise<void>
  }
}>
