import type { ServiceName } from "@oomol/connection"

import { serviceName } from "../branding.ts"

export interface SessionInfo {
  id: string
  title: string
  createdAt: number
  updatedAt: number
  scope?: SessionScope
  projectId?: string
  pinnedAt?: number
  archivedAt?: number
}

export type SessionScope =
  | { type: "personal" }
  | { organizationId: string; organizationName: string; type: "organization" }

export interface SessionScopeRequest {
  scope?: SessionScope
}

export interface SessionProject {
  id: string
  name: string
  path: string
  createdAt: number
  updatedAt: number
  scope?: SessionScope
  archivedAt?: number
}

export interface CreateProjectRequest {
  name?: string
  path: string
  scope?: SessionScope
}

export interface AssignSessionProjectRequest {
  projectId?: string
  sessionId: string
}

export interface SessionsChangedEvent {
  sessions: SessionInfo[]
}

export interface CreateSessionRequest {
  projectId?: string
  scope?: SessionScope
  title?: string
}

export interface GenerateSessionTitleRequest {
  text: string
  attachmentNames?: string[]
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
    list(req?: SessionScopeRequest): Promise<SessionInfo[]>
    listArchived(req?: SessionScopeRequest): Promise<SessionInfo[]>
    listProjects(req?: SessionScopeRequest): Promise<SessionProject[]>
    create(req?: CreateSessionRequest): Promise<SessionInfo>
    createProject(req: CreateProjectRequest): Promise<SessionProject>
    assignSessionProject(req: AssignSessionProjectRequest): Promise<void>
    removeProject(id: string): Promise<void>
    generateTitle(req: GenerateSessionTitleRequest): Promise<GenerateSessionTitleResult>
    rename(req: { id: string; title: string }): Promise<void>
    pin(req: { id: string; pinned: boolean }): Promise<void>
    archive(id: string): Promise<void>
    unarchive(id: string): Promise<void>
    remove(id: string): Promise<void>
  }
}>
