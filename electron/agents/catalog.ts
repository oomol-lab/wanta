import { execFile } from "node:child_process"
import { access } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { promisify } from "node:util"
import { resetUserCommandPathCacheForTest, resolveUserCommandPath } from "../command-path.ts"
import { logDiagnosticOnChange } from "../diagnostics-log.ts"

const execFileAsync = promisify(execFile)
const agentDiscoveryCacheMs = 5_000

export interface AgentDiscoveryEntry {
  agent: SupportedAgent
  cliCommand?: string
  hasCli: boolean
  hasHomeRoot: boolean
  hasSkillRoot: boolean
  homeRoot: string
  isDiscovered: boolean
  skillRoot: string
}

export interface AgentDiscoveryOptions {
  env?: NodeJS.ProcessEnv
  homeDirectory?: string
  pathEnv?: string
}

interface AgentDiscoveryCache {
  entries: AgentDiscoveryEntry[]
  time: number
}

let defaultAgentDiscoveryCache: AgentDiscoveryCache | undefined
let defaultAgentDiscoveryInFlight: Promise<AgentDiscoveryEntry[]> | undefined

export interface SupportedAgent {
  canDiscoverFromSkillRoot?: boolean
  cliCommands: readonly string[]
  homeEnvVar?: string
  homeRoot: string
  id: string
  name: string
  ooCliAgentId: string
}

export const supportedAgents: readonly SupportedAgent[] = [
  {
    canDiscoverFromSkillRoot: true,
    homeRoot: ".agents",
    id: "universal",
    cliCommands: [],
    name: "Universal",
    ooCliAgentId: "universal",
  },
  {
    canDiscoverFromSkillRoot: true,
    homeEnvVar: "CODEX_HOME",
    homeRoot: ".codex",
    id: "codex",
    cliCommands: ["codex"],
    name: "Codex",
    ooCliAgentId: "codex",
  },
  {
    canDiscoverFromSkillRoot: true,
    homeRoot: ".claude",
    id: "claude-code",
    cliCommands: ["claude"],
    name: "Claude Code",
    ooCliAgentId: "claude",
  },
  {
    homeEnvVar: "HERMES_HOME",
    homeRoot: ".hermes",
    id: "hermes",
    cliCommands: ["hermes"],
    name: "Hermes",
    ooCliAgentId: "hermes",
  },
  {
    homeRoot: ".openclaw",
    id: "openclaw",
    cliCommands: ["openclaw"],
    name: "OpenClaw",
    ooCliAgentId: "openclaw",
  },
  {
    homeRoot: ".trae",
    id: "trae",
    cliCommands: ["trae"],
    name: "Trae",
    ooCliAgentId: "trae",
  },
  {
    homeRoot: ".workbuddy",
    id: "workbuddy",
    cliCommands: ["workbuddy"],
    name: "WorkBuddy",
    ooCliAgentId: "workbuddy",
  },
  {
    homeRoot: ".qoderwork",
    id: "qoderwork",
    cliCommands: ["qoder"],
    name: "QoderWork",
    ooCliAgentId: "qoderwork",
  },
]

export function resolveAgentHomeRoot(
  agent: SupportedAgent,
  env: NodeJS.ProcessEnv = process.env,
  homeDirectory = os.homedir(),
): string {
  const explicitHomeRoot = agent.homeEnvVar ? env[agent.homeEnvVar]?.trim() : undefined

  if (explicitHomeRoot) {
    return explicitHomeRoot
  }

  return path.join(homeDirectory, agent.homeRoot)
}

export function resolveAgentSkillRoot(
  agent: SupportedAgent,
  env: NodeJS.ProcessEnv = process.env,
  homeDirectory = os.homedir(),
): string {
  return path.join(resolveAgentHomeRoot(agent, env, homeDirectory), "skills")
}

export function resolveAgentRelativeSkillRoot(agent: SupportedAgent): string {
  return path.join(agent.homeRoot, "skills")
}

export async function pathExists(pathname: string): Promise<boolean> {
  try {
    await access(pathname)
    return true
  } catch {
    return false
  }
}

export function resetAgentDiscoveryCachesForTest(): void {
  defaultAgentDiscoveryCache = undefined
  defaultAgentDiscoveryInFlight = undefined
  resetUserCommandPathCacheForTest()
}

