import type { ServiceName } from "@oomol/connection"

import { serviceName } from "../branding.ts"

export interface AttentionState {
  unreadSessionIds: string[]
}

export interface VisibleSessionRequest {
  sessionId?: string
  visible: boolean
}

export interface OpenAttentionSessionEvent {
  sessionId: string
}

export type AttentionService = typeof AttentionService
export const AttentionService = serviceName("attention-service") as ServiceName<{
  ServerEvents: {
    attentionStateChanged: AttentionState
    openSessionRequested: OpenAttentionSessionEvent
  }
  ClientInvokes: {
    getAttentionState(): Promise<AttentionState>
    markSessionViewed(sessionId: string): Promise<void>
    setVisibleSession(req: VisibleSessionRequest): Promise<void>
    testCompletionNotification(): Promise<void>
  }
}>
