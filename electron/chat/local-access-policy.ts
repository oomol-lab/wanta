import type { ActiveLinkRuntime } from "../link-runtime/common.ts"
import type { AgentPermissionMode, ChatPermissionRequest, LocalPermissionPromptReason } from "./common.ts"
import type { PermissionRequestKind, SessionPermissionGrant } from "./permission-request.ts"

import { openConnectorCommandPolicy } from "../agent/oo-command-permission.ts"
import { isLowConsequenceCleanupCommand } from "./bounded-cleanup.ts"
import {
  createSessionPermissionGrant,
  isHighRiskPermissionRequest,
  isOoCliPermissionRequest,
  isWantaHostToolPermissionRequest,
  isProjectScopedPythonDependencyInstallRequest,
  isTaskScopedPythonDependencyInstallRequest,
  permissionRequestHasSensitiveResource,
  permissionRequestHasBroadResource,
  permissionCommand,
  permissionRequestNeedsDefaultPrompt,
  permissionRequestKind,
  requestMatchesManagedPythonDependencyInstallGrant,
  requestMatchesSessionGrant,
} from "./permission-request.ts"
import {
  createProjectDevCommandSessionGrant,
  isStandardRegistryNodeDependencyInstallRequest,
  requestMatchesProjectDevCommandSessionGrant,
} from "./project-dev-command.ts"
import { projectPermissionRequestInsideRoot } from "./project-permission.ts"
import { isProjectReadOnlyCommandRequest } from "./project-read-command.ts"

export type LocalAccessAllowReason =
  | "bounded_cleanup"
  | "default_command"
  | "default_local"
  | "full_access"
  | "oo_cli"
  | "project_read_command"
  | "session_grant"
  | "trusted_dependency"
  | "trusted_project"
  | "wanta_host_tool"

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
  /**
   * The request comes from an external (BYOA) agent session. Permission policy
   * for those sessions is owned by the agent's own CLI: it decides when to
   * ask, and Wanta relays every ask to the user instead of answering through
   * host-side policy. Must be derived from the session id's kind, never from
   * whether a scratch root could be resolved.
   */
  isExternalSession?: boolean
  linkRuntime?: ActiveLinkRuntime
  permissionMode: AgentPermissionMode
  sessionGrants?: readonly SessionPermissionGrant[]
  taskProcessRoot?: string
  trustedProjectRoot?: string
}

export function localAccessPromptReason(request: ChatPermissionRequest): LocalPermissionPromptReason {
  if (permissionRequestHasSensitiveResource(request)) return "sensitive_resource"
  if (isHighRiskPermissionRequest(request)) return "high_risk_command"
  if (permissionRequestHasBroadResource(request)) return "broad_resource"
  if (permissionRequestNeedsDefaultPrompt(request)) return "dependency_mutation"
  return "unclassified_request"
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
  // Wanta host MCP tools are the external-agent transport for the same
  // capability kernel that OpenCode invokes directly. Their identity,
  // credentials, validation, and audit boundary remain host-owned; do not add
  // a second agent-runtime approval card just because ACP is the transport.
  if (
    context.isExternalSession &&
    isWantaHostToolPermissionRequest(request) &&
    !permissionRequestHasSensitiveResource(request) &&
    !highRisk
  ) {
    return { type: "allow", reason: "wanta_host_tool", kind, highRisk }
  }
  // The guarded OOCLI fallback is a Wanta-owned Link transport just like the
  // host MCP path. Apply the same narrow command classifier to every adapter
  // so switching from OpenCode to Claude/Codex does not add a redundant shell
  // approval. Unknown shell composition, sensitive resources, and high-risk
  // commands continue into the external agent's native permission flow.
  if (
    context.isExternalSession &&
    context.linkRuntime &&
    isOoCliPermissionRequest(request) &&
    !permissionRequestHasSensitiveResource(request) &&
    !highRisk
  ) {
    return { type: "allow", reason: "oo_cli", kind, highRisk }
  }
  if (context.isExternalSession) {
    // linkcode-style pass-through: the external agent's own CLI policy decides
    // WHEN to ask (its native permission modes: acceptEdits, auto classifier,
    // sandbox levels, ...), and Wanta relays every ask to the user instead of
    // answering through host-side policy. The only automatic answers are the
    // user's own explicit "allow for this session" grants, and even those
    // cannot cross credential boundaries or approve high-risk commands.
    if (permissionRequestHasSensitiveResource(request) || highRisk) {
      return { type: "prompt", kind, highRisk }
    }
    if (
      hasMatchingNarrowSessionGrant(
        request,
        context.sessionGrants,
        context.trustedProjectRoot,
        context.activeGenerationId,
      ) ||
      hasMatchingGenericSessionGrant(request, context.sessionGrants)
    ) {
      return { type: "allow", reason: "session_grant", kind, highRisk }
    }
    return { type: "prompt", kind, highRisk }
  }
  const openConnectorPolicy =
    context.linkRuntime === "openconnector" && kind === "command"
      ? openConnectorCommandPolicy(permissionCommand(request) ?? request.resources.join(" "))
      : null
  if (openConnectorPolicy === "deny") return { type: "deny", kind, highRisk }
  if (openConnectorPolicy === "allow") return { type: "allow", reason: "oo_cli", kind, highRisk }
  if (context.permissionMode === "full_access") {
    return { type: "allow", reason: "full_access", kind, highRisk }
  }
  // A generic directory grant cannot cross credential or private application-data boundaries.
  // Only Full Access bypasses this protection.
  if (permissionRequestHasSensitiveResource(request)) {
    return { type: "prompt", kind, highRisk }
  }
  const command = kind === "command" ? permissionCommand(request) : undefined
  if (
    highRisk &&
    command &&
    isLowConsequenceCleanupCommand(command, {
      taskProcessRoot: context.taskProcessRoot,
      trustedProjectRoot: context.trustedProjectRoot,
    })
  ) {
    return { type: "allow", reason: "bounded_cleanup", kind, highRisk }
  }
  if (highRisk) {
    return { type: "prompt", kind, highRisk }
  }
  if (
    (context.taskProcessRoot &&
      (isTaskScopedPythonDependencyInstallRequest(request, context.taskProcessRoot) ||
        isStandardRegistryNodeDependencyInstallRequest(request, context.taskProcessRoot))) ||
    (context.trustedProjectRoot &&
      (isProjectScopedPythonDependencyInstallRequest(request, context.trustedProjectRoot) ||
        isStandardRegistryNodeDependencyInstallRequest(request, context.trustedProjectRoot)))
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
  } = {},
): SessionPermissionGrant | null {
  if (context.trustedProjectRoot) {
    const projectDevGrant = createProjectDevCommandSessionGrant(request, context.trustedProjectRoot)
    if (projectDevGrant) {
      return projectDevGrant
    }
  }
  return createSessionPermissionGrant(request, context)
}
