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
  permissionRequestIsSelectedProjectEnvWrite,
  permissionRequestNeedsDefaultPrompt,
  permissionRequestKind,
  permissionRequestWorkingDirectory,
  permissionRequestAccessResources,
  requestMatchesManagedPythonDependencyInstallGrant,
  requestMatchesSessionGrant,
} from "./permission-request.ts"
import {
  createProjectDevCommandSessionGrant,
  isStandardRegistryNodeDependencyInstallRequest,
  requestMatchesProjectDevCommandSessionGrant,
} from "./project-dev-command.ts"
import { projectPermissionRequestInsideRoot, projectPermissionResourceInsideRoot } from "./project-permission.ts"
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
  /**
   * Host-owned `/bug-report` turn. Connector, network, and host MCP calls prompt,
   * and local work auto-runs only inside the evidence pack / report artifact roots.
   */
  diagnosticRoots?: {
    artifactRoot: string
    processRoot: string
  }
  /**
   * Proven shell cwd for this request. Prefer metadata.cwd; ChatService also
   * supplies the ACP session working directory. OpenCode's private workspace
   * cwd is never implied.
   */
  commandCwd?: string
}

export function localAccessPromptReason(
  request: ChatPermissionRequest,
  context: Pick<LocalAccessPolicyContext, "commandCwd" | "trustedProjectRoot"> = {},
): LocalPermissionPromptReason {
  const scope = permissionScope(request, context)
  if (permissionRequestHasSensitiveResource(request, scope)) return "sensitive_resource"
  if (isHighRiskPermissionRequest(request, scope)) return "high_risk_command"
  if (permissionRequestHasBroadResource(request)) return "broad_resource"
  if (permissionRequestNeedsDefaultPrompt(request, scope)) return "dependency_mutation"
  return "unclassified_request"
}

function permissionScope(
  request: ChatPermissionRequest,
  context: Pick<LocalAccessPolicyContext, "commandCwd" | "trustedProjectRoot">,
) {
  return {
    ...(context.trustedProjectRoot ? { trustedProjectRoot: context.trustedProjectRoot } : {}),
    ...(effectiveCommandCwd(request, context) ? { commandCwd: effectiveCommandCwd(request, context) } : {}),
  }
}

function effectiveCommandCwd(
  request: ChatPermissionRequest,
  context: Pick<LocalAccessPolicyContext, "commandCwd">,
): string | undefined {
  return permissionRequestWorkingDirectory(request) ?? context.commandCwd
}

function cwdMatchesRoot(cwd: string | undefined, root: string | undefined): string | undefined {
  if (!cwd || !root) {
    return undefined
  }
  return projectPermissionResourceInsideRoot(cwd, root) ? cwd : undefined
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

function diagnosticRequestInsideRoots(
  request: ChatPermissionRequest,
  roots: NonNullable<LocalAccessPolicyContext["diagnosticRoots"]>,
): boolean {
  const resources = permissionRequestAccessResources(request)
  if (resources.length === 0) {
    return false
  }
  return resources.every(
    (resource) =>
      projectPermissionResourceInsideRoot(resource, roots.processRoot) ||
      projectPermissionResourceInsideRoot(resource, roots.artifactRoot),
  )
}

function evaluateDiagnosticTurnAccess(
  request: ChatPermissionRequest,
  context: LocalAccessPolicyContext,
): LocalAccessDecision | undefined {
  const roots = context.diagnosticRoots
  if (!roots) {
    return undefined
  }
  const kind = permissionRequestKind(request)
  const highRisk = isHighRiskPermissionRequest(request, permissionScope(request, context))
  if (kind === "network" || isWantaHostToolPermissionRequest(request) || isOoCliPermissionRequest(request)) {
    return { type: "deny", kind, highRisk }
  }
  if (!diagnosticRequestInsideRoots(request, roots)) {
    return { type: "deny", kind, highRisk }
  }
  return undefined
}

function evaluateBaselineLocalAccessRequest(
  request: ChatPermissionRequest,
  context: Omit<LocalAccessPolicyContext, "isExternalSession">,
): LocalAccessDecision {
  const kind = permissionRequestKind(request)
  const scope = permissionScope(request, context)
  const highRisk = isHighRiskPermissionRequest(request, scope)
  const command = kind === "command" ? permissionCommand(request) : undefined
  const commandCwd = effectiveCommandCwd(request, context)
  const processCwd = cwdMatchesRoot(commandCwd, context.taskProcessRoot)
  const projectCwd = cwdMatchesRoot(commandCwd, context.trustedProjectRoot)
  // The guarded OOCLI fallback is a Wanta-owned Link transport just like the
  // host MCP path. Apply the same narrow command classifier to every adapter
  // so switching from OpenCode to Claude/Codex does not add a redundant shell
  // approval. Unknown shell composition, sensitive resources, and high-risk
  // commands continue through the shared Wanta permission flow.
  const openConnectorPolicy =
    kind === "command" ? openConnectorCommandPolicy(command ?? request.resources.join(" ")) : null
  if (openConnectorPolicy === "deny") return { type: "deny", kind, highRisk }
  // OO is a first-party Wanta capability channel. Once a request is proven to
  // be a pure managed OO invocation, do not add a shell, upload, download, or
  // execution confirmation in any adapter. The managed OO guard remains the
  // authority for operation admission, workspace identity, paths, URLs, and
  // runtime overrides; invalid calls fail there instead of becoming approvable.
  if (isOoCliPermissionRequest(request)) {
    return { type: "allow", reason: "oo_cli", kind, highRisk: false }
  }
  if (context.permissionMode === "full_access") {
    return { type: "allow", reason: "full_access", kind, highRisk }
  }
  // A generic directory grant cannot cross credential or private application-data boundaries.
  // Only Full Access bypasses this protection. Selected-project `.env` files are not this class.
  if (permissionRequestHasSensitiveResource(request, scope)) {
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
  // OOMOL's bundled `oo` CLI is a first-party working channel. A parser miss
  // must not make an otherwise ordinary command stricter than the baseline
  // local-command policy merely because the command contains `oo`. Compound
  // commands continue below, where credential, sensitive-resource, high-risk,
  // dependency, and project boundaries have already been applied.
  if (
    (context.taskProcessRoot &&
      (isTaskScopedPythonDependencyInstallRequest(request, context.taskProcessRoot, processCwd) ||
        isStandardRegistryNodeDependencyInstallRequest(request, context.taskProcessRoot, processCwd))) ||
    (context.trustedProjectRoot &&
      (isProjectScopedPythonDependencyInstallRequest(request, context.trustedProjectRoot, projectCwd) ||
        isStandardRegistryNodeDependencyInstallRequest(request, context.trustedProjectRoot, projectCwd)))
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
  if (permissionRequestIsSelectedProjectEnvWrite(request, scope)) {
    return { type: "prompt", kind, highRisk }
  }
  if (permissionRequestNeedsDefaultPrompt(request, scope)) {
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
  const highRisk = isHighRiskPermissionRequest(request, permissionScope(request, context))
  const diagnostic = evaluateDiagnosticTurnAccess(request, context)
  if (diagnostic) {
    return diagnostic
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
    !permissionRequestHasSensitiveResource(request, permissionScope(request, context)) &&
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
