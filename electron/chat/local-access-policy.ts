import type { ActiveLinkRuntime } from "../link-runtime/common.ts"
import type { AgentPermissionMode, ChatPermissionRequest } from "./common.ts"
import type { PermissionRequestKind, SessionPermissionGrant } from "./permission-request.ts"

import { openConnectorCommandPolicy } from "../agent/oo-command-permission.ts"
import {
  createSessionPermissionGrant,
  isHighRiskPermissionRequest,
  isOoCliPermissionRequest,
  isTaskScopedPythonDependencyInstallRequest,
  permissionRequestHasSensitiveResource,
  permissionCommand,
  permissionRequestNeedsDefaultPrompt,
  permissionRequestKind,
  requestMatchesManagedPythonDependencyInstallGrant,
  requestMatchesSessionGrant,
} from "./permission-request.ts"
import {
  createProjectDependencyInstallTaskGrant,
  createProjectDevCommandSessionGrant,
  isStandardRegistryNodeDependencyInstallRequest,
  requestMatchesProjectDependencyInstallTaskGrant,
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
  | "trusted_dependency"
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
  | {
      highRisk: boolean
      kind: PermissionRequestKind
      type: "deny"
    }

export interface LocalAccessPolicyContext {
  activeGenerationId?: string
  linkRuntime?: ActiveLinkRuntime
  permissionMode: AgentPermissionMode
  sessionGrants?: readonly SessionPermissionGrant[]
  taskProcessRoot?: string
  trustedProjectRoot?: string
}

function hasMatchingNarrowSessionGrant(
  request: ChatPermissionRequest,
  grants: readonly SessionPermissionGrant[] | undefined,
  trustedProjectRoot: string | undefined,
  activeGenerationId: string | undefined,
): boolean {
  return Boolean(
    grants?.some((grant) => {
      if (grant.generationId && grant.generationId !== activeGenerationId) {
        return false
      }
      if (
        trustedProjectRoot &&
        requestMatchesProjectDependencyInstallTaskGrant(request, grant, trustedProjectRoot, activeGenerationId)
      ) {
        return true
      }
      if (trustedProjectRoot && requestMatchesProjectDevCommandSessionGrant(request, grant, trustedProjectRoot)) {
        return true
      }
      if (requestMatchesManagedPythonDependencyInstallGrant(request, grant)) {
        return true
      }
      return false
    }),
  )
}

function hasMatchingGenericSessionGrant(
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
  const openConnectorPolicy =
    context.linkRuntime === "openconnector" && kind === "command"
      ? openConnectorCommandPolicy(permissionCommand(request) ?? request.resources.join(" "))
      : null
  if (openConnectorPolicy === "deny") return { type: "deny", kind, highRisk }
  if (openConnectorPolicy === "allow") return { type: "allow", reason: "oo_cli", kind, highRisk }
  if (context.permissionMode === "full_access") {
    return { type: "allow", reason: "full_access", kind, highRisk }
  }
  // 通用目录 grant 不得越过凭证、私密应用数据等敏感读取边界；只有完全访问才会跳过这层保护。
  if (permissionRequestHasSensitiveResource(request)) {
    return { type: "prompt", kind, highRisk }
  }
  if (
    (context.taskProcessRoot &&
      (isTaskScopedPythonDependencyInstallRequest(request, context.taskProcessRoot) ||
        isStandardRegistryNodeDependencyInstallRequest(request, context.taskProcessRoot))) ||
    (context.trustedProjectRoot && isStandardRegistryNodeDependencyInstallRequest(request, context.trustedProjectRoot))
  ) {
    return { type: "allow", reason: "trusted_dependency", kind, highRisk }
  }
  if (
    hasMatchingNarrowSessionGrant(
      request,
      context.sessionGrants,
      context.trustedProjectRoot,
      context.activeGenerationId,
    )
  ) {
    return { type: "allow", reason: "session_grant", kind, highRisk }
  }
  // 通用目录 grant 只用于普通访问，不能把一次路径允许扩大成高风险 shell 操作。
  if (highRisk) {
    return { type: "prompt", kind, highRisk }
  }
  if (hasMatchingGenericSessionGrant(request, context.sessionGrants)) {
    return { type: "allow", reason: "session_grant", kind, highRisk }
  }
  if (permissionRequestNeedsDefaultPrompt(request)) {
    return { type: "prompt", kind, highRisk }
  }
  if (context.linkRuntime && isOoCliPermissionRequest(request)) {
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
  context: Pick<LocalAccessPolicyContext, "trustedProjectRoot"> & {
    managedPythonProcessRoot?: string
    projectDependencyGenerationId?: string
  } = {},
): SessionPermissionGrant | null {
  if (context.trustedProjectRoot && context.projectDependencyGenerationId) {
    const projectDependencyGrant = createProjectDependencyInstallTaskGrant(
      request,
      context.trustedProjectRoot,
      context.projectDependencyGenerationId,
    )
    if (projectDependencyGrant) {
      return projectDependencyGrant
    }
  }
  if (context.trustedProjectRoot) {
    const projectDevGrant = createProjectDevCommandSessionGrant(request, context.trustedProjectRoot)
    if (projectDevGrant) {
      return projectDevGrant
    }
  }
  return createSessionPermissionGrant(request, context)
}
