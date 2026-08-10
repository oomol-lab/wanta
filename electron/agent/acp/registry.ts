import type { AgentPermissionMode } from "../../chat/common.ts"

// ACP agent registry (BYOA phase 2).
//
// Every ACP-speaking agent is ONE registration entry here plus the profile row
// derived from it in contract/profile.ts. Adding an ACP agent must never add a
// code branch anywhere else — the generic AcpAgentAdapter consumes these
// declarations verbatim.

export interface AcpAgentRegistration {
  displayName: string
  /** Candidate CLI command names probed on PATH, in order. */
  cliCommands: readonly string[]
  /** Arguments that put the CLI into ACP mode on stdio. */
  acpArgs: readonly string[]
  /** Arguments that print the CLI version (for probe verification). */
  versionArgs: readonly string[]
  /** User guidance when the agent reports authentication is required. */
  loginHint: string
  /**
   * Wanta permission modes this agent supports, each mapped to the ACP session
   * mode id applied via session/set_mode. Key order defines the profile's
   * declared mode list; entries the live session does not advertise are
   * skipped at apply time. Absent map = the agent keeps its own default mode.
   */
  permissionModeMap?: Readonly<Partial<Record<AgentPermissionMode, string>>>
  /**
   * Whether the agent exposes ACP session config options for model and
   * reasoning-effort selection (v1.3 configOptions, categories "model" and
   * "thought_level"). Drives the profile's setModel/setEffort declarations.
   */
  selection?: { model: boolean; effort: boolean }
  /** Config file (relative to $HOME) whose presence suggests a completed login. */
  loginMarkerPath?: string
  /**
   * Managed binary name resolved from node_modules/.bin in dev (and bundled
   * resources in packaged builds) when the CLI is not on the user PATH. Used
   * for npm-distributed ACP bridges such as codex-acp.
   */
  bundledBinName?: string
}

export const ACP_AGENT_REGISTRY = {
  "gemini-cli": {
    displayName: "Gemini CLI",
    cliCommands: ["gemini"],
    acpArgs: ["--acp"],
    versionArgs: ["--version"],
    loginHint: "Run `gemini` in a terminal and complete the Google sign-in, then retry.",
    // gemini-cli 0.42 modes: default (ask) / autoEdit / yolo.
    permissionModeMap: { default: "default", accept_edits: "autoEdit", full_access: "yolo" },
    loginMarkerPath: ".gemini/oauth_creds.json",
  },
  codex: {
    displayName: "Codex",
    cliCommands: ["codex-acp"],
    acpArgs: [],
    versionArgs: ["--version"],
    loginHint: "Run `codex login` in a terminal to sign in, then retry.",
    // codex-acp modes: read-only / agent (workspace-write) / agent-full-access.
    permissionModeMap: { default: "agent", read_only: "read-only", full_access: "agent-full-access" },
    selection: { model: true, effort: true },
    loginMarkerPath: ".codex/auth.json",
    bundledBinName: "codex-acp",
  },
} as const satisfies Record<string, AcpAgentRegistration>

export type AcpAgentKind = keyof typeof ACP_AGENT_REGISTRY

export const ACP_AGENT_KINDS = Object.keys(ACP_AGENT_REGISTRY) as AcpAgentKind[]
