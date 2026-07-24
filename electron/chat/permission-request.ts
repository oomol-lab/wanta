import type { ChatPermissionRequest } from "./common.ts"

import { isPureOoCliCommand } from "../agent/oo-command-permission.ts"
import { isManagedPythonExecutable, managedPythonExecutable } from "../agent/python-environment.ts"
import { commandRequiresConfirmation } from "./command-risk.ts"
import { dependencyCommandRequiresConfirmation, isDependencyMutationCommand } from "./dependency-policy.ts"
import { hasUnsafeShellSyntax, shellWords } from "./shell-syntax.ts"

export type PermissionRequestKind = "command" | "edit" | "path" | "network" | "local"
export type SessionPermissionGrantKind =
  | "project_dependency_install"
  | "project_dev_command"
  | "python_dependency_install"
  | "request"

export interface SessionPermissionGrant {
  action: string
  generationId?: string
  kind?: SessionPermissionGrantKind
  patterns: string[]
  projectRoot?: string
  processRoot?: string
}

export interface ManagedPythonDependencyInstall {
  packages: string[]
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

const HIGH_RISK_COMMAND_PATH_PATTERNS: readonly RegExp[] = [
  /(^|[\s"'=])(?:~|\$HOME)\/(?:\.ssh|\.aws|\.gnupg|\.config\/gh)(?:\/|[\s"';&|<>]|$)/i,
  /(^|[\s"'=])\/Users\/[^/\s"']+\/(?:\.ssh|\.aws|\.gnupg|\.config\/gh)(?:\/|[\s"';&|<>]|$)/i,
  /(^|[\s"'=])(?:\.\/)?\.env(?:\.[^\s"';&|<>/]*)?(?=$|[\s"';&|<>])/i,
  /(^|[/\s"'=])(?:\.netrc|\.npmrc|\.pypirc|credentials|id_dsa|id_ecdsa|id_ed25519|id_rsa)(?=$|[/\s"';&|<>])/i,
  /(^|[/\s"'=])(?:cookies|login data|keychain|keychains)(?=$|[/\s"';&|<>])/i,
]

const SENSITIVE_COMMAND_RESOURCE_PATTERN =
  /(^|[\s"'=])(?:~|\$HOME|\$\{HOME\}|\/Users\/[^/\s"']+)\/(?:\.ssh|\.aws|\.gnupg|\.kube|\.docker|\.azure|\.gcloud|\.config\/(?:gh|gcloud)|Library\/(?:Keychains|Mail|Messages|AddressBook|Calendars|Application Support\/(?:Google\/Chrome|Firefox|Brave|Microsoft Edge)))(?:\/|[\s"';&|<>]|$)/i

function pathValue(value: string): string {
  const separator = value.indexOf("=")
  return (separator >= 0 ? value.slice(separator + 1) : value).trim()
}

function looksLikeLocalPath(value: string): boolean {
  const candidate = pathValue(value)
  return (
    candidate === "~" ||
    candidate === "$HOME" ||
    candidate === "${HOME}" ||
    /^[A-Za-z]:[\\/]/u.test(candidate) ||
    candidate.startsWith("/") ||
    candidate.startsWith("~/") ||
    candidate.startsWith("$HOME/") ||
    candidate.startsWith("${HOME}/") ||
    candidate.startsWith("file://")
  )
}

function commandAccessResources(command: string): string[] {
  if (hasUnsafeShellSyntax(command)) {
    return []
  }
  const words = shellWords(command)
  return words ? words.map(pathValue).filter(looksLikeLocalPath) : []
}

function isShallowDirectoryListing(command: string): boolean {
  if (hasUnsafeShellSyntax(command)) {
    return false
  }
  const words = shellWords(command)
  if (!words || words[0] !== "ls") {
    return false
  }
  return !words.some((word) => word === "-R" || word === "--recursive")
}

export function isHighRiskPermissionRequest(request: ChatPermissionRequest): boolean {
  if (permissionRequestKind(request) !== "command") {
    return false
  }
  const command = commandText(request)
  if (!command) {
    return false
  }
  return (
    dependencyCommandRequiresConfirmation(command) ||
    commandRequiresConfirmation(command) ||
    HIGH_RISK_COMMAND_PATH_PATTERNS.some((pattern) => pattern.test(command))
  )
}

export function isOoCliPermissionRequest(request: ChatPermissionRequest): boolean {
  return permissionRequestKind(request) === "command" && isPureOoCliCommand(commandText(request))
}

const pythonPackageRequirementPattern =
  /^([A-Za-z0-9](?:[A-Za-z0-9._-]*[A-Za-z0-9])?)(?:\[[A-Za-z0-9._-]+(?:,[A-Za-z0-9._-]+)*\])?(?:(?:===|==|~=|!=|<=|>=|<|>)[A-Za-z0-9*+.!_-]+(?:,(?:===|==|~=|!=|<=|>=|<|>)[A-Za-z0-9*+.!_-]+)*)?$/u
const safePipInstallFlags = new Set([
  "-U",
  "-q",
  "-qq",
  "-qqq",
  "--disable-pip-version-check",
  "--no-cache-dir",
  "--no-input",
  "--prefer-binary",
  "--quiet",
  "--upgrade",
])

function canonicalPythonPackageName(value: string): string {
  return value.toLowerCase().replace(/[._-]+/gu, "-")
}

function managedPythonPackageNames(words: readonly string[]): string[] | null {
  const packages: string[] = []
  for (const word of words) {
    if (word.startsWith("-")) {
      if (!safePipInstallFlags.has(word)) {
        return null
      }
      continue
    }
    const match = pythonPackageRequirementPattern.exec(word)
    const packageName = match?.[1]
    if (!packageName) {
      return null
    }
    packages.push(canonicalPythonPackageName(packageName))
  }
  return packages.length > 0 ? [...new Set(packages)] : null
}

/**
 * Recognizes direct PyPI requirements installed through Wanta's private per-task environment.
 * Source overrides, requirements files, editable installs, paths, URLs, and unknown flags do not qualify.
 */
export function managedPythonDependencyInstall(
  request: ChatPermissionRequest,
  processRoot?: string,
): ManagedPythonDependencyInstall | null {
  if (permissionRequestKind(request) !== "command") {
    return null
  }
  const command = permissionCommand(request)
  if (!command || hasUnsafeShellSyntax(command)) {
    return null
  }
  const words = shellWords(command)
  if (!words || words.length < 5) {
    return null
  }
  const executable = words[0] ?? ""
  if (processRoot ? executable !== managedPythonExecutable(processRoot) : !isManagedPythonExecutable(executable)) {
    return null
  }
  if (words[1] !== "-m" || words[2] !== "pip" || words[3] !== "install") {
    return null
  }
  const packages = managedPythonPackageNames(words.slice(4))
  return packages ? { packages } : null
}

export function isTaskScopedPythonDependencyInstallRequest(
  request: ChatPermissionRequest,
  processRoot: string,
): boolean {
  return Boolean(managedPythonDependencyInstall(request, processRoot))
}

function normalizeResourceText(resource: string): string {
  return resource
    .trim()
    .replace(/^file:\/\//iu, "")
    .replace(/\\/g, "/")
    .replace(/\/+$/u, "")
}

function normalizedLowerResource(resource: string): string {
  return normalizeResourceText(resource).toLowerCase()
}

function resourceBasename(resource: string): string {
  const normalized = normalizedLowerResource(resource)
  const parts = normalized.split("/")
  return parts[parts.length - 1] ?? ""
}

function resourceSegments(resource: string): string[] {
  return normalizedLowerResource(resource)
    .split("/")
    .map((segment) => segment.trim())
    .filter(Boolean)
}

function containsSegmentSequence(segments: readonly string[], sequence: readonly string[]): boolean {
  return segments.some((_, index) => sequence.every((segment, offset) => segments[index + offset] === segment))
}

function isSensitiveResource(resource: string): boolean {
  const basename = resourceBasename(resource)
  if (
    basename === ".env" ||
    basename.startsWith(".env.") ||
    basename === ".netrc" ||
    basename === ".npmrc" ||
    basename === ".pypirc" ||
    basename === "credentials" ||
    basename === "cookies" ||
    basename === "id_dsa" ||
    basename === "id_ecdsa" ||
    basename === "id_ed25519" ||
    basename === "id_rsa" ||
    basename === "login data"
  ) {
    return true
  }
  const segments = resourceSegments(resource)
  return (
    segments.includes(".ssh") ||
    segments.includes(".aws") ||
    segments.includes(".gnupg") ||
    segments.includes(".kube") ||
    segments.includes(".docker") ||
    segments.includes(".azure") ||
    segments.includes(".gcloud") ||
    containsSegmentSequence(segments, [".config", "gh"]) ||
    containsSegmentSequence(segments, [".config", "gcloud"]) ||
    containsSegmentSequence(segments, ["library", "keychains"]) ||
    containsSegmentSequence(segments, ["library", "mail"]) ||
    containsSegmentSequence(segments, ["library", "messages"]) ||
    containsSegmentSequence(segments, ["library", "addressbook"]) ||
    containsSegmentSequence(segments, ["library", "calendars"]) ||
    containsSegmentSequence(segments, ["library", "application support", "google", "chrome"]) ||
    containsSegmentSequence(segments, ["library", "application support", "firefox"]) ||
    containsSegmentSequence(segments, ["library", "application support", "brave"]) ||
    containsSegmentSequence(segments, ["library", "application support", "microsoft edge"])
  )
}

function isBroadResource(resource: string): boolean {
  const normalized = normalizedLowerResource(resource)
  if (
    !normalized ||
    normalized === "/" ||
    normalized === "~" ||
    normalized === "$home" ||
    /^[a-z]:$/iu.test(normalized)
  ) {
    return true
  }
  if (
    normalized === "/users" ||
    /^\/users\/[^/]+$/iu.test(normalized) ||
    normalized === "/home" ||
    /^\/home\/[^/]+$/iu.test(normalized) ||
    normalized === "/root" ||
    normalized === "/applications" ||
    normalized === "/library" ||
    normalized === "/system" ||
    normalized === "/etc" ||
    normalized === "/bin" ||
    normalized === "/sbin" ||
    normalized === "/usr" ||
    normalized === "/var" ||
    normalized === "/proc" ||
    normalized === "/sys" ||
    normalized === "/dev" ||
    normalized === "/run" ||
    /^[a-z]:\/users(?:\/[^/]+)?$/iu.test(normalized) ||
    /^[a-z]:\/(?:windows|program files|program files \(x86\)|programdata)$/iu.test(normalized)
  ) {
    return true
  }
  return false
}

export function permissionRequestHasSensitiveResource(request: ChatPermissionRequest): boolean {
  const values = [...request.resources, ...(request.save ?? [])].filter((value) => value.trim())
  if (values.some(isSensitiveResource)) {
    return true
  }
  if (permissionRequestKind(request) !== "command") {
    return false
  }
  const command = commandText(request)
  return commandAccessResources(command).some(isSensitiveResource) || SENSITIVE_COMMAND_RESOURCE_PATTERN.test(command)
}

export function permissionRequestHasBroadResource(request: ChatPermissionRequest): boolean {
  const values = [...request.resources, ...(request.save ?? [])].filter((value) => value.trim())
  if (values.some(isBroadResource)) {
    return true
  }
  const command = commandText(request)
  return (
    permissionRequestKind(request) === "command" &&
    !isShallowDirectoryListing(command) &&
    commandAccessResources(command).some(isBroadResource)
  )
}

export function permissionRequestNeedsDefaultPrompt(request: ChatPermissionRequest): boolean {
  if (isHighRiskPermissionRequest(request)) {
    return true
  }
  if (permissionRequestHasSensitiveResource(request)) {
    return true
  }
  const kind = permissionRequestKind(request)
  if (kind === "network") {
    return false
  }
  if (kind === "command") {
    const command = commandText(request)
    return isDependencyMutationCommand(command) || permissionRequestHasBroadResource(request)
  }
  return permissionRequestHasBroadResource(request)
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

export function createSessionPermissionGrant(
  request: ChatPermissionRequest,
  context: { managedPythonProcessRoot?: string } = {},
): SessionPermissionGrant | null {
  const processRoot = context.managedPythonProcessRoot
  const managedPythonInstall = processRoot ? managedPythonDependencyInstall(request, processRoot) : null
  if (managedPythonInstall) {
    return {
      action: permissionAction(request),
      kind: "python_dependency_install",
      patterns: managedPythonInstall.packages,
      processRoot,
    }
  }
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

export function requestMatchesManagedPythonDependencyInstallGrant(
  request: ChatPermissionRequest,
  grant: SessionPermissionGrant,
): boolean {
  if (grant.kind !== "python_dependency_install" || permissionAction(request) !== grant.action || !grant.processRoot) {
    return false
  }
  const install = managedPythonDependencyInstall(request, grant.processRoot)
  return Boolean(install && install.packages.every((packageName) => grant.patterns.includes(packageName)))
}
