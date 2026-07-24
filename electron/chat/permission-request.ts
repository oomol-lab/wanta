import type { ChatPermissionRequest } from "./common.ts"

import { isPureOoCliCommand } from "../agent/oo-command-permission.ts"
import {
  isManagedPythonExecutable,
  managedPythonEnvironmentPath,
  managedPythonExecutables,
  projectPythonExecutables,
} from "../agent/python-environment.ts"
import { commandRequiresConfirmation } from "./command-risk.ts"
import {
  dependencyCommandRequiresConfirmation,
  isDependencyMutationCommand,
  isPythonDependencyMutationCommand,
} from "./dependency-policy.ts"
import {
  commandWithoutSafeDescriptorDuplication,
  commandWithoutSafeOutputFilter,
  effectiveShellCommandWords,
  explicitCdDirectory,
  hasUnsafeShellSyntax,
  shellCommandName,
  shellWords,
  splitLeadingAnd,
  topLevelShellSegments,
} from "./shell-syntax.ts"

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

function nestedShellCommand(words: readonly string[]): string | undefined {
  const name = shellCommandName(words[0])
  if (name !== "bash" && name !== "sh" && name !== "zsh") {
    return undefined
  }
  const commandIndex = words.findIndex(
    (word, index) => index > 0 && (word === "-c" || (/^-[^-]/u.test(word) && word.slice(1).includes("c"))),
  )
  return commandIndex >= 0 ? words[commandIndex + 1] : undefined
}

function commandAccessResources(command: string, depth = 0): string[] {
  return topLevelShellSegments(command).flatMap(({ text }) => {
    const parsed = shellWords(text)
    if (!parsed?.length) {
      return []
    }
    const words = effectiveShellCommandWords(parsed)
    const direct = words.map(pathValue).filter(looksLikeLocalPath)
    const nested = depth < 2 ? nestedShellCommand(words) : undefined
    return nested ? [...direct, ...commandAccessResources(nested, depth + 1)] : direct
  })
}

