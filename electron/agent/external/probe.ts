import type { AcpAgentRegistration } from "../acp/registry.ts"
import type { AgentAuthMode, ExternalAgentKind } from "../contract/profile.ts"
import type {
  ExternalAgentBinaryProbe,
  ExternalAgentCatalog,
  ExternalAgentLoginProbe,
  ExternalAgentRuntimeStatus,
} from "./status.ts"

import { execFile } from "node:child_process"
import { readFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { promisify } from "node:util"
import { detectCliExecutable, pathExists } from "../../agents/catalog.ts"
import { resolveUserCommandPath } from "../../command-path.ts"
import { errorMessage, logDiagnosticOnChange } from "../../diagnostics-log.ts"
import { ACP_AGENT_REGISTRY } from "../acp/registry.ts"
import { AGENT_PROFILES, agentLoginHint } from "../contract/profile.ts"
import { externalExecutableNeedsShell } from "./executable.ts"

// BYOA runtime probing: binary detection (PATH scan + --version verification)
// and best-effort login-state detection, exposed to the UI as a resource.
// Login probing is fail-open by design: only an explicit "logged_out" should
// drive login guidance; "unknown" must never block using an agent — the agent
// itself remains the authority when a session actually starts.

const execFileAsync = promisify(execFile)

const versionProbeTimeoutMs = 5_000

export type { ExternalAgentBinaryProbe, ExternalAgentLoginProbe, ExternalAgentRuntimeStatus } from "./status.ts"

export interface ExternalAgentProbeOptions {
  env?: NodeJS.ProcessEnv
  homeDirectory?: string
  /** Extra directories searched before PATH (dev node_modules/.bin, bundled Resources/bin). */
  extraBinDirectories?: readonly string[]
}

export function shouldProbeExternalAgentLogin(auth: AgentAuthMode, binary: ExternalAgentBinaryProbe): boolean {
  return auth.kind === "agent-cli" && binary.status === "detected"
}

export type ExternalAgentRuntimeDependencyProbe =
  | { status: "not_required" }
  | { status: "detected"; path: string }
  | { status: "not_found"; message: string }

/** Verify the native CLI delegated to by a packaged ACP bridge. */
export async function probeRegisteredRuntime(
  registration: AcpAgentRegistration,
  pathEnv: string,
  options: ExternalAgentProbeOptions = {},
): Promise<ExternalAgentRuntimeDependencyProbe> {
  const runtime = registration.runtimeExecutable
  if (!runtime) return { status: "not_required" }
  const env = options.env ?? process.env
  const configuredPath = env[runtime.envVar]?.trim()
  const commands = configuredPath ? [configuredPath] : runtime.cliCommands
  const detected = await detectCliExecutable(commands, {
    env,
    homeDirectory: options.homeDirectory,
    pathEnv,
  })
  if (detected) return { status: "detected", path: detected.executablePath }
  return {
    status: "not_found",
    message: `${registration.displayName} ACP bridge is installed, but its native CLI is missing. Install ${runtime.cliCommands[0] ?? registration.displayName} or set ${runtime.envVar} to a valid executable path.`,
  }
}

async function probeCommandPath(options: ExternalAgentProbeOptions): Promise<string> {
  const env = options.env ?? process.env
  const base = await resolveUserCommandPath({ env, homeDirectory: options.homeDirectory })
  const extras = (options.extraBinDirectories ?? []).filter(Boolean)
  return extras.length > 0 ? `${extras.join(path.delimiter)}${path.delimiter}${base}` : base
}

async function probeBinary(
  commands: readonly string[],
  versionArgs: readonly string[],
  options: ExternalAgentProbeOptions,
  pathEnv: string,
): Promise<ExternalAgentBinaryProbe> {
  const env = options.env ?? process.env
  const detected = await detectCliExecutable(commands, {
    env,
    homeDirectory: options.homeDirectory,
    pathEnv,
  })
  if (!detected) {
    return { status: "not_found" }
  }
  try {
    const { stdout } = await execFileAsync(detected.executablePath, [...versionArgs], {
      timeout: versionProbeTimeoutMs,
      maxBuffer: 64 * 1024,
      env: { ...env, PATH: pathEnv, WANTA_NODE_RUNTIME: process.execPath },
      shell: externalExecutableNeedsShell(detected.executablePath),
    })
    const firstLine = stdout
      .split(/\r?\n/u)
      .map((line) => line.trim())
      .find(Boolean)
    const version = firstLine?.match(/\d+\.\d+[\w.-]*/u)?.[0] ?? firstLine
    return { status: "detected", path: detected.executablePath, ...(version ? { version } : {}) }
  } catch (error) {
    return {
      status: "error",
      message: `Detected at ${detected.executablePath} but --version failed: ${errorMessage(error)}`,
    }
  }
}

export function parseClaudeAuthStatus(raw: string): ExternalAgentLoginProbe | undefined {
  try {
    const parsed = JSON.parse(raw) as { loggedIn?: unknown }
    if (parsed.loggedIn === true) {
      return { status: "logged_in" }
    }
    if (parsed.loggedIn === false) {
      return { status: "logged_out" }
    }
  } catch {
    // Older Claude versions may not support JSON auth status; use the legacy
    // config marker fallback below instead of treating that as logged out.
  }
  return undefined
}

async function probeClaudeCliLogin(
  executablePath: string,
  pathEnv: string,
  options: ExternalAgentProbeOptions,
): Promise<ExternalAgentLoginProbe | undefined> {
  const env = options.env ?? process.env
  try {
    const { stdout } = await execFileAsync(executablePath, ["auth", "status", "--json"], {
      timeout: versionProbeTimeoutMs,
      maxBuffer: 64 * 1024,
      env: { ...env, PATH: pathEnv },
    })
    return parseClaudeAuthStatus(stdout)
  } catch (error) {
    const stdout =
      error && typeof error === "object" && "stdout" in error && typeof error.stdout === "string" ? error.stdout : ""
    return parseClaudeAuthStatus(stdout)
  }
}

export function parseGrokModelsOutput(raw: string): {
  catalog?: ExternalAgentCatalog
  login: ExternalAgentLoginProbe
} {
  const loggedOut = /\bnot authenticated\b/iu.test(raw)
  const defaultModelId = raw.match(/^Default model:\s*(\S+)\s*$/imu)?.[1]
  const models = raw
    .split(/\r?\n/u)
    .flatMap((line) => {
      const match = line.match(/^\s*[*-]\s+(\S+?)(?:\s+\(default\))?\s*$/u)
      return match?.[1] ? [{ id: match[1], label: match[1] }] : []
    })
    .filter((model, index, all) => all.findIndex((candidate) => candidate.id === model.id) === index)
  return {
    login: loggedOut ? { status: "logged_out" } : models.length > 0 ? { status: "logged_in" } : { status: "unknown" },
    ...(models.length > 0
      ? {
          catalog: {
            models,
            efforts: [],
            ...(defaultModelId ? { defaultModelId } : {}),
          },
        }
      : {}),
  }
}

async function probeGrokModels(
  executablePath: string,
  pathEnv: string,
  options: ExternalAgentProbeOptions,
): Promise<{ catalog?: ExternalAgentCatalog; login: ExternalAgentLoginProbe }> {
  const env = options.env ?? process.env
  try {
    const { stdout } = await execFileAsync(executablePath, ["models"], {
      timeout: versionProbeTimeoutMs,
      maxBuffer: 64 * 1024,
      env: { ...env, PATH: pathEnv },
    })
    return parseGrokModelsOutput(stdout)
  } catch (error) {
    const stdout =
      error && typeof error === "object" && "stdout" in error && typeof error.stdout === "string" ? error.stdout : ""
    return parseGrokModelsOutput(stdout)
  }
}

/**
 * Claude Code login state from the CLI's own config file. Only key presence is
 * inspected; no secret ever leaves this function (~/.claude.json holds account
 * profile fields, credentials live in the OS keychain).
 */
async function probeClaudeLogin(options: ExternalAgentProbeOptions): Promise<ExternalAgentLoginProbe> {
  const env = options.env ?? process.env
  const home = options.homeDirectory ?? os.homedir()
  try {
    const raw = await readFile(path.join(home, ".claude.json"), "utf8")
    const parsed = JSON.parse(raw) as { oauthAccount?: { emailAddress?: unknown; displayName?: unknown } }
    if (parsed.oauthAccount && typeof parsed.oauthAccount === "object") {
      const account =
        typeof parsed.oauthAccount.emailAddress === "string"
          ? parsed.oauthAccount.emailAddress
          : typeof parsed.oauthAccount.displayName === "string"
            ? parsed.oauthAccount.displayName
            : undefined
      return { status: "logged_in", ...(account ? { account } : {}) }
    }
    if (env["ANTHROPIC_API_KEY"]?.trim()) {
      return { status: "logged_in" }
    }
    return { status: "logged_out" }
  } catch {
    return env["ANTHROPIC_API_KEY"]?.trim() ? { status: "logged_in" } : { status: "unknown" }
  }
}

async function probeLoginMarker(
  markerPath: string | undefined,
  options: ExternalAgentProbeOptions,
): Promise<ExternalAgentLoginProbe> {
  if (!markerPath) {
    return { status: "unknown" }
  }
  const home = options.homeDirectory ?? os.homedir()
  return (await pathExists(path.join(home, markerPath))) ? { status: "logged_in" } : { status: "unknown" }
}

async function probeRegisteredLogin(
  registration: AcpAgentRegistration,
  pathEnv: string,
  options: ExternalAgentProbeOptions,
): Promise<ExternalAgentLoginProbe> {
  if (registration.loginProbe === "claude-cli") {
    const runtime = registration.runtimeExecutable
    const detected = runtime
      ? await detectCliExecutable(runtime.cliCommands, {
          env: options.env ?? process.env,
          homeDirectory: options.homeDirectory,
          pathEnv,
        })
      : undefined
    const native = detected ? await probeClaudeCliLogin(detected.executablePath, pathEnv, options) : undefined
    return native ?? probeClaudeLogin(options)
  }
  if (registration.loginProbe === "grok-models") {
    const detected = await detectCliExecutable(registration.cliCommands, {
      env: options.env ?? process.env,
      homeDirectory: options.homeDirectory,
      pathEnv,
    })
    return detected ? (await probeGrokModels(detected.executablePath, pathEnv, options)).login : { status: "unknown" }
  }
  return probeLoginMarker(registration.loginMarkerPath, options)
}

export async function probeExternalAgent(
  kind: ExternalAgentKind,
  options: ExternalAgentProbeOptions = {},
): Promise<ExternalAgentRuntimeStatus> {
  const profile = AGENT_PROFILES[kind]
  const loginHint = agentLoginHint(kind)
  const pathEnv = await probeCommandPath(options)
  const registration: AcpAgentRegistration = ACP_AGENT_REGISTRY[kind]
  let binary = await probeBinary(registration.cliCommands, registration.versionArgs, options, pathEnv)
  if (binary.status === "detected") {
    const runtime = await probeRegisteredRuntime(registration, pathEnv, options)
    if (runtime.status === "not_found") {
      binary = { status: "error", message: runtime.message }
    }
  }
  const nativeCatalogProbe =
    registration.catalogProbe === "grok-models" && binary.status === "detected"
      ? await probeGrokModels(binary.path, pathEnv, options)
      : undefined
  const login = shouldProbeExternalAgentLogin(profile.auth, binary)
    ? (nativeCatalogProbe?.login ?? (await probeRegisteredLogin(registration, pathEnv, options)))
    : { status: "unknown" as const }
  const catalog = nativeCatalogProbe?.catalog
  const status: ExternalAgentRuntimeStatus = {
    kind,
    displayName: profile.displayName,
    binary,
    login,
    loginHint,
    loginCommand: registration.loginCommand,
    ...(catalog ? { catalog } : {}),
  }
  logDiagnosticOnChange(`byoa-probe:${kind}`, "byoa-probe", "external agent probe", {
    kind,
    binaryStatus: status.binary.status,
    ...(status.binary.status === "detected" ? { version: status.binary.version ?? null } : {}),
    ...(status.binary.status === "error" ? { binaryError: status.binary.message } : {}),
    loginStatus: status.login.status,
  })
  return status
}
