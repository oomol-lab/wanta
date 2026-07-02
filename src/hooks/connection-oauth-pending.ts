import type { ConnectionConnectInput, ConnectionWorkspace } from "../../electron/connections/common.ts"

export interface OAuthPendingOperation {
  actionId: number
  key: string
  pollingKey: string
  service: string
}

export function connectionWorkspaceKey(workspace: ConnectionWorkspace): string {
  return workspace.type === "organization" ? `organization:${workspace.organizationName}` : "personal"
}

export function createConnectionPollingKey(service: string, appId?: string): string {
  return appId ? `${service}\0${appId}` : service
}

export function isConnectionPollingTarget(polling: string | null, service: string, appId?: string): boolean {
  return polling === createConnectionPollingKey(service, appId)
}

export function createOAuthPendingKey(
  workspace: ConnectionWorkspace,
  input: Extract<ConnectionConnectInput, { authType: "oauth2" }>,
): string {
  // connector 会按同一 owner + service 让旧 state 失效；这里也按 service 粒度防重复。
  return `${connectionWorkspaceKey(workspace)}\0${input.service}`
}
