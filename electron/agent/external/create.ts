import type { ExternalAgentKind } from "../contract/profile.ts"
import type { ExternalAgentAdapter } from "./adapter-base.ts"

import path from "node:path"
import { AcpAgentAdapter } from "../acp/adapter.ts"
import { ACP_AGENT_KINDS, ACP_AGENT_REGISTRY } from "../acp/registry.ts"
import { ClaudeCodeAgentAdapter } from "../claude/adapter.ts"
import { probeExternalAgent } from "./probe.ts"

// Assembly of the app-lifetime external adapter set. One native adapter per
// flagship agent (Claude Code) plus one generic ACP adapter instance per
// registry entry — adding an ACP agent must never change this file.

export interface CreateExternalAgentsOptions {
  /** Repo root in dev (node_modules/.bin lookup for npm-distributed ACP bridges). */
  appRoot: string
  isPackaged: boolean
  resourcesPath?: string
  /** Private root for per-session scratch working directories. */
  scratchRootDir: string
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
  agents.set(
    "claude-code",
    new ClaudeCodeAgentAdapter({
      probe: () => probeExternalAgent("claude-code", probeOptions),
      scratchRootDir: path.join(options.scratchRootDir, "claude-code"),
      transcriptDir: path.join(options.scratchRootDir, "claude-code", "transcripts"),
    }),
  )
  for (const kind of ACP_AGENT_KINDS) {
    agents.set(
      kind,
      new AcpAgentAdapter({
        kind,
        registration: ACP_AGENT_REGISTRY[kind],
        probe: () => probeExternalAgent(kind, probeOptions),
        scratchRootDir: path.join(options.scratchRootDir, kind),
        transcriptDir: path.join(options.scratchRootDir, kind, "transcripts"),
      }),
    )
  }
  return agents
}