function isShallowDirectoryListing(command: string): boolean {
  const body = commandWithoutSafeOutputFilter(command)
  if (hasUnsafeShellSyntax(body)) {
    return false
  }
  const words = shellWords(body)
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
const protectedPipInstallOptions = new Set([
  "-c",
  "-e",
  "-f",
  "-i",
  "-r",
  "-t",
  "--break-system-packages",
  "--config-file",
  "--constraint",
  "--default-index",
  "--editable",
  "--extra-index-url",
  "--find-links",
  "--group",
  "--index",
  "--index-url",
  "--prefix",
  "--requirement",
  "--root",
  "--target",
  "--trusted-host",
  "--user",
])

function canonicalPythonPackageName(value: string): string {
  return value.toLowerCase().replace(/[._-]+/gu, "-")
}

function pipOptionName(word: string): string {
  if (!word.startsWith("--")) {
    for (const shortOption of ["-c", "-e", "-f", "-i", "-r", "-t"]) {
      if (word.startsWith(shortOption) && word !== shortOption) {
        return shortOption
      }
    }
  }
  const separator = word.indexOf("=")
  return separator >= 0 ? word.slice(0, separator) : word
}

function managedPythonPackageNames(words: readonly string[]): string[] | null {
  const packages: string[] = []
  for (const word of words) {
    if (word.startsWith("-")) {
      if (protectedPipInstallOptions.has(pipOptionName(word))) {
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

function normalizedExecutable(executable: string): string {
  const normalized = executable.replace(/\\/g, "/").replace(/\/+$/u, "")
  return /^[A-Za-z]:\//u.test(normalized) ? normalized.toLowerCase() : normalized
}

function resolvedExecutable(executable: string, workingDirectory?: string): string {
  if (
    !workingDirectory ||
    !/[\\/]/u.test(executable) ||
    executable.startsWith("/") ||
    /^[A-Za-z]:[\\/]/u.test(executable)
  ) {
    return executable
  }
  const combined = `${workingDirectory.replace(/\\/g, "/").replace(/\/+$/u, "")}/${executable.replace(/\\/g, "/")}`
  const drive = /^([A-Za-z]:)\//u.exec(combined)?.[1]
  const absolute = combined.startsWith("/") || Boolean(drive)
  const body = drive ? combined.slice(drive.length + 1) : combined.replace(/^\/+/u, "")
  const segments: string[] = []
  for (const segment of body.split("/")) {
    if (!segment || segment === ".") {
      continue
    }
    if (segment === "..") {
      segments.pop()
      continue
    }
    segments.push(segment)
  }
  return `${drive ?? ""}${absolute ? "/" : ""}${segments.join("/")}`
}

function resolvedDirectory(directory: string, workingDirectory?: string): string {
  if (
    !workingDirectory ||
    directory.startsWith("/") ||
    directory.startsWith("\\") ||
    /^[A-Za-z]:[\\/]/u.test(directory)
  ) {
    return directory
  }
  return resolvedExecutable(`./${directory}`, workingDirectory)
}

function pythonInstallArguments(
  words: readonly string[],
  executableAllowed: (executable: string, workingDirectory?: string) => boolean,
  workingDirectory?: string,
): readonly string[] | null {
  const executable = words[0] ?? ""
  if (
    executableAllowed(resolvedExecutable(executable, workingDirectory), workingDirectory) &&
    words[1] === "-m" &&
    words[2] === "pip" &&
    words[3] === "install"
  ) {
    return words.slice(4)
  }
  if (shellCommandName(executable) !== "uv") {
    return null
  }
  let pipIndex = 1
  while (words[pipIndex]?.startsWith("-")) {
    pipIndex += 1
  }
  if (words[pipIndex] !== "pip" || words[pipIndex + 1] !== "install") {
    return null
  }
  const installWords: string[] = []
  let targetExecutable: string | undefined
  for (let index = pipIndex + 2; index < words.length; index += 1) {
    const word = words[index] ?? ""
    if (word === "--python") {
      targetExecutable = words[index + 1]
      index += 1
      continue
    }
    if (word.startsWith("--python=")) {
      targetExecutable = word.slice("--python=".length)
      continue
    }
    installWords.push(word)
  }
  const resolvedTarget = targetExecutable ? resolvedExecutable(targetExecutable, workingDirectory) : undefined
  return resolvedTarget && executableAllowed(resolvedTarget, workingDirectory) ? installWords : null
}

function pythonEnvironmentBootstrapTarget(command: string): string | undefined {
  const parsed = shellWords(commandWithoutSafeDescriptorDuplication(command))
  if (!parsed?.length) {
    return undefined
  }
  const words = effectiveShellCommandWords(parsed)
  const executable = shellCommandName(words[0])
  if (!executable) {
    return undefined
  }
  let moduleIndex = 1
  if (executable === "py" && /^-3(?:\.[0-9]+)?$/u.test(words[moduleIndex] ?? "")) {
    moduleIndex += 1
  } else if (!/^python(?:3(?:\.[0-9]+)?)?$/u.test(executable)) {
    return undefined
  }
  return words[moduleIndex] === "-m" && words[moduleIndex + 1] === "venv" && words.length === moduleIndex + 3
    ? words[moduleIndex + 2]
    : undefined
}

function environmentTargetMatchesAllowedExecutable(
  environment: string,
  executableAllowed: (executable: string, workingDirectory?: string) => boolean,
  workingDirectory?: string,
): boolean {
  const resolvedEnvironment = resolvedDirectory(environment, workingDirectory).replace(/[\\/]+$/u, "")
  return [
    `${resolvedEnvironment}/bin/python`,
    `${resolvedEnvironment}/bin/python3`,
    `${resolvedEnvironment}/Scripts/python.exe`,
  ].some((executable) => executableAllowed(executable, workingDirectory))
}

function boundedPythonInstallCommand(
  command: string,
  executableAllowed: (executable: string, workingDirectory?: string) => boolean,
  directoryAllowed: (directory: string) => boolean,
): { body: string; directory?: string } | undefined {
  let body = command
  let directory: string | undefined
  const possibleCd = splitLeadingAnd(body)
  if (possibleCd) {
    const explicitDirectory = explicitCdDirectory(possibleCd.left)
    if (explicitDirectory) {
      if (!directoryAllowed(explicitDirectory) || !possibleCd.right) {
        return undefined
      }
      directory = explicitDirectory
      body = possibleCd.right
    }
  }

  const possibleBootstrap = splitLeadingAnd(body)
  if (possibleBootstrap) {
    const environment = pythonEnvironmentBootstrapTarget(possibleBootstrap.left)
    if (
      !environment ||
      !environmentTargetMatchesAllowedExecutable(environment, executableAllowed, directory) ||
      !possibleBootstrap.right
    ) {
      return undefined
    }
    body = possibleBootstrap.right
  }
  return { body, ...(directory ? { directory } : {}) }
}

function scopedPythonDependencyInstall(
  request: ChatPermissionRequest,
  executableAllowed: (executable: string, workingDirectory?: string) => boolean,
  directoryAllowed: (directory: string) => boolean = () => true,
): ManagedPythonDependencyInstall | null {
  if (permissionRequestKind(request) !== "command") {
    return null
  }
  const command = permissionCommand(request)
  if (!command) {
    return null
  }
  const boundedCommand = boundedPythonInstallCommand(command, executableAllowed, directoryAllowed)
  if (!boundedCommand) {
    return null
  }
  const body = commandWithoutSafeDescriptorDuplication(commandWithoutSafeOutputFilter(boundedCommand.body))
  if (hasUnsafeShellSyntax(body)) {
    return null
  }
  const words = shellWords(body)
  if (!words) {
    return null
  }
  const installWords = pythonInstallArguments(words, executableAllowed, boundedCommand.directory)
  const packages = installWords ? managedPythonPackageNames(installWords) : null
  return packages ? { packages } : null
}

/**
 * Recognizes direct PyPI requirements installed through Wanta's private per-task environment.
 * Source/scope overrides, requirements files, editable installs, paths, and URLs do not qualify.
 * Unfamiliar ordinary flags are not confirmation boundaries.
 */
export function managedPythonDependencyInstall(
  request: ChatPermissionRequest,
  processRoot?: string,
): ManagedPythonDependencyInstall | null {
  const allowedExecutables = processRoot
    ? new Set(managedPythonExecutables(processRoot).map(normalizedExecutable))
    : undefined
  return scopedPythonDependencyInstall(
    request,
    (executable) =>
      allowedExecutables
        ? allowedExecutables.has(normalizedExecutable(executable))
        : isManagedPythonExecutable(executable),
    processRoot
      ? (directory) =>
          normalizedExecutable(directory) === normalizedExecutable(processRoot) ||
          normalizedExecutable(directory) === normalizedExecutable(managedPythonEnvironmentPath(processRoot))
      : undefined,
  )
}

export function isTaskScopedPythonDependencyInstallRequest(
  request: ChatPermissionRequest,
  processRoot: string,
): boolean {
  return Boolean(managedPythonDependencyInstall(request, processRoot))
}

export function isProjectScopedPythonDependencyInstallRequest(
  request: ChatPermissionRequest,
  projectRoot: string,
): boolean {
  const allowedExecutables = new Set(projectPythonExecutables(projectRoot).map(normalizedExecutable))
  return Boolean(
    scopedPythonDependencyInstall(
      request,
      (executable) => allowedExecutables.has(normalizedExecutable(executable)),
      (directory) => normalizedExecutable(directory) === normalizedExecutable(projectRoot),
    ),
  )
}

export function isPythonDependencyPermissionRequest(request: ChatPermissionRequest): boolean {
  return (
    permissionRequestKind(request) === "command" &&
    Boolean(permissionCommand(request) && isPythonDependencyMutationCommand(permissionCommand(request) ?? ""))
  )
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
    containsSegmentSequence(segments, [".config", "google-chrome"]) ||
    containsSegmentSequence(segments, [".config", "chromium"]) ||
    containsSegmentSequence(segments, [".config", "bravesoftware", "brave-browser"]) ||
    containsSegmentSequence(segments, [".mozilla", "firefox"]) ||
    containsSegmentSequence(segments, ["appdata", "local", "google", "chrome", "user data"]) ||
    containsSegmentSequence(segments, ["appdata", "local", "microsoft", "edge", "user data"]) ||
    containsSegmentSequence(segments, ["appdata", "local", "bravesoftware", "brave-browser", "user data"]) ||
    containsSegmentSequence(segments, ["appdata", "roaming", "mozilla", "firefox"]) ||
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
