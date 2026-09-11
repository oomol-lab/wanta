import type { ChatPermissionRequest } from "../../../electron/chat/common.ts"
import type { MessageKey } from "@/i18n/i18n"

import {
  isHighRiskPermissionRequest,
  isLikelyProjectDevCommandRequest,
  isPythonDependencyPermissionRequest,
  managedPythonDependencyInstall,
  permissionCommand,
  permissionDeletionTargets,
  permissionRequestHasSensitiveResource,
  permissionRequestKind,
} from "./permission-request.ts"

export interface PermissionPresentation {
  title: MessageKey
  description: MessageKey
  allow: MessageKey
  repeat?: MessageKey
  targets: string[]
  command?: string
  grantPatterns: string[]
  caution: boolean
  detailsOpen: boolean
  recovery: boolean
}

export function permissionTargetLabel(target: string): { name: string; location?: string } {
  if (!/^(?:\/|[A-Za-z]:[\\/]|\\\\)/u.test(target) || /[\n\r]/u.test(target)) return { name: target }
  const segments = target
    .replace(/[\\/]+$/u, "")
    .split(/[\\/]/u)
    .filter(Boolean)
  const name = segments.pop()
  if (!name) return { name: target }
  return {
    name,
    location: segments.length ? `${segments.length > 2 ? "… / " : ""}${segments.slice(-2).join(" / ")}` : undefined,
  }
}

export function permissionPresentation(request: ChatPermissionRequest): PermissionPresentation {
  const kind = permissionRequestKind(request)
  const reason = request.wanta?.promptReason
  const command = kind === "command" ? permissionCommand(request) : undefined
  const highRisk = reason === "high_risk_command" || (!reason && isHighRiskPermissionRequest(request))
  const sensitive = reason === "sensitive_resource" || (!reason && permissionRequestHasSensitiveResource(request))
  const install = managedPythonDependencyInstall(request)
  const taskInstall = Boolean(install && !sensitive)
  const canRepeat = Boolean(
    (!highRisk || taskInstall) && !sensitive && (request.save?.length || request.resources.length || command),
  )
  const recovery = Boolean(request.wanta?.automaticReplyFailed)
  const result: PermissionPresentation = {
    title: "permissionPrompt.unknownTitle",
    description: "permissionPrompt.unknownBody",
    allow: "permissionPrompt.run",
    targets: [...new Set(request.resources.map((value) => value.trim()).filter((value) => value && value !== command))],
    command,
    grantPatterns: [
      ...new Set([
        ...(request.save?.length ? request.save : request.resources),
        ...(command ? [...request.resources, command] : []),
      ]),
    ],
    caution: highRisk || sensitive || reason === "broad_resource",
    detailsOpen: false,
    recovery,
  }
  if (canRepeat && !recovery) {
    result.repeat = taskInstall
      ? "chat.permissionRequiredAllowPythonDependenciesTask"
      : kind === "command"
        ? isLikelyProjectDevCommandRequest(request)
          ? "chat.permissionRequiredAllowProjectDevSession"
          : "chat.permissionRequiredAllowCommandSession"
        : kind === "edit"
          ? "chat.permissionRequiredAllowEditSession"
          : kind === "path"
            ? "chat.permissionRequiredAllowPathSession"
            : "chat.permissionRequiredAllowSession"
  }
  if (sensitive) {
    result.title = "permissionPrompt.sensitiveTitle"
    result.description = "permissionPrompt.sensitiveBody"
    result.allow = "permissionPrompt.access"
  } else if (recovery) {
    result.title = "permissionPrompt.recoveryTitle"
    result.description = "permissionPrompt.recoveryBody"
    result.allow = "permissionPrompt.retry"
  } else if (reason === "broad_resource") {
    result.title = "permissionPrompt.broadTitle"
    result.description = "permissionPrompt.broadBody"
    result.allow = "permissionPrompt.access"
  } else if (reason === "project_environment_write") {
    result.title = "permissionPrompt.editTitle"
    result.description = "permissionPrompt.editBody"
    result.allow = "permissionPrompt.edit"
  } else {
    const deletion = permissionDeletionTargets(command)
    if (deletion) {
      result.title = "permissionPrompt.deleteTitle"
      result.description = "permissionPrompt.deleteBody"
      result.allow = "permissionPrompt.delete"
      result.targets = [...new Set([...result.targets, ...deletion])]
      result.caution = true
      result.repeat = undefined
    } else if (highRisk) {
      result.title = "permissionPrompt.highRiskTitle"
      result.description = "permissionPrompt.highRiskBody"
    } else if (install) {
      result.title = "permissionPrompt.installTitle"
      result.description = "permissionPrompt.installBody"
      result.allow = "permissionPrompt.install"
      result.targets = [...new Set([...result.targets, ...install.packages])]
    } else if (reason === "dependency_mutation" || isPythonDependencyPermissionRequest(request)) {
      result.title = "permissionPrompt.dependencyTitle"
      result.description = "permissionPrompt.dependencyBody"
    } else if (kind === "edit") {
      result.title = "permissionPrompt.editTitle"
      result.description = "permissionPrompt.editBody"
      result.allow = "permissionPrompt.edit"
    } else if (kind === "path") {
      result.title = "permissionPrompt.accessTitle"
      result.description = "permissionPrompt.accessBody"
      result.allow = "permissionPrompt.access"
    } else if (kind === "network") {
      result.title = "permissionPrompt.networkTitle"
      result.description = "permissionPrompt.networkBody"
      result.allow = "permissionPrompt.access"
    }
  }
  // Specialized grants are not generic resource-pattern grants. Do not imply
  // the visible command is the full scope of a project-development approval.
  if (result.repeat === "chat.permissionRequiredAllowProjectDevSession") result.grantPatterns = []
  if (result.repeat === "chat.permissionRequiredAllowPythonDependenciesTask")
    result.grantPatterns = install?.packages ?? []
  return result
}
