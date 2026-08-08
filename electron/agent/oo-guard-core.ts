const connectorCommandsRequiringWorkspace = new Set(["apps", "run"])
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
    .replace(/([a-z0-9])([A-Z])/gu, "$1_$2")
    .toLowerCase()
    .replaceAll("-", "_")
}

export function isSensitiveConnectorKey(value: string): boolean {
  return sensitiveConnectorKeys.has(normalizedKey(value))
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

const sensitiveJsonFieldPattern =
  /("(?:access[_-]?token|api[_-]?key|api[_-]?token|authorization|client[_-]?secret|cookie|credential|password|personal[_-]?api[_-]?key|refresh[_-]?token|secret|secret[_-]?api[_-]?token(?:[_-]?backup)?)"\s*:\s*)("(?:\\.|[^"\\])*"|[^,}\]\r\n]+)/giu
const sensitiveAssignmentPattern =
  /\b(access[_-]?token|api[_-]?key|api[_-]?token|authorization|client[_-]?secret|cookie|credential|password|personal[_-]?api[_-]?key|refresh[_-]?token|secret|secret[_-]?api[_-]?token(?:[_-]?backup)?)\s*[:=]\s*("(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|[^\s,;}\]]+)/giu

export function redactConnectorOutput(output: string): string {
  if (!output) return output
  const trailingNewline = output.endsWith("\n")
  try {
    const parsed = JSON.parse(output) as unknown
    return `${JSON.stringify(redactConnectorValue(parsed))}${trailingNewline ? "\n" : ""}`
  } catch {
    return output
      .replace(sensitiveJsonFieldPattern, '$1"[redacted]"')
      .replace(sensitiveAssignmentPattern, "$1=[redacted]")
  }
}

export function isConnectorBusinessCommand(args: readonly string[]): boolean {
  return args[0] === "connector" && connectorCommandsRequiringWorkspace.has(args[1] ?? "")
}

export function hasWorkspaceSelector(args: readonly string[]): boolean {
  return args.some(
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
  return [...args, "--team", normalizedTeamName]
}

export interface WorkspaceTeamScope {
  teamName?: unknown
  sessionTeams?: unknown
}

/** Resolve a bare CLI call only when every active session agrees on its workspace. */
export function resolveGuardWorkspaceTeam(scope: WorkspaceTeamScope): string {
  if (scope.sessionTeams && typeof scope.sessionTeams === "object") {
    const activeTeams = Object.values(scope.sessionTeams)
      .filter((value): value is string => typeof value === "string")
      .map((value) => value.trim())
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
