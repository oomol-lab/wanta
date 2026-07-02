import type { ConnectionConnectInput, ConnectionWorkspace } from "../../electron/connections/common.ts"

export interface OAuthPendingOperation {
  actionId: number
  key: string
  service: string
}

function workspaceKey(workspace: ConnectionWorkspace): string {
  return workspace.type === "organization" ? `organization:${workspace.organizationName}` : "personal"
}

export function createOAuthPendingKey(
  workspace: ConnectionWorkspace,
  input: Extract<ConnectionConnectInput, { authType: "oauth2" }>,
): string {
  // connector 会按同一 owner + service 让旧 state 失效；这里也按 service 粒度防重复。
  return `${workspaceKey(workspace)}\0${input.service}`
}
