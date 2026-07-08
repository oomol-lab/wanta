import type { AgentPermissionMode, ChatPermissionRequest } from "./common.ts"
import type { PermissionRequestKind, SessionPermissionGrant } from "./permission-request.ts"

import {
  createSessionPermissionGrant,
  isHighRiskPermissionRequest,
  isOoCliPermissionRequest,
  permissionRequestNeedsDefaultPrompt,
  permissionRequestKind,
  requestMatchesSessionGrant,
} from "./permission-request.ts"
import {
  createProjectDevCommandSessionGrant,
  requestMatchesProjectDevCommandSessionGrant,
} from "./project-dev-command.ts"
import { projectPermissionRequestInsideRoot } from "./project-permission.ts"
import { isProjectReadOnlyCommandRequest } from "./project-read-command.ts"

export type LocalAccessAllowReason =
  | "default_command"
  | "default_local"
  | "full_access"
  | "oo_cli"
  | "project_read_command"
  | "session_grant"
  | "trusted_project"

export type LocalAccessDecision =
  | {
      highRisk: boolean
      kind: PermissionRequestKind
      reason: LocalAccessAllowReason
      type: "allow"
    }
  | {
      highRisk: boolean
      kind: PermissionRequestKind
      type: "prompt"
    }

export interface LocalAccessPolicyContext {
  permissionMode: AgentPermissionMode
  sessionGrants?: readonly SessionPermissionGrant[]
  trustedProjectRoot?: string
}

function hasMatchingSessionGrant(
  request: ChatPermissionRequest,
  grants: readonly SessionPermissionGrant[] | undefined,
  trustedProjectRoot: string | undefined,
): boolean {
  return Boolean(
    grants?.some((grant) => {
      if (trustedProjectRoot && requestMatchesProjectDevCommandSessionGrant(request, grant, trustedProjectRoot)) {
        return true
      }
      return requestMatchesSessionGrant(request, grant)
    }),
  )
}

export function evaluateLocalAccessRequest(
  request: ChatPermissionRequest,
  context: LocalAccessPolicyContext,
): LocalAccessDecision {
  const kind = permissionRequestKind(request)
  const highRisk = isHighRiskPermissionRequest(request)
  if (context.permissionMode === "full_access") {
    return { type: "allow", reason: "full_access", kind, highRisk }
  }
  if (hasMatchingSessionGrant(request, context.sessionGrants, context.trustedProjectRoot)) {
    return { type: "allow", reason: "session_grant", kind, highRisk }
  }
  if (permissionRequestNeedsDefaultPrompt(request)) {
    return { type: "prompt", kind, highRisk }
  }
  if (isOoCliPermissionRequest(request)) {
    return { type: "allow", reason: "oo_cli", kind, highRisk }
  }
  if (context.trustedProjectRoot && projectPermissionRequestInsideRoot(request, context.trustedProjectRoot)) {
    return { type: "allow", reason: "trusted_project", kind, highRisk }
  }
  if (context.trustedProjectRoot && isProjectReadOnlyCommandRequest(request, context.trustedProjectRoot)) {
    return { type: "allow", reason: "project_read_command", kind, highRisk }
  }
  if (kind === "command") {
    return { type: "allow", reason: "default_command", kind, highRisk }
  }
  if (kind === "path" || kind === "edit" || kind === "local" || kind === "network") {
    return { type: "allow", reason: "default_local", kind, highRisk }
  }
  return { type: "prompt", kind, highRisk }
}

export function localAccessGrantForRequest(
  request: ChatPermissionRequest,
  context: Pick<LocalAccessPolicyContext, "trustedProjectRoot"> = {},
): SessionPermissionGrant | null {
  if (context.trustedProjectRoot) {
    const projectDevGrant = createProjectDevCommandSessionGrant(request, context.trustedProjectRoot)
    if (projectDevGrant) {
      return projectDevGrant
    }
  }
  return createSessionPermissionGrant(request)
}
