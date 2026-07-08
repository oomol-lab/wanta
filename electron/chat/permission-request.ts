import type { ChatPermissionRequest } from "./common.ts"

import { isPureOoCliCommand } from "../agent/oo-command-permission.ts"

export type PermissionRequestKind = "command" | "edit" | "path" | "network" | "local"
export type SessionPermissionGrantKind = "project_dev_command" | "request"

export interface SessionPermissionGrant {
  action: string
  kind?: SessionPermissionGrantKind
  patterns: string[]
}

export function permissionAction(request: ChatPermissionRequest): string {
  return request.action.trim().toLowerCase()
}

export function permissionRequestKind(request: ChatPermissionRequest): PermissionRequestKind {
  const action = permissionAction(request)
  if (action.includes("bash") || action.includes("command") || action.includes("shell")) {
    return "command"
  }
  if (action.includes("edit") || action.includes("write")) {
    return "edit"
  }
  if (action.includes("external_directory") || action.includes("directory") || action.includes("file")) {
    return "path"
  }
  if (action.includes("webfetch") || action.includes("network")) {
    return "network"
  }
  return "local"
}

export function permissionPrimaryResource(request: ChatPermissionRequest): string | undefined {
  return request.resources.find((item) => item.trim())?.trim()
}

export function permissionCommand(request: ChatPermissionRequest): string | undefined {
  const command = request.metadata?.command
  if (typeof command === "string" && command.trim()) {
    return command.trim()
  }
  return permissionPrimaryResource(request)
}

function commandText(request: ChatPermissionRequest): string {
  return (permissionCommand(request) ?? request.resources.join(" ")).trim()
}

const HIGH_RISK_COMMAND_PATTERNS: readonly RegExp[] = [
  /\bsudo\b/i,
  /\brm\s+[^;&|]*-[^\s;&|]*r[^\s;&|]*f/i,
  /\brm\s+[^;&|]*-[^\s;&|]*f[^\s;&|]*r/i,
  /\bchmod\s+(?:-[^\s]+\s+)*777\b/i,
  /\bchown\s+(?:-[^\s]+\s+)*(?:root|[^;&|]*\/(?:etc|bin|sbin|usr|system|library))/i,
  /\b(?:curl|wget)\b[^|;&]*\|\s*(?:sh|bash|zsh)\b/i,
  /\bgit\s+push\b/i,
  /\bgit\s+reset\s+--hard\b/i,
  /\bgit\s+clean\s+-[^\s;&|]*f/i,
  /\b(?:kubectl|helm)\s+(?:delete|apply|patch|replace|upgrade|rollback)\b/i,
  /\bdocker\s+(?:rm|rmi|system\s+prune|volume\s+rm)\b/i,
  /\b(?:npm|pnpm|yarn)\s+publish\b/i,
  /\b(?:vercel|wrangler|firebase|netlify|sst|serverless)\s+(?:deploy|publish)\b/i,
]

const HIGH_RISK_PATH_PATTERNS: readonly RegExp[] = [
  /(^|\s)\/(?:etc|bin|sbin|usr|system|library)(?:\/|\s|$)/i,
  /(^|\s)~\/(?:\.ssh|\.aws|\.gnupg|\.config\/gh)(?:\/|\s|$)/i,
]

export function isHighRiskPermissionRequest(request: ChatPermissionRequest): boolean {
  if (permissionRequestKind(request) !== "command") {
    return false
  }
  const command = commandText(request)
  if (!command) {
    return false
  }
  return (
    HIGH_RISK_COMMAND_PATTERNS.some((pattern) => pattern.test(command)) ||
    HIGH_RISK_PATH_PATTERNS.some((pattern) => pattern.test(command))
  )
}

export function isOoCliPermissionRequest(request: ChatPermissionRequest): boolean {
  return permissionRequestKind(request) === "command" && isPureOoCliCommand(commandText(request))
}

function escapeRegExp(value: string): string {
  return value.replace(/[\\^$+?.()|[\]{}]/g, "\\$&")
}

function patternMatches(pattern: string, value: string): boolean {
  const normalizedPattern = pattern.trim()
  const normalizedValue = value.trim()
  if (!normalizedPattern || !normalizedValue) {
    return false
  }
  if (normalizedPattern === normalizedValue) {
    return true
  }
  const withoutTrailingSlash = normalizedPattern.replace(/\/+$/, "")
  if (
    withoutTrailingSlash.startsWith("/") &&
    (normalizedValue === withoutTrailingSlash || normalizedValue.startsWith(`${withoutTrailingSlash}/`))
  ) {
    return true
  }
  if (!normalizedPattern.includes("*")) {
    return false
  }
  const source = normalizedPattern
    .split("*")
    .map((part) => escapeRegExp(part))
    .join(".*")
  return new RegExp(`^${source}$`).test(normalizedValue)
}

export function createSessionPermissionGrant(request: ChatPermissionRequest): SessionPermissionGrant | null {
  const basePatterns = request.save?.length
    ? request.save
    : request.resources.length > 0
      ? request.resources
      : permissionRequestKind(request) === "command"
        ? [permissionCommand(request)].filter((item): item is string => typeof item === "string")
        : []
  const patterns = basePatterns.map((item) => item.trim()).filter(Boolean)
  if (patterns.length === 0) {
    return null
  }
  return { action: permissionAction(request), kind: "request", patterns }
}

export function requestMatchesSessionGrant(request: ChatPermissionRequest, grant: SessionPermissionGrant): boolean {
  if (grant.kind && grant.kind !== "request") {
    return false
  }
  if (permissionAction(request) !== grant.action) {
    return false
  }
  const values = [permissionCommand(request), ...request.resources].filter(
    (value): value is string => typeof value === "string" && value.trim().length > 0,
  )
  return values.some((value) => grant.patterns.some((pattern) => patternMatches(pattern, value)))
}
