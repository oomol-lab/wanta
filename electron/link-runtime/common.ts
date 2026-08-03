import type { ServiceName } from "@oomol/connection"

import { serviceName } from "../branding.ts"

export type LinkRuntimeSelection = "oomol" | "openconnector"
export type ActiveLinkRuntime = "none" | LinkRuntimeSelection

export interface OpenConnectorSummary {
  baseUrl: string
  consoleUrl: string
  tokenConfigured: boolean
}

export interface OpenConnectorAppSummary {
  accountLabel?: string
  authType: string
  connectionName: string
  displayName: string
  isDefault: boolean
  service: string
  status: "active" | "disconnected"
}

export interface LinkRuntimeAvailability {
  oomol: boolean
  openconnector: boolean
}

export type OpenConnectorRuntimeStatus =
  | { kind: "unknown" }
  | { kind: "online"; checkedAt: number }
  | { kind: "offline"; checkedAt: number }
  | { kind: "unauthorized"; checkedAt: number }
  | { kind: "incompatible"; checkedAt: number }

export type OpenConnectorTestResult =
  | { kind: "online" }
  | { kind: "offline"; reason: "tls" | "timeout" | "unreachable" }
  | { kind: "unauthorized" }
  | { kind: "incompatible"; reason: "not-openconnector" | "unsupported-response" }

export interface LinkRuntimeState {
  selected: LinkRuntimeSelection
  active: ActiveLinkRuntime
  availability: LinkRuntimeAvailability
  openConnector?: OpenConnectorSummary
}

export type LarkCliConnectionPhase =
  | "idle"
  | "checking"
  | "updating"
  | "configuring"
  | "authorizing"
  | "verifying"
  | "disconnecting"

export interface LarkCliState {
  accountLabel?: string
  activeVersion: string | null
  available: boolean
  bundledVersion: string | null
  connection: "connected" | "disconnected" | "expired"
  error?: string
  latestVersion?: string
  phase: LarkCliConnectionPhase
  updateStatus: "idle" | "checking" | "current" | "updating" | "updated" | "failed"
}

export type WecomCliConnectionPhase = "idle" | "preparing" | "waiting_for_scan" | "verifying" | "disconnecting"

export interface WecomCliState {
  accountLabel?: string
  activeVersion: string | null
  available: boolean
  canReopenAuthorization: boolean
  connection: "connected" | "disconnected"
  error?: string
  phase: WecomCliConnectionPhase
}

export type DingTalkCliConnectionPhase =
  | "idle"
  | "opening_browser"
  | "waiting_for_authorization"
  | "waiting_for_admin"
  | "verifying"
  | "disconnecting"

export interface DingTalkCliState {
  accountLabel?: string
  activeVersion: string | null
  available: boolean
  canReopenAuthorization: boolean
  connection: "connected" | "disconnected" | "expired"
  error?: string
  phase: DingTalkCliConnectionPhase
}

export type LinkRuntimeService = typeof LinkRuntimeService
export const LinkRuntimeService = serviceName("link-runtime-service") as ServiceName<{
  ServerEvents: {
    linkRuntimeChanged: LinkRuntimeState
    larkCliChanged: LarkCliState
    wecomCliChanged: WecomCliState
    dingTalkCliChanged: DingTalkCliState
  }
  ClientInvokes: {
    getState(): Promise<LinkRuntimeState>
    getOpenConnectorStatus(): Promise<OpenConnectorRuntimeStatus>
    listOpenConnectorApps(): Promise<OpenConnectorAppSummary[]>
    saveOpenConnector(input: { baseUrl: string; consoleUrl?: string; runtimeToken?: string }): Promise<LinkRuntimeState>
    testOpenConnector(input: { baseUrl: string; runtimeToken?: string }): Promise<OpenConnectorTestResult>
    selectRuntime(kind: LinkRuntimeSelection): Promise<LinkRuntimeState>
    clearOpenConnectorToken(): Promise<LinkRuntimeState>
    removeOpenConnector(): Promise<LinkRuntimeState>
    getLarkCliState(): Promise<LarkCliState>
    connectLarkCli(): Promise<LarkCliState>
    disconnectLarkCli(): Promise<LarkCliState>
    cancelLarkCliConnection(): Promise<void>
    getWecomCliState(): Promise<WecomCliState>
    connectWecomCli(): Promise<WecomCliState>
    disconnectWecomCli(): Promise<WecomCliState>
    cancelWecomCliConnection(): Promise<void>
    reopenWecomCliAuthorization(): Promise<boolean>
    getDingTalkCliState(): Promise<DingTalkCliState>
    connectDingTalkCli(): Promise<DingTalkCliState>
    disconnectDingTalkCli(): Promise<DingTalkCliState>
    cancelDingTalkCliConnection(): Promise<void>
    reopenDingTalkCliAuthorization(): Promise<boolean>
  }
}>
