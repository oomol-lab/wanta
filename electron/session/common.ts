import type { ServiceName } from "@oomol/connection"

import { serviceName } from "../branding.ts"

export interface SessionInfo {
  id: string
  title: string
  createdAt: number
  updatedAt: number
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
}

export type SessionService = typeof SessionService
export const SessionService = serviceName("session-service") as ServiceName<{
  ServerEvents: {
    sessionsChanged: SessionsChangedEvent
  }
  ClientInvokes: {
    list(): Promise<SessionInfo[]>
    create(title?: string): Promise<SessionInfo>
    generateTitle(req: GenerateSessionTitleRequest): Promise<GenerateSessionTitleResult>
    rename(req: { id: string; title: string }): Promise<void>
    remove(id: string): Promise<void>
  }
}>
