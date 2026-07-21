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

export type LinkRuntimeService = typeof LinkRuntimeService
export const LinkRuntimeService = serviceName("link-runtime-service") as ServiceName<{
  ServerEvents: {
    linkRuntimeChanged: LinkRuntimeState
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
  }
}>
