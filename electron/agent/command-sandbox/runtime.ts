import type { CommandSandboxPolicy } from "./policy.ts"
import type { SandboxRuntimeConfig } from "@vscode/sandbox-runtime"

import { SandboxManager } from "@vscode/sandbox-runtime"
import { spawn } from "node:child_process"
import { mkdir } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { startCommandSandboxNetworkProxies, upstreamProxyFromEnvironment } from "./network-proxy.ts"
import { readCommandSandboxPolicy } from "./policy.ts"

const sandboxEnvironmentNames = [
  "COLORTERM",
  "LANG",
  "LC_ALL",
  "LC_CTYPE",
  "LOGNAME",
  "PATH",
  "TERM",
  "USER",
  "WANTA_NODE_BIN",
] as const

const directEnvironmentNames = [
  ...sandboxEnvironmentNames,
  "ALL_PROXY",
  "BUN_INSTALL",
  "CARGO_HOME",
  "DOCKER_HOST",
  "GOPATH",
  "HTTP_PROXY",
  "HTTPS_PROXY",
  "JAVA_HOME",
  "NO_PROXY",
  "NVM_BIN",
  "NVM_DIR",
  "PNPM_HOME",
  "SHELL",
  "SSH_AUTH_SOCK",
  "TERM_PROGRAM",
  "TERM_PROGRAM_VERSION",
  "VOLTA_HOME",
  "XDG_CACHE_HOME",
  "XDG_CONFIG_HOME",
  "XDG_DATA_HOME",
  "all_proxy",
  "http_proxy",
  "https_proxy",
  "no_proxy",
] as const

const protectedReadRoots = [
  "/Network",
  "/Users",
  "/Volumes",
  "/private/tmp",
  "/private/var/folders",
  "/private/var/tmp",
] as const

export async function runCommandSandboxShell(args: readonly string[], sourceEnv = process.env): Promise<number> {
  if (process.platform !== "darwin") {
    throw new Error("Command Sandbox (Preview) is currently available only on macOS.")
  }
  const command = shellCommand(args)
  const policyDir = requireEnvironment(sourceEnv, "WANTA_COMMAND_SANDBOX_POLICY_DIR")
  const authKey = requireEnvironment(sourceEnv, "WANTA_COMMAND_SANDBOX_AUTH")
  const sessionId = requireEnvironment(sourceEnv, "WANTA_COMMAND_SANDBOX_SESSION_ID")
  requireEnvironment(sourceEnv, "WANTA_COMMAND_SANDBOX_CALL_ID")
  const delegateShell = requireAbsoluteEnvironment(sourceEnv, "WANTA_COMMAND_SANDBOX_DELEGATE_SHELL")
  const policy = await readCommandSandboxPolicy(policyDir, sessionId, authKey)
  if (policy.executionMode === "direct") {
    return spawnCommand(command, delegateShell, buildDirectCommandEnvironment(sourceEnv))
  }
  const brokerUrl = requireEnvironment(sourceEnv, "WANTA_COMMAND_SANDBOX_BROKER_URL")
  const environment = await buildCommandSandboxEnvironment(policy, sourceEnv)
  const proxies = await startCommandSandboxNetworkProxies(policy, {
    authorizePrivate: (request) => requestPrivateNetworkAccess(brokerUrl, authKey, sessionId, request),
    upstreamProxy: upstreamProxyFromEnvironment(sourceEnv),
  })
  try {
    await SandboxManager.initialize(buildSandboxRuntimeConfig(policy, policyDir, proxies))
    const sandboxedCommand = await SandboxManager.wrapWithSandbox(sandboxCommand(command, delegateShell), delegateShell)
    return await spawnCommand(sandboxedCommand, delegateShell, environment)
  } finally {
    SandboxManager.cleanupAfterCommand()
    await Promise.allSettled([SandboxManager.reset(), proxies.close()])
  }
}

export function buildDirectCommandEnvironment(sourceEnv: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const environment: NodeJS.ProcessEnv = {
    HOME: os.homedir(),
    TMPDIR: sourceEnv.TMPDIR ?? os.tmpdir(),
  }
  for (const name of directEnvironmentNames) {
    const value = sourceEnv[name]
    if (value !== undefined) environment[name] = value
  }
  for (const [name, value] of Object.entries(sourceEnv)) {
    if (name.startsWith("LC_") && value !== undefined) environment[name] = value
  }
  return environment
}

function sandboxCommand(command: string, delegateShell: string): string {
  return [
    "unset NO_PROXY no_proxy",
    ...(path.basename(delegateShell) === "zsh" ? ["unsetopt BG_NICE 2>/dev/null || true"] : []),
    command,
  ].join("\n")
}

