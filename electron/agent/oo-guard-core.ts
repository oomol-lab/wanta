const connectorCommandsRequiringWorkspace = new Set(["apps", "run"])
const connectorCommandsIgnoringWorkspace = new Set(["schema", "search"])
const sensitiveConnectorKeys = new Set([
  "access_token",
  "api_key",
  "api_token",
  "authorization",
  "client_secret",
  "cookie",
  "credential",
  "password",
  "personal_api_key",
  "refresh_token",
  "secret",
  "secret_api_token",
  "secret_api_token_backup",
])

function normalizedKey(value: string): string {
  return value
    .trim()
    .replace(/([A-Z]+)([A-Z][a-z])/gu, "$1_$2")
    .replace(/([a-z0-9])([A-Z])/gu, "$1_$2")
    .toLowerCase()
    .replaceAll("-", "_")
}

export function isSensitiveConnectorKey(value: string): boolean {
  const key = normalizedKey(value)
  if (sensitiveConnectorKeys.has(key)) return true
  return [...sensitiveConnectorKeys].some((sensitiveKey) => key.endsWith(`_${sensitiveKey}`))
}

function redactConnectorValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(redactConnectorValue)
  }
  if (!value || typeof value !== "object") {
    return value
  }
  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => [
      key,
      isSensitiveConnectorKey(key) ? "[redacted]" : redactConnectorValue(item),
    ]),
  )
}

