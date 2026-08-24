import type { AcpAgentRegistration } from "../acp/registry.ts"
import type { ExternalAgentKind } from "../contract/profile.ts"
import type { ExternalAgentBinaryProbe, ExternalAgentLoginProbe, ExternalAgentRuntimeStatus } from "./status.ts"

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

export function parseGrokAuthStatus(raw: string): ExternalAgentLoginProbe | undefined {
  if (/\byou are not authenticated\b|\bno auth credentials\b/iu.test(raw)) {
    return { status: "logged_out" }
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

async function probeGrokCliLogin(
  executablePath: string,
  pathEnv: string,
  options: ExternalAgentProbeOptions,
): Promise<ExternalAgentLoginProbe | undefined> {
  const env = options.env ?? process.env
  try {
    const { stdout, stderr } = await execFileAsync(executablePath, ["models"], {
      timeout: versionProbeTimeoutMs,
      maxBuffer: 64 * 1024,
      env: { ...env, PATH: pathEnv },
      shell: externalExecutableNeedsShell(executablePath),
    })
    return parseGrokAuthStatus(`${stdout}\n${stderr}`) ?? { status: "logged_in" }
  } catch (error) {
    const stdout =
      error && typeof error === "object" && "stdout" in error && typeof error.stdout === "string" ? error.stdout : ""
    const stderr =
      error && typeof error === "object" && "stderr" in error && typeof error.stderr === "string" ? error.stderr : ""
    return parseGrokAuthStatus(`${stdout}\n${stderr}`)
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
  executablePath: string | undefined,
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
  if (registration.loginProbe === "grok-cli" && executablePath) {
    const native = await probeGrokCliLogin(executablePath, pathEnv, options)
    if (native) {
      return native
    }
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
  const registration = ACP_AGENT_REGISTRY[kind]
  const binary = await probeBinary(registration.cliCommands, registration.versionArgs, options, pathEnv)
  const login = await probeRegisteredLogin(
    registration,
    binary.status === "detected" ? binary.path : undefined,
    pathEnv,
    options,
  )
  const status: ExternalAgentRuntimeStatus = { kind, displayName: profile.displayName, binary, login, loginHint }
  logDiagnosticOnChange(`byoa-probe:${kind}`, "byoa-probe", "external agent probe", {
    kind,
    binaryStatus: status.binary.status,
    ...(status.binary.status === "detected" ? { version: status.binary.version ?? null } : {}),
    ...(status.binary.status === "error" ? { binaryError: status.binary.message } : {}),
    loginStatus: status.login.status,
  })
  return status
}
