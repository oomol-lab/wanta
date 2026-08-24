import type { AcpAgentRegistration } from "../acp/registry.ts"
import type { PromptAgentInput } from "../contract/input.ts"
import type { ExternalAgentKind } from "../contract/profile.ts"
import type { ExternalAgentAdapter } from "./adapter-base.ts"
import type { HostMcpServerProvider } from "./host-mcp.ts"

import path from "node:path"
import { AcpAgentAdapter } from "../acp/adapter.ts"
import { ACP_AGENT_KINDS, ACP_AGENT_REGISTRY } from "../acp/registry.ts"
import { probeExternalAgent } from "./probe.ts"

// Assembly of the app-lifetime external adapter set. Every external agent,
// including Claude Code, is registry-backed and uses the generic ACP adapter.

export interface CreateExternalAgentsOptions {
  /** Repo root in dev (node_modules/.bin lookup for npm-distributed ACP bridges). */
  appRoot: string
  isPackaged: boolean
  resourcesPath?: string
  /** Private root for per-session scratch working directories. */
  scratchRootDir: string
  hostMcpServers?: HostMcpServerProvider
  /** Shared Wanta-managed subprocess environment for every external adapter. */
  commandEnvironment?: () => Promise<NodeJS.ProcessEnv>
  /** Host-owned model route hooks used by declaratively Wanta-routed registrations. */
  wantaModelRouter?: {
    onForgetSession: (sessionId: string) => void
    preparePrompt: (input: PromptAgentInput) => Promise<void>
    sessionMeta: (input: PromptAgentInput) => Promise<Record<string, unknown> | undefined>
  }
}

export function createExternalAgents(
  options: CreateExternalAgentsOptions,
): Map<ExternalAgentKind, ExternalAgentAdapter> {
  const extraBinDirectories =
    options.isPackaged && options.resourcesPath
      ? [path.join(options.resourcesPath, "bin")]
      : [path.join(options.appRoot, "node_modules", ".bin")]
  const probeOptions = { extraBinDirectories }
  const agents = new Map<ExternalAgentKind, ExternalAgentAdapter>()
  for (const kind of ACP_AGENT_KINDS) {
    const registration: AcpAgentRegistration = ACP_AGENT_REGISTRY[kind]
    const modelRouter = registration.modelSource === "wanta" ? options.wantaModelRouter : undefined
    agents.set(
      kind,
      new AcpAgentAdapter({
        kind,
        registration,
        probe: () => probeExternalAgent(kind, probeOptions),
        scratchRootDir: path.join(options.scratchRootDir, kind),
        transcriptDir: path.join(options.scratchRootDir, kind, "transcripts"),
        hostMcpServers: options.hostMcpServers,
        commandEnvironment: options.commandEnvironment,
        ...(modelRouter
          ? {
              onForgetSession: modelRouter.onForgetSession,
              preparePrompt: modelRouter.preparePrompt,
              sessionMeta: modelRouter.sessionMeta,
            }
          : {}),
      }),
    )
  }
  return agents
}