const jsonFieldPattern = /("((?:\\.|[^"\\])*)"\s*:\s*)("(?:\\.|[^"\\])*"|[^,}\]\r\n]+)/gu
const sensitiveAssignmentPattern =
  /([A-Za-z][A-Za-z0-9_-]*)\s*[:=]\s*("(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|[^\s,;}\]]+)/gu

export function redactConnectorOutput(output: string): string {
  if (!output) return output
  const trailingNewline = output.endsWith("\n")
  try {
    const parsed = JSON.parse(output) as unknown
    const redacted = redactConnectorValue(parsed)
    if (JSON.stringify(redacted) === JSON.stringify(parsed)) return output
    return `${JSON.stringify(redacted)}${trailingNewline ? "\n" : ""}`
  } catch {
    return output
      .replace(jsonFieldPattern, (match, prefix: string, key: string) =>
        isSensitiveConnectorKey(key) ? `${prefix}"[redacted]"` : match,
      )
      .replace(sensitiveAssignmentPattern, (match, key: string) =>
        isSensitiveConnectorKey(key) ? `${key}=[redacted]` : match,
      )
  }
}

function connectorCommandIndex(args: readonly string[]): number {
  let index = 0
  while (index < args.length) {
    const arg = args[index] ?? ""
    if (arg === "--lang") {
      index += 2
      continue
    }
    if (arg.startsWith("--lang=") || ["--debug", "-h", "--help", "-V", "--version"].includes(arg)) {
      index += 1
      continue
    }
    break
  }
  return args[index] === "connector" ? index : -1
}

export function isConnectorBusinessCommand(args: readonly string[]): boolean {
  const connectorIndex = connectorCommandIndex(args)
  return connectorIndex >= 0 && connectorCommandsRequiringWorkspace.has(args[connectorIndex + 1] ?? "")
}

/** Commands exposed by the privileged external-agent OO execution boundary. */
export function isManagedExternalOoCommand(args: readonly string[]): boolean {
  const connectorIndex = connectorCommandIndex(args)
  if (connectorIndex < 0) return false
  const command = args[connectorIndex + 1] ?? ""
  return connectorCommandsRequiringWorkspace.has(command) || connectorCommandsIgnoringWorkspace.has(command)
}

export function hasWorkspaceSelector(args: readonly string[]): boolean {
  const connectorIndex = connectorCommandIndex(args)
  if (connectorIndex < 0) return false
  const terminatorIndex = args.indexOf("--", connectorIndex + 2)
  const commandArgs = args.slice(connectorIndex + 2, terminatorIndex < 0 ? undefined : terminatorIndex)
  return commandArgs.some(
    (arg) =>
      arg === "--personal" ||
      arg === "--team" ||
      arg.startsWith("--team=") ||
      arg === "--organization" ||
      arg.startsWith("--organization=") ||
      arg === "--org" ||
      arg.startsWith("--org="),
  )
}

export function bindOomolWorkspace(args: readonly string[], teamName: string): string[] {
  const normalizedTeamName = teamName.trim()
  if (!isConnectorBusinessCommand(args) || hasWorkspaceSelector(args)) {
    return [...args]
  }
  if (!normalizedTeamName) {
    throw new Error("Wanta cannot run an OOMOL connector command without an active team workspace.")
  }
  const terminatorIndex = args.indexOf("--")
  if (terminatorIndex < 0) return [...args, "--team", normalizedTeamName]
  return [...args.slice(0, terminatorIndex), "--team", normalizedTeamName, ...args.slice(terminatorIndex)]
}

function stripBusinessWorkspaceSelectors(args: readonly string[]): string[] {
  if (!isConnectorBusinessCommand(args)) return [...args]
  const connectorIndex = connectorCommandIndex(args)
  const commandArgsStart = connectorIndex + 2
  const terminatorIndex = args.indexOf("--", commandArgsStart)
  const commandArgsEnd = terminatorIndex < 0 ? args.length : terminatorIndex
  const normalized = args.slice(0, commandArgsStart)
  let index = commandArgsStart
  while (index < commandArgsEnd) {
    const arg = args[index] ?? ""
    if (["--team", "--organization", "--org"].includes(arg)) {
      const nextArg = args[index + 1]
      index += nextArg === undefined || nextArg === "--" || nextArg.startsWith("-") ? 1 : 2
      continue
    }
    if (
      arg === "--personal" ||
      arg.startsWith("--team=") ||
      arg.startsWith("--organization=") ||
      arg.startsWith("--org=")
    ) {
      index += 1
      continue
    }
    normalized.push(arg)
    index += 1
  }
  if (terminatorIndex >= 0) normalized.push(...args.slice(terminatorIndex))
  return normalized
}

/** Bind the shared external OO shim only from currently running Wanta turns. */
export function bindExternalConnectorWorkspace(args: readonly string[], scope: WorkspaceTeamScope): string[] {
  if (!isConnectorBusinessCommand(args)) return [...args]
  const runtime = resolveExternalGuardRuntime(scope)
  if (runtime === "openconnector") return stripBusinessWorkspaceSelectors(args)
  if (runtime !== "oomol") {
    throw new Error("Wanta cannot run an external connector command without an active Link runtime.")
  }
  return bindOomolWorkspace(stripBusinessWorkspaceSelectors(args), resolveExternalGuardWorkspaceTeam(scope))
}

/**
 * Schema/search are provider-contract discovery operations, not workspace
 * business calls. Agents sometimes over-generalize the apps/run team rule and
 * append a selector that these CLI subcommands do not accept. Normalize that
 * deterministic transport detail in the managed shim instead of making the
 * model recover from an avoidable parse error.
 */
export function stripIdentityIndependentWorkspaceSelectors(args: readonly string[]): string[] {
  const connectorIndex = connectorCommandIndex(args)
  if (connectorIndex < 0 || !connectorCommandsIgnoringWorkspace.has(args[connectorIndex + 1] ?? "")) {
    return [...args]
  }
  const commandArgsStart = connectorIndex + 2
  const terminatorIndex = args.indexOf("--", commandArgsStart)
  const commandArgsEnd = terminatorIndex < 0 ? args.length : terminatorIndex
  const normalized = args.slice(0, commandArgsStart)
  let index = commandArgsStart
  while (index < commandArgsEnd) {
    const arg = args[index] ?? ""
    if (["--team", "--organization", "--org"].includes(arg)) {
      const nextArg = args[index + 1]
      index += nextArg === undefined || nextArg === "--" || nextArg.startsWith("-") ? 1 : 2
      continue
    }
    if (
      arg === "--personal" ||
      arg.startsWith("--team=") ||
      arg.startsWith("--organization=") ||
      arg.startsWith("--org=")
    ) {
      index += 1
      continue
    }
    normalized.push(arg)
    index += 1
  }
  if (terminatorIndex >= 0) normalized.push(...args.slice(terminatorIndex))
  return normalized
}

export interface WorkspaceTeamScope {
  external?: unknown
  runtime?: unknown
  teamName?: unknown
  sessionTeams?: unknown
  sessionRuntimes?: unknown
}

function resolveExternalGuardRuntime(scope: WorkspaceTeamScope): "oomol" | "openconnector" {
  if (!scope.sessionRuntimes || typeof scope.sessionRuntimes !== "object") {
    throw new Error("Wanta cannot run an external connector command without a running Link-scoped turn.")
  }
  const activeRuntimes = Object.values(scope.sessionRuntimes)
  if (
    activeRuntimes.length === 0 ||
    activeRuntimes.some((runtime) => runtime !== "oomol" && runtime !== "openconnector")
  ) {
    throw new Error("Wanta cannot run an external connector command without a running Link-scoped turn.")
  }
  const uniqueRuntimes = new Set(activeRuntimes)
  if (uniqueRuntimes.size !== 1 || !uniqueRuntimes.has(scope.runtime)) {
    throw new Error("Wanta cannot route external connector commands across a Link runtime change.")
  }
  return activeRuntimes[0] as "oomol" | "openconnector"
}

/** External commands have no process-local session id, so every running turn must agree. */
export function resolveExternalGuardWorkspaceTeam(scope: WorkspaceTeamScope): string {
  if (!scope.sessionTeams || typeof scope.sessionTeams !== "object") {
    throw new Error("Wanta cannot run an external OOMOL connector command without a running team-scoped turn.")
  }
  const activeTeams = Object.values(scope.sessionTeams).map((value) => (typeof value === "string" ? value.trim() : ""))
  if (activeTeams.length === 0 || activeTeams.some((teamName) => !teamName)) {
    throw new Error("Wanta cannot run an external OOMOL connector command without a running team-scoped turn.")
  }
  const uniqueTeams = new Set(activeTeams)
  if (uniqueTeams.size !== 1) {
    throw new Error("Wanta cannot route external OOMOL connector commands while running turns use different teams.")
  }
  return activeTeams[0] ?? ""
}

/** Resolve a bare CLI call only when every active session agrees on its workspace. */
export function resolveGuardWorkspaceTeam(scope: WorkspaceTeamScope): string {
  if (scope.sessionTeams && typeof scope.sessionTeams === "object") {
    const activeTeams = Object.values(scope.sessionTeams)
      .filter((value): value is string => typeof value === "string")
      .map((value) => value.trim())
      .filter(Boolean)
    if (activeTeams.length > 0) {
      const uniqueTeams = new Set(activeTeams)
      if (uniqueTeams.size > 1) {
        throw new Error(
          "Wanta cannot safely route a bare OOMOL connector command while active sessions use different workspaces.",
        )
      }
      return activeTeams[0] ?? ""
    }
  }
  return typeof scope.teamName === "string" ? scope.teamName.trim() : ""
}
