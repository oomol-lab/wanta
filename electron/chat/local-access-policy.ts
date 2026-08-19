import type { ActiveLinkRuntime } from "../link-runtime/common.ts"
import type { AgentPermissionMode, ChatPermissionRequest, LocalPermissionPromptReason } from "./common.ts"
import type { PermissionRequestKind, SessionPermissionGrant } from "./permission-request.ts"

import { connectorBusinessCliTransport, openConnectorCommandPolicy } from "../agent/oo-command-permission.ts"
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
   * The request comes from an external (BYOA) agent session. This only affects
   * transport-specific duplicate approvals (for example Wanta MCP dispatch).
   * It must never change Wanta's user-visible local permission policy: the
   * same normalized operation receives the same decision for every agent.
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

function evaluateBaselineLocalAccessRequest(
  request: ChatPermissionRequest,
  context: Omit<LocalAccessPolicyContext, "isExternalSession">,
): LocalAccessDecision {
  const kind = permissionRequestKind(request)
  const highRisk = isHighRiskPermissionRequest(request)
  const command = kind === "command" ? permissionCommand(request) : undefined
  // The guarded OOCLI fallback is a Wanta-owned Link transport just like the
  // host MCP path. Apply the same narrow command classifier to every adapter
  // so switching from OpenCode to Claude/Codex does not add a redundant shell
  // approval. Unknown shell composition, sensitive resources, and high-risk
  // commands continue through the shared Wanta permission flow.
  const openConnectorPolicy =
    kind === "command" ? openConnectorCommandPolicy(command ?? request.resources.join(" ")) : null
  if (openConnectorPolicy === "deny") return { type: "deny", kind, highRisk }
  if (context.permissionMode === "full_access") {
    return { type: "allow", reason: "full_access", kind, highRisk }
  }
  // A generic directory grant cannot cross credential or private application-data boundaries.
  // Only Full Access bypasses this protection.
  if (permissionRequestHasSensitiveResource(request)) {
    return { type: "prompt", kind, highRisk }
  }
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
  if (isOoCliPermissionRequest(request)) return { type: "allow", reason: "oo_cli", kind, highRisk }
  // OOMOL's bundled `oo` CLI is a first-party working channel. A parser miss
  // must not make an otherwise ordinary command stricter than the baseline
  // local-command policy merely because the command contains `oo`. Compound
  // commands continue below, where credential, sensitive-resource, high-risk,
  // dependency, and project boundaries have already been applied.
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

export function evaluateLocalAccessRequest(
  request: ChatPermissionRequest,
  context: LocalAccessPolicyContext,
): LocalAccessDecision {
  const kind = permissionRequestKind(request)
  const highRisk = isHighRiskPermissionRequest(request)
  const connectorTransport = kind === "command" ? connectorBusinessCliTransport(permissionCommand(request) ?? "") : null
  // Link identity, credentials, validation, redaction, and auditing are
  // host-owned. Once a Link runtime is active, every agent must use the same
  // Wanta capability instead of selecting a raw shell transport. This gate is
  // deliberately adapter-neutral and applies even in Full Access mode.
  if (connectorTransport && context.linkRuntime && context.linkRuntime !== "none") {
    return { type: "deny", kind, highRisk }
  }
  // This is deliberately the only adapter-specific policy branch, and it can
  // only make an external-agent decision more permissive. All other requests
  // go through the baseline that powered the built-in OpenCode experience;
  // BYOA must never add a prompt or denial for the same normalized operation.
  // Wanta host MCP tools are transport for the same capability kernel that
  // OpenCode invokes directly, so a second native-runtime prompt is redundant.
  if (
    context.isExternalSession &&
    isWantaHostToolPermissionRequest(request) &&
    !permissionRequestHasSensitiveResource(request) &&
    !highRisk
  ) {
    return { type: "allow", reason: "wanta_host_tool", kind, highRisk }
  }
  return evaluateBaselineLocalAccessRequest(request, context)
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
