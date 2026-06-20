import type { ServiceName } from "@oomol/connection"

import { serviceName } from "../branding.ts"

export interface SessionInfo {
  id: string
  title: string
  createdAt: number
  updatedAt: number
  pinnedAt?: number
  archivedAt?: number
}

export interface SessionsChangedEvent {
  sessions: SessionInfo[]
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
    list(): Promise<SessionInfo[]>
    listArchived(): Promise<SessionInfo[]>
    create(title?: string): Promise<SessionInfo>
    generateTitle(req: GenerateSessionTitleRequest): Promise<GenerateSessionTitleResult>
    rename(req: { id: string; title: string }): Promise<void>
    pin(req: { id: string; pinned: boolean }): Promise<void>
    archive(id: string): Promise<void>
    unarchive(id: string): Promise<void>
    remove(id: string): Promise<void>
  }
}>
