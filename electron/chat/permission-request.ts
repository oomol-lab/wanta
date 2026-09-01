import type { ChatPermissionRequest } from "./common.ts"

import { openConnectorCommandPolicy } from "../agent/oo-command-permission.ts"
import {
  isManagedPythonExecutable,
  isManagedPythonPipExecutable,
  managedPythonEnvironmentPath,
  managedPythonExecutables,
  managedPythonPipExecutables,
  projectPythonExecutables,
  projectPythonPipExecutables,
} from "../agent/python-environment.ts"
import { commandRequiresConfirmation } from "./command-risk.ts"
import {
  dependencyCommandRequiresConfirmation,
  isDependencyMutationCommand,
  isPythonDependencyMutationCommand,
} from "./dependency-policy.ts"
import {
  commandWithoutHereDocumentBodies,
  commandWithoutInertOutputSuffixes,
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
export type SessionPermissionGrantKind = "project_dev_command" | "python_dependency_install" | "request"

export interface SessionPermissionGrant {
  action: string
  generationId?: string
  kind?: SessionPermissionGrantKind
  patterns: string[]
  projectRoot?: string
  processRoot?: string
}

export interface PermissionScopeContext {
  commandCwd?: string
  trustedProjectRoot?: string
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
  // Native adapters expose command inputs under different metadata keys:
  // Claude currently contributes the command as a salient resource, while
  // ACP agents commonly retain the protocol payload as rawInput. Normalize
  // both shapes here so the shared policy never depends on the selected agent.
  for (const input of [request.metadata?.toolInput, request.metadata?.rawInput]) {
    if (input !== null && typeof input === "object" && !Array.isArray(input)) {
      const nestedCommand = (input as { command?: unknown }).command
      if (typeof nestedCommand === "string" && nestedCommand.trim()) {
        return nestedCommand.trim()
      }
    }
  }
  return permissionPrimaryResource(request)
}

function nestedRecord(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined
}

function cwdFromRecord(record: Record<string, unknown> | undefined): string | undefined {
  if (!record) {
    return undefined
  }
  for (const key of ["cwd", "workingDirectory", "working_directory"]) {
    const value = record[key]
    if (typeof value !== "string" || !value.trim()) {
      continue
    }
    const cwd = value.trim()
    if (cwd.startsWith("/") || /^[A-Za-z]:[\\/]/u.test(cwd)) {
      return cwd
    }
  }
  return undefined
}

/**
 * Host-proven working directory carried on the permission request. OpenCode's
 * sidecar cwd is a private workspace and is not implied here; only an explicit
 * metadata cwd or an ACP session cwd is trustworthy.
 */
export function permissionRequestWorkingDirectory(request: ChatPermissionRequest): string | undefined {
  const metadata = request.metadata
  if (!metadata) {
    return undefined
  }
  return (
    cwdFromRecord(metadata) ??
    cwdFromRecord(nestedRecord(metadata.toolInput)) ??
    cwdFromRecord(nestedRecord(metadata.rawInput))
  )
}

/**
 * ACP agents ask before dispatching MCP tools even when the server is a
 * Wanta-owned, loopback-only capability server. The ACP adapter adds this
 * marker only after matching the call against the concrete host MCP servers
 * registered for that session; agent-supplied raw input is never proof of
 * ownership. Those calls already crossed the built-in host capability policy,
 * so a second runtime approval prompt is redundant.
 */
export function isWantaHostToolPermissionRequest(request: ChatPermissionRequest): boolean {
  return typeof request.metadata?.wantaHostTool === "string" && request.metadata.wantaHostTool.length > 0
}

function commandText(request: ChatPermissionRequest): string {
  return (permissionCommand(request) ?? request.resources.join(" ")).trim()
}

const HIGH_RISK_ENV_PATH_PATTERN = /(^|[\s"'=])(?:\.\/)?\.env(?:\.[^\s"';&|<>/]*)?(?=$|[\s"';&|<>])/i
const HIGH_RISK_COMMAND_PATH_PATTERNS: readonly RegExp[] = [
  /(^|[\s"'=])(?:~|\$HOME)\/(?:\.ssh|\.aws|\.gnupg|\.config\/gh)(?:\/|[\s"';&|<>]|$)/i,
  /(^|[\s"'=])\/Users\/[^/\s"']+\/(?:\.ssh|\.aws|\.gnupg|\.config\/gh)(?:\/|[\s"';&|<>]|$)/i,
  HIGH_RISK_ENV_PATH_PATTERN,
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
    hasUnresolvedShellExpansion(candidate) ||
    isHomeReferencePath(candidate) ||
    /^[A-Za-z]:[\\/]/u.test(candidate) ||
    candidate.startsWith("/") ||
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

export function permissionRequestAccessResources(request: ChatPermissionRequest): string[] {
  const values = [...request.resources, ...(request.save ?? [])].map((value) => value.trim()).filter(Boolean)
  if (permissionRequestKind(request) !== "command") {
    return values
  }
  return [...new Set([...values, ...commandAccessResources(commandText(request))])]
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

export function isHighRiskPermissionRequest(
  request: ChatPermissionRequest,
  scope: PermissionScopeContext = {},
): boolean {
  if (permissionRequestKind(request) !== "command") {
    return false
  }
  const command = commandText(request)
  if (!command) {
    return false
  }
  const shellControlText = commandWithoutHereDocumentBodies(command)
  return (
    dependencyCommandRequiresConfirmation(shellControlText) ||
    commandRequiresConfirmation(shellControlText) ||
    HIGH_RISK_COMMAND_PATH_PATTERNS.filter((pattern) => pattern !== HIGH_RISK_ENV_PATH_PATTERN).some((pattern) =>
      pattern.test(shellControlText),
    ) ||
    (HIGH_RISK_ENV_PATH_PATTERN.test(shellControlText) &&
      !commandEnvAccessesAreSelectedProject(shellControlText, scope))
  )
}

export function isOoCliPermissionRequest(request: ChatPermissionRequest): boolean {
  if (permissionRequestKind(request) !== "command") {
    return false
  }
  // Agents routinely cap connector output with head/tail or merge stderr.
  // These suffixes do not broaden what `oo` executes. Strip only the bounded,
  // shared safe forms before applying the strict single-command classifier;
  // arbitrary pipes, sequences, substitutions, and file redirects still fail.
  const normalized = commandWithoutSafeDescriptorDuplication(commandWithoutSafeOutputFilter(commandText(request)))
  return openConnectorCommandPolicy(normalized) === "allow"
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
  "--build-constraint",
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
  "--requirements-from-script",
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
  pipExecutableAllowed: (executable: string, workingDirectory?: string) => boolean,
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
  if (
    pipExecutableAllowed(resolvedExecutable(executable, workingDirectory), workingDirectory) &&
    words[1] === "install"
  ) {
    return words.slice(2)
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
  implicitWorkingDirectory?: string,
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
      !environmentTargetMatchesAllowedExecutable(
        environment,
        executableAllowed,
        directory ?? implicitWorkingDirectory,
      ) ||
      !possibleBootstrap.right
    ) {
      return undefined
    }
    body = possibleBootstrap.right
  }
  const workingDirectory = directory ?? implicitWorkingDirectory
  if (workingDirectory && !directoryAllowed(workingDirectory)) {
    return undefined
  }
  return { body: commandWithoutInertOutputSuffixes(body), ...(workingDirectory ? { directory: workingDirectory } : {}) }
}

function scopedPythonDependencyInstall(
  request: ChatPermissionRequest,
  executableAllowed: (executable: string, workingDirectory?: string) => boolean,
  pipExecutableAllowed: (executable: string, workingDirectory?: string) => boolean,
  directoryAllowed: (directory: string) => boolean = () => true,
  implicitWorkingDirectory?: string,
): ManagedPythonDependencyInstall | null {
  if (permissionRequestKind(request) !== "command") {
    return null
  }
  const command = permissionCommand(request)
  if (!command) {
    return null
  }
  const boundedCommand = boundedPythonInstallCommand(
    command,
    executableAllowed,
    directoryAllowed,
    implicitWorkingDirectory,
  )
  if (!boundedCommand) {
    return null
  }
  const body = commandWithoutInertOutputSuffixes(boundedCommand.body)
  if (hasUnsafeShellSyntax(body)) {
    return null
  }
  const words = shellWords(body)
  if (!words) {
    return null
  }
  const installWords = pythonInstallArguments(words, executableAllowed, pipExecutableAllowed, boundedCommand.directory)
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
  implicitWorkingDirectory?: string,
): ManagedPythonDependencyInstall | null {
  const allowedExecutables = processRoot
    ? new Set(managedPythonExecutables(processRoot).map(normalizedExecutable))
    : undefined
  const allowedPipExecutables = processRoot
    ? new Set(managedPythonPipExecutables(processRoot).map(normalizedExecutable))
    : undefined
  return scopedPythonDependencyInstall(
    request,
    (executable) =>
      allowedExecutables
        ? allowedExecutables.has(normalizedExecutable(executable))
        : isManagedPythonExecutable(executable),
    (executable) =>
      allowedPipExecutables
        ? allowedPipExecutables.has(normalizedExecutable(executable))
        : isManagedPythonPipExecutable(executable),
    processRoot
      ? (directory) =>
          normalizedExecutable(directory) === normalizedExecutable(processRoot) ||
          normalizedExecutable(directory) === normalizedExecutable(managedPythonEnvironmentPath(processRoot))
      : undefined,
    implicitWorkingDirectory,
  )
}

export function isTaskScopedPythonDependencyInstallRequest(
  request: ChatPermissionRequest,
  processRoot: string,
  implicitWorkingDirectory?: string,
): boolean {
  return Boolean(managedPythonDependencyInstall(request, processRoot, implicitWorkingDirectory))
}

export function isProjectScopedPythonDependencyInstallRequest(
  request: ChatPermissionRequest,
  projectRoot: string,
  implicitWorkingDirectory?: string,
): boolean {
  const allowedExecutables = new Set(projectPythonExecutables(projectRoot).map(normalizedExecutable))
  const allowedPipExecutables = new Set(projectPythonPipExecutables(projectRoot).map(normalizedExecutable))
  return Boolean(
    scopedPythonDependencyInstall(
      request,
      (executable) => allowedExecutables.has(normalizedExecutable(executable)),
      (executable) => allowedPipExecutables.has(normalizedExecutable(executable)),
      (directory) => normalizedExecutable(directory) === normalizedExecutable(projectRoot),
      implicitWorkingDirectory,
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

function isDotEnvBasename(basename: string): boolean {
  return basename === ".env" || basename.startsWith(".env.")
}

function isSensitiveResource(resource: string): boolean {
  const basename = resourceBasename(resource)
  if (
    isDotEnvBasename(basename) ||
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

function isAbsoluteLocalPath(value: string): boolean {
  return value.startsWith("/") || /^[A-Za-z]:\//u.test(value)
}

function collapsePathSegments(value: string): string | undefined {
  const windowsRoot = /^[A-Za-z]:\//u.exec(value)?.[0]
  const root = windowsRoot ?? (value.startsWith("/") ? "/" : "")
  if (!root) {
    return undefined
  }
  const rest = windowsRoot ? value.slice(windowsRoot.length) : value.slice(1)
  const resolved: string[] = []
  for (const segment of rest.split("/")) {
    if (!segment || segment === ".") {
      continue
    }
    if (segment === "..") {
      if (resolved.length === 0) {
        return undefined
      }
      resolved.pop()
      continue
    }
    resolved.push(segment)
  }
  if (windowsRoot) {
    return resolved.length === 0 ? windowsRoot.replace(/\/$/u, "") : `${windowsRoot}${resolved.join("/")}`
  }
  return `/${resolved.join("/")}`
}

function isHomeReferencePath(value: string): boolean {
  return /^(?:~|\$HOME|\$\{HOME\})(?:\/|$)/iu.test(value)
}

function hasUnresolvedShellExpansion(value: string): boolean {
  return value.startsWith("~") || /[$`]/u.test(value)
}

function resolveScopedResourcePath(resource: string, workingDirectory?: string): string | undefined {
  const trimmed = normalizeResourceText(resource)
  if (!trimmed || isHomeReferencePath(trimmed) || hasUnresolvedShellExpansion(trimmed)) {
    return undefined
  }
  if (isAbsoluteLocalPath(trimmed)) {
    return collapsePathSegments(trimmed)
  }
  if (!workingDirectory) {
    return undefined
  }
  const base = collapsePathSegments(normalizeResourceText(workingDirectory))
  if (!base) {
    return undefined
  }
  return collapsePathSegments(`${base}/${trimmed}`)
}

function scopedResourceInsideProjectRoot(target: string, projectRoot: string): boolean {
  const normalizedRoot = collapsePathSegments(normalizeResourceText(projectRoot))
  const normalizedTarget = collapsePathSegments(normalizeResourceText(target))
  return Boolean(
    normalizedRoot &&
    normalizedTarget &&
    (normalizedTarget === normalizedRoot || normalizedTarget.startsWith(`${normalizedRoot}/`)),
  )
}

export function isSelectedProjectEnvResource(resource: string, scope: PermissionScopeContext = {}): boolean {
  if (!isDotEnvBasename(resourceBasename(resource))) {
    return false
  }
  const projectRoot = scope.trustedProjectRoot
  if (!projectRoot) {
    return false
  }
  const target = resolveScopedResourcePath(resource, scope.commandCwd)
  return Boolean(target && scopedResourceInsideProjectRoot(target, projectRoot))
}

function commandScopeWithLeadingCd(command: string, scope: PermissionScopeContext): PermissionScopeContext {
  const leading = splitLeadingAnd(command)
  const directory = leading ? explicitCdDirectory(leading.left) : undefined
  if (!directory) {
    return scope
  }
  const resolved = resolveScopedResourcePath(directory, scope.commandCwd)
  // An unexpanded `cd` target is not proof we stayed in the previous cwd.
  return resolved ? { ...scope, commandCwd: resolved } : { ...scope, commandCwd: undefined }
}

const attachedWriteRedirectPattern = /^(?:[0-9]*)(?:>>?|>\|)(.*)$/u
const combinedWriteRedirectPattern = /^(?:&>>?)(.*)$/u

function writeRedirectDestinations(words: readonly string[]): string[] {
  const destinations: string[] = []
  for (let index = 0; index < words.length; index += 1) {
    const word = words[index] ?? ""
    const match = combinedWriteRedirectPattern.exec(word) ?? attachedWriteRedirectPattern.exec(word)
    if (!match) {
      continue
    }
    const attached = (match[1] ?? "").trim()
    if (attached.startsWith("&")) {
      continue
    }
    if (attached) {
      destinations.push(pathValue(attached))
      continue
    }
    const next = words[index + 1]
    if (next && !next.startsWith("&")) {
      destinations.push(pathValue(next))
      index += 1
    }
  }
  return destinations
}

function inPlaceEditDestinations(words: readonly string[]): string[] {
  const name = shellCommandName(words[0])
  if (name !== "sed" && name !== "perl") {
    return []
  }
  const inPlace = words.slice(1).some((word) => {
    if (word === "--") {
      return false
    }
    return (
      word === "-i" ||
      word.startsWith("-i") ||
      word === "-pi" ||
      word.startsWith("-pi") ||
      word === "--in-place" ||
      word.startsWith("--in-place=")
    )
  })
  if (!inPlace) {
    return []
  }
  const destinations: string[] = []
  let optionsEnded = false
  for (const word of words.slice(1)) {
    if (!optionsEnded && word === "--") {
      optionsEnded = true
      continue
    }
    if (!optionsEnded && word.startsWith("-")) {
      continue
    }
    destinations.push(pathValue(word))
  }
  return destinations
}

function commandWriteDestinations(command: string, depth = 0): string[] {
  return topLevelShellSegments(command).flatMap(({ text }) => {
    const parsed = shellWords(text)
    if (!parsed?.length) {
      return []
    }
    const destinations = writeRedirectDestinations(parsed)
    const words = effectiveShellCommandWords(parsed)
    const name = shellCommandName(words[0])
    if (name === "tee") {
      for (const word of words.slice(1)) {
        if (word === "--" || word.startsWith("-")) {
          continue
        }
        destinations.push(pathValue(word))
      }
    }
    if (name === "cp" || name === "mv") {
      const operands = words.slice(1).filter((word) => word !== "--" && !word.startsWith("-"))
      const destination = operands.at(-1)
      if (destination) {
        destinations.push(pathValue(destination))
      }
    }
    destinations.push(...inPlaceEditDestinations(words))
    const nested = depth < 2 ? nestedShellCommand(words) : undefined
    return nested ? [...destinations, ...commandWriteDestinations(nested, depth + 1)] : destinations
  })
}

function commandEnvAccessesAreSelectedProject(command: string, scope: PermissionScopeContext): boolean {
  if (!scope.trustedProjectRoot) {
    return false
  }
  const commandScope = commandScopeWithLeadingCd(command, scope)
  const resources = [
    ...commandAccessResources(command),
    ...(shellWords(commandWithoutHereDocumentBodies(command))?.filter((word) =>
      isDotEnvBasename(resourceBasename(word)),
    ) ?? []),
  ]
  const unique = [...new Set(resources.map((resource) => resource.trim()).filter(Boolean))]
  if (unique.length === 0) {
    return false
  }
  return unique.every((resource) => isSelectedProjectEnvResource(resource, commandScope))
}

function commandWritesSelectedProjectEnv(command: string, scope: PermissionScopeContext): boolean {
  const body = commandWithoutHereDocumentBodies(command)
  const writeScope = commandScopeWithLeadingCd(body, scope)
  return commandWriteDestinations(body).some((destination) => isSelectedProjectEnvResource(destination, writeScope))
}

export function permissionRequestIsSelectedProjectEnvWrite(
  request: ChatPermissionRequest,
  scope: PermissionScopeContext = {},
): boolean {
  if (!scope.trustedProjectRoot) {
    return false
  }
  const kind = permissionRequestKind(request)
  if (kind === "edit") {
    const resources = [...request.resources, ...(request.save ?? [])].filter((value) => value.trim())
    return resources.length > 0 && resources.every((resource) => isSelectedProjectEnvResource(resource, scope))
  }
  if (kind === "command") {
    return commandWritesSelectedProjectEnv(commandText(request), scope)
  }
  return false
}

export function permissionRequestHasSensitiveResource(
  request: ChatPermissionRequest,
  scope: PermissionScopeContext = {},
): boolean {
  const values = [...request.resources, ...(request.save ?? [])].filter((value) => value.trim())
  if (values.some((resource) => isSensitiveResource(resource) && !isSelectedProjectEnvResource(resource, scope))) {
    return true
  }
  if (permissionRequestKind(request) !== "command") {
    return false
  }
  const command = commandText(request)
  return (
    commandAccessResources(command).some(
      (resource) => isSensitiveResource(resource) && !isSelectedProjectEnvResource(resource, scope),
    ) || SENSITIVE_COMMAND_RESOURCE_PATTERN.test(commandWithoutHereDocumentBodies(command))
  )
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

export function permissionRequestNeedsDefaultPrompt(
  request: ChatPermissionRequest,
  scope: PermissionScopeContext = {},
): boolean {
  if (isHighRiskPermissionRequest(request, scope)) {
    return true
  }
  if (permissionRequestHasSensitiveResource(request, scope)) {
    return true
  }
  const kind = permissionRequestKind(request)
  if (kind === "network") {
    return false
  }
  if (kind === "command") {
    const command = commandWithoutHereDocumentBodies(commandText(request))
    return isDependencyMutationCommand(command)
  }
  // Broad non-sensitive reads are consequence-free. Keep confirmation for edits whose requested
  // scope is itself a home/system root; destructive shell commands are already gated above.
  return kind === "edit" && permissionRequestHasBroadResource(request)
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
