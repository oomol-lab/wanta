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

export type SessionService = typeof SessionService
export const SessionService = serviceName("session-service") as ServiceName<{
  ServerEvents: {
    sessionsChanged: SessionsChangedEvent
  }
  ClientInvokes: {
    list(): Promise<SessionInfo[]>
    create(title?: string): Promise<SessionInfo>
    rename(req: { id: string; title: string }): Promise<void>
    remove(id: string): Promise<void>
  }
}>