async function requestPrivateNetworkAccess(
  brokerUrl: string,
  authKey: string,
  sessionId: string,
  request: { address: string; host: string; port: number },
): Promise<boolean> {
  try {
    const response = await fetch(`${brokerUrl}/private-network`, {
      method: "POST",
      headers: { Authorization: `Bearer ${authKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ ...request, protocol: "tcp", sessionId }),
      signal: AbortSignal.timeout(6_000),
    })
    if (!response.ok) return false
    const body = (await response.json()) as { allow?: boolean }
    return body.allow === true
  } catch {
    return false
  }
}

export async function buildCommandSandboxEnvironment(
  policy: CommandSandboxPolicy,
  sourceEnv: NodeJS.ProcessEnv,
): Promise<NodeJS.ProcessEnv> {
  const temporaryDir = path.join(policy.homeDir, "tmp")
  const cacheDir = path.join(policy.homeDir, ".cache")
  const configDir = path.join(policy.homeDir, ".config")
  const dataDir = path.join(policy.homeDir, ".local", "share")
  await Promise.all(
    [temporaryDir, cacheDir, configDir, dataDir].map((directory) => mkdir(directory, { recursive: true, mode: 0o700 })),
  )
  const environment: NodeJS.ProcessEnv = {
    HOME: policy.homeDir,
    TMPDIR: temporaryDir,
    XDG_CACHE_HOME: cacheDir,
    XDG_CONFIG_HOME: configDir,
    XDG_DATA_HOME: dataDir,
  }
  for (const name of sandboxEnvironmentNames) {
    const value = sourceEnv[name]
    if (value !== undefined) environment[name] = value
  }
  for (const [name, value] of Object.entries(sourceEnv)) {
    if (name.startsWith("LC_") && value !== undefined) environment[name] = value
  }
  return environment
}

function buildSandboxRuntimeConfig(
  policy: CommandSandboxPolicy,
  policyDir: string,
  proxies: { httpPort: number; socksPort: number },
): SandboxRuntimeConfig {
  const home = os.homedir()
  const controlDir = path.dirname(policyDir)
  return {
    filesystem: {
      allowGitConfig: false,
      allowRead: [...policy.readOnlyPaths, ...policy.readWritePaths, ...policy.runtimeReadPaths, policy.homeDir],
      allowWrite: policy.readWritePaths,
      denyRead: [...protectedReadRoots, home, controlDir],
      denyWrite: [policyDir, path.join(controlDir, "network-grants"), ...policy.readOnlyPaths],
    },
    network: {
      allowedDomains: [],
      deniedDomains: [],
      allowAllUnixSockets: false,
      allowLocalBinding: false,
      allowLoopbackOutbound: true,
      httpProxyPort: proxies.httpPort,
      socksProxyPort: proxies.socksPort,
    } as SandboxRuntimeConfig["network"],
  }
}

function shellCommand(args: readonly string[]): string {
  if (args.length !== 2 || args[0] !== "-c") {
    throw new Error("The command sandbox received unsupported shell arguments.")
  }
  return args[1]
}

function requireEnvironment(environment: NodeJS.ProcessEnv, name: string): string {
  const value = environment[name]?.trim()
  if (!value) {
    throw new Error(
      name === "WANTA_COMMAND_SANDBOX_SESSION_ID"
        ? "This shell path is not supported by Command Sandbox (Preview)."
        : "Command Sandbox (Preview) did not receive an authenticated policy.",
    )
  }
  return value
}

function requireAbsoluteEnvironment(environment: NodeJS.ProcessEnv, name: string): string {
  const value = requireEnvironment(environment, name)
  if (!path.isAbsolute(value)) {
    throw new Error("Command Sandbox (Preview) received an invalid shell path.")
  }
  return value
}

function spawnCommand(command: string, delegateShell: string, environment: NodeJS.ProcessEnv): Promise<number> {
  return new Promise((resolve, reject) => {
    const child = spawn(delegateShell, ["-c", command], {
      cwd: process.cwd(),
      detached: true,
      env: environment,
      stdio: "inherit",
    })
    const relay = (signal: NodeJS.Signals) => signalProcessGroup(child.pid, signal)
    const onInterrupt = () => relay("SIGINT")
    const onTerminate = () => relay("SIGTERM")
    process.on("SIGINT", onInterrupt)
    process.on("SIGTERM", onTerminate)
    child.once("error", reject)
    child.once("exit", (code, signal) => {
      process.off("SIGINT", onInterrupt)
      process.off("SIGTERM", onTerminate)
      void terminateProcessGroup(child.pid).finally(() => {
        if (signal) {
          resolve(128 + (os.constants.signals[signal] ?? 0))
        } else {
          resolve(code ?? 1)
        }
      })
    })
  })
}

async function terminateProcessGroup(pid: number | undefined): Promise<void> {
  if (!pid) return
  if (!signalProcessGroup(pid, "SIGTERM")) return
  await new Promise((resolve) => setTimeout(resolve, 200))
  signalProcessGroup(pid, "SIGKILL")
}

function signalProcessGroup(pid: number | undefined, signal: NodeJS.Signals): boolean {
  if (!pid) return false
  try {
    process.kill(-pid, signal)
    return true
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error
    return false
  }
}
