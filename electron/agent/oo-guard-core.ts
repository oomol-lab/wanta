import { realpathSync } from "node:fs"
import path from "node:path"
import { externalOoRootCommandIndex, resolveExternalOoOperation } from "./external/oo-capability-contract.ts"

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
  const index = externalOoRootCommandIndex(args)
  return args[index] === "connector" ? index : -1
}

export function isConnectorBusinessCommand(args: readonly string[]): boolean {
  const operation = resolveExternalOoOperation(args)
  return operation?.id.startsWith("connector.") === true && operation.workspace === "required"
}

/** Commands exposed by the privileged external-agent OO execution boundary. */
export function isManagedExternalOoCommand(args: readonly string[]): boolean {
  return resolveExternalOoOperation(args)?.availability === "enabled"
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
  const operation = resolveExternalOoOperation(args)
  const connectorIndex = connectorCommandIndex(args)
  if (connectorIndex < 0 || operation?.workspace !== "none") {
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
  /** Per-running-turn roots from which the shared guard may inherit a cwd. */
  sessionCwdRoots?: unknown
}

export interface ExternalGuardCwdBinding {
  cwd: string
  sessionId: string
}

/**
 * The external OO shim carries the native shell cwd over loopback. It must
 * remain inside a root Wanta registered for a currently running turn: the
 * guard credential is process-scoped, so accepting an arbitrary cwd would
 * turn this otherwise narrow connector boundary into a filesystem probe.
 */
export function resolveExternalGuardCwd(scope: WorkspaceTeamScope, cwd: unknown): string {
  return resolveExternalGuardCwdBinding(scope, cwd).cwd
}

/**
 * A shared external-agent bridge cannot trust an agent-provided session id.
 * Bind each invocation to exactly one running session by the canonical cwd it
 * inherited from that session's own managed roots. Overlapping roots fail
 * closed rather than letting one external turn select another turn's team.
 */
export function resolveExternalGuardCwdBinding(scope: WorkspaceTeamScope, cwd: unknown): ExternalGuardCwdBinding {
  if (typeof cwd !== "string" || !cwd.trim() || !path.isAbsolute(cwd)) {
    throw new Error("Wanta cannot run an external connector command without an absolute managed working directory.")
  }
  if (!scope.sessionCwdRoots || typeof scope.sessionCwdRoots !== "object") {
    throw new Error("Wanta cannot run an external connector command without a running managed working directory.")
  }
  const candidate = canonicalManagedPath(cwd, "working directory")
  const matchingSessionIds = new Set<string>()
  for (const [sessionId, rawRoots] of Object.entries(scope.sessionCwdRoots)) {
    if (!Array.isArray(rawRoots)) continue
    for (const rawRoot of rawRoots) {
      if (typeof rawRoot !== "string" || !path.isAbsolute(rawRoot)) continue
      const root = canonicalManagedPath(rawRoot, "managed working directory root")
      if (candidate === root || candidate.startsWith(`${root}${path.sep}`)) {
        matchingSessionIds.add(sessionId)
      }
    }
  }
  if (matchingSessionIds.size === 0) {
    throw new Error(
      "Wanta refused an external connector command outside the active turn's managed working directories.",
    )
  }
  if (matchingSessionIds.size !== 1) {
    throw new Error("Wanta cannot route an external connector command from a working directory shared by active turns.")
  }
  return { cwd: candidate, sessionId: [...matchingSessionIds][0]! }
}

/** Keep workspace binding scoped to the sole session that owns the canonical cwd. */
export function externalGuardSessionScope(scope: WorkspaceTeamScope, sessionId: string): WorkspaceTeamScope {
  const runtime = sessionValue(scope.sessionRuntimes, sessionId, "Link runtime")
  const teamName = sessionValue(scope.sessionTeams, sessionId, "team workspace")
  const cwdRoots = sessionValue(scope.sessionCwdRoots, sessionId, "managed working directory roots")
  return {
    external: true,
    runtime: scope.runtime,
    sessionCwdRoots: { [sessionId]: cwdRoots },
    sessionRuntimes: { [sessionId]: runtime },
    sessionTeams: { [sessionId]: teamName },
  }
}

function sessionValue(value: unknown, sessionId: string, label: string): unknown {
  if (!value || typeof value !== "object" || !Object.hasOwn(value, sessionId)) {
    throw new Error(`Wanta cannot run an external connector command without the owning session's ${label}.`)
  }
  return (value as Record<string, unknown>)[sessionId]
}

function canonicalManagedPath(value: string, label: string): string {
  try {
    return realpathSync.native(path.resolve(value))
  } catch {
    throw new Error(`Wanta cannot resolve the external connector command ${label}.`)
  }
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
