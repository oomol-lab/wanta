import type { AgentPermissionMode, ChatPermissionRequest } from "./common.ts"
import type { PermissionRequestKind, SessionPermissionGrant } from "./permission-request.ts"

import {
  createSessionPermissionGrant,
  isHighRiskPermissionRequest,
  isOoCliPermissionRequest,
  permissionRequestKind,
  requestMatchesSessionGrant,
} from "./permission-request.ts"
import { projectPermissionRequestInsideRoot } from "./project-permission.ts"

export type LocalAccessAllowReason = "oo_cli" | "trusted_project" | "session_grant" | "full_access"

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
): boolean {
  return Boolean(grants?.some((grant) => requestMatchesSessionGrant(request, grant)))
}

export function evaluateLocalAccessRequest(
  request: ChatPermissionRequest,
  context: LocalAccessPolicyContext,
): LocalAccessDecision {
  const kind = permissionRequestKind(request)
  const highRisk = isHighRiskPermissionRequest(request)
  if (isOoCliPermissionRequest(request)) {
    return { type: "allow", reason: "oo_cli", kind, highRisk }
  }
  if (context.trustedProjectRoot && projectPermissionRequestInsideRoot(request, context.trustedProjectRoot)) {
    return { type: "allow", reason: "trusted_project", kind, highRisk }
  }
  if (hasMatchingSessionGrant(request, context.sessionGrants)) {
    return { type: "allow", reason: "session_grant", kind, highRisk }
  }
  if (context.permissionMode === "full_access") {
    return { type: "allow", reason: "full_access", kind, highRisk }
  }
  return { type: "prompt", kind, highRisk }
}

export function localAccessGrantForRequest(request: ChatPermissionRequest): SessionPermissionGrant | null {
  return createSessionPermissionGrant(request)
}