export async function detectCliCommand(
  commands: readonly string[],
  options: AgentDiscoveryOptions = {},
): Promise<string | undefined> {
  if (commands.length === 0) {
    return undefined
  }

  const env = options.env ?? process.env
  const pathEnv = options.pathEnv ?? (await resolveUserCommandPath({ env, homeDirectory: options.homeDirectory }))

  for (const command of commands) {
    try {
      await execFileAsync(command, ["--version"], {
        env: {
          ...env,
          PATH: pathEnv,
        },
        timeout: 1500,
      })
      logDiagnosticOnChange(`agent-discovery:cli-command:${command}`, "agent-discovery", "cli command detected", {
        command,
        detected: true,
      })
      return command
    } catch (error) {
      logDiagnosticOnChange(
        `agent-discovery:cli-command:${command}`,
        "agent-discovery",
        "cli command unavailable",
        { command, detected: false, error: error instanceof Error ? error.message : String(error) },
        "trace",
        { command, detected: false },
      )
      // 继续尝试下一个命令。
    }
  }

  return undefined
}

function shouldUseDefaultDiscoveryCache(agents: readonly SupportedAgent[], options: AgentDiscoveryOptions): boolean {
  return agents === supportedAgents && !options.env && !options.homeDirectory && !options.pathEnv
}

async function readAgentDiscoveryUncached(
  agents: readonly SupportedAgent[],
  options: AgentDiscoveryOptions,
): Promise<AgentDiscoveryEntry[]> {
  const env = options.env ?? process.env
  const homeDirectory = options.homeDirectory ?? os.homedir()
  const pathEnv = options.pathEnv ?? (await resolveUserCommandPath({ env, homeDirectory }))

  const startDiagnosticFields = {
    agentIds: agents.map((agent) => agent.id),
    homeDirectory,
    pathParts: pathEnv.split(path.delimiter).filter(Boolean),
  }
  logDiagnosticOnChange(
    "agent-discovery:start",
    "agent-discovery",
    "starting agent discovery",
    startDiagnosticFields,
    "trace",
    {
      agentIds: startDiagnosticFields.agentIds,
      homeDirectory: startDiagnosticFields.homeDirectory,
    },
  )
  const entries = await Promise.all(
    agents.map(async (agent): Promise<AgentDiscoveryEntry> => {
      const homeRoot = resolveAgentHomeRoot(agent, env, homeDirectory)
      const skillRoot = path.join(homeRoot, "skills")
      const [hasHomeRoot, hasSkillRoot, cliCommand] = await Promise.all([
        pathExists(homeRoot),
        pathExists(skillRoot),
        detectCliCommand(agent.cliCommands, { env, homeDirectory, pathEnv }),
      ])
      const hasCli = Boolean(cliCommand)
      const isDiscovered = hasCli || (agent.canDiscoverFromSkillRoot === true && hasSkillRoot)

      logDiagnosticOnChange(`agent-discovery:agent:${agent.id}`, "agent-discovery", "agent discovery result", {
        agentId: agent.id,
        canDiscoverFromSkillRoot: agent.canDiscoverFromSkillRoot === true,
        cliCommand: cliCommand ?? null,
        discovered: isDiscovered,
        hasHomeRoot,
        hasSkillRoot,
        skillRoot,
      })

      return {
        agent,
        cliCommand,
        hasCli,
        hasHomeRoot,
        hasSkillRoot,
        homeRoot,
        isDiscovered,
        skillRoot,
      }
    }),
  )

  const discoveredAgentIds = entries.filter((entry) => entry.isDiscovered).map((entry) => entry.agent.id)
  logDiagnosticOnChange("agent-discovery:completed", "agent-discovery", "completed agent discovery", {
    discoveredAgentIds,
    total: discoveredAgentIds.length,
  })
  return entries
}

export async function readAgentDiscovery(
  agents: readonly SupportedAgent[] = supportedAgents,
  options: AgentDiscoveryOptions = {},
): Promise<AgentDiscoveryEntry[]> {
  const useDefaultCache = shouldUseDefaultDiscoveryCache(agents, options)
  const now = Date.now()

  if (useDefaultCache && defaultAgentDiscoveryCache && now - defaultAgentDiscoveryCache.time < agentDiscoveryCacheMs) {
    return defaultAgentDiscoveryCache.entries
  }

  if (useDefaultCache && defaultAgentDiscoveryInFlight) {
    return defaultAgentDiscoveryInFlight
  }

  const promise = readAgentDiscoveryUncached(agents, options)

  if (!useDefaultCache) {
    return promise
  }

  defaultAgentDiscoveryInFlight = promise

  try {
    const entries = await promise
    defaultAgentDiscoveryCache = { entries, time: Date.now() }
    return entries
  } finally {
    if (defaultAgentDiscoveryInFlight === promise) {
      defaultAgentDiscoveryInFlight = undefined
    }
  }
}

export async function listDiscoveredAgents(
  agents: readonly SupportedAgent[] = supportedAgents,
  options: AgentDiscoveryOptions = {},
): Promise<SupportedAgent[]> {
  return (await readAgentDiscovery(agents, options)).filter((entry) => entry.isDiscovered).map((entry) => entry.agent)
}
