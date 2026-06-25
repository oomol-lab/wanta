import type { ServiceName } from "@oomol/connection"

import { serviceName } from "../branding.ts"

export interface SessionInfo {
  id: string
  title: string
  createdAt: number
  updatedAt: number
  scope?: SessionScope
  pinnedAt?: number
  archivedAt?: number
}

export type SessionScope =
  | { type: "personal" }
  | { organizationId: string; organizationName: string; type: "organization" }

export interface SessionScopeRequest {
  scope?: SessionScope
}

export interface SessionsChangedEvent {
  sessions: SessionInfo[]
}

export interface CreateSessionRequest {
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
    create(req?: CreateSessionRequest): Promise<SessionInfo>
    generateTitle(req: GenerateSessionTitleRequest): Promise<GenerateSessionTitleResult>
    rename(req: { id: string; title: string }): Promise<void>
    pin(req: { id: string; pinned: boolean }): Promise<void>
    archive(id: string): Promise<void>
    unarchive(id: string): Promise<void>
    remove(id: string): Promise<void>
  }
}>
