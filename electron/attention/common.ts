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
  teamId?: string
  sessionId: string
}

export type NotificationCapabilityPlatform = "darwin" | "other" | "win32"

export type NotificationCapabilityStatus = "development-unavailable" | "testable" | "unsupported"

export interface NotificationCapability {
  canOpenSystemSettings: boolean
  platform: NotificationCapabilityPlatform
  status: NotificationCapabilityStatus
}

export type NotificationTestOutcome = "accepted" | "delivered" | "failed" | "timed-out" | "unsupported"

export interface NotificationTestResult {
  error?: string
  foundInHistory?: boolean
  notificationId?: string
  outcome: NotificationTestOutcome
  windowFocused?: boolean
}

export type AttentionService = typeof AttentionService
export const AttentionService = serviceName("attention-service") as ServiceName<{
  ServerEvents: {
    attentionStateChanged: AttentionState
    openSessionRequested: OpenAttentionSessionEvent
  }
  ClientInvokes: {
    getAttentionState(): Promise<AttentionState>
    getNotificationCapability(): Promise<NotificationCapability>
    markSessionViewed(sessionId: string): Promise<void>
    openSystemNotificationSettings(): Promise<void>
    setVisibleSession(req: VisibleSessionRequest): Promise<void>
    testCompletionNotification(): Promise<NotificationTestResult>
  }
}>
