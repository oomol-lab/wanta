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
  /** Model/auth owner. Omitted means the external agent owns both through its CLI. */
  modelSource?: "agent" | "wanta"
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
  /** Optional native-runtime login probe when the ACP bridge is not itself the credential authority. */
  loginProbe?: "claude-cli"
  /**
   * Managed binary name resolved from node_modules/.bin in dev (and bundled
   * resources in packaged builds) when the CLI is not on the user PATH. Used
   * for npm-distributed ACP bridges such as codex-acp.
   */
  bundledBinName?: string
  /**
   * Optional native CLI launched by the ACP bridge. Wanta resolves it from the
   * recovered desktop PATH and passes the absolute path through this env var,
   * so a packaged bridge never depends on an omitted node_modules tree.
   */
  runtimeExecutable?: {
    cliCommands: readonly string[]
    envVar: string
  }
}

export const ACP_AGENT_REGISTRY = {
  "claude-code": {
    displayName: "Claude Code",
    cliCommands: ["claude-agent-acp"],
    acpArgs: [],
    versionArgs: ["--version"],
    loginHint: "Check the selected Wanta model and its credential, then retry.",
    // Claude Code supplies the coding harness; Wanta supplies the selected
    // model and credential through a session-scoped Anthropic-compatible route.
    modelSource: "wanta",
    // claude-agent-acp 0.70.0 exposes the Claude Code modes with these stable
    // wire ids; availability (notably auto/full access) is still checked
    // against the concrete session before Wanta applies a requested mode.
    permissionModeMap: {
      default: "default",
      accept_edits: "acceptEdits",
      plan: "plan",
      auto: "auto",
      full_access: "bypassPermissions",
    },
    selection: { model: false, effort: false },
    bundledBinName: "claude-agent-acp",
    runtimeExecutable: { cliCommands: ["claude"], envVar: "CLAUDE_CODE_EXECUTABLE" },
  },
  codex: {
    displayName: "Codex",
    cliCommands: ["codex-acp"],
    acpArgs: [],
    versionArgs: ["--version"],
    loginHint: "Run `codex login` in a terminal to sign in, then retry.",
    // codex-acp modes: read-only / agent (workspace-write) / agent-full-access.
    permissionModeMap: { default: "agent", read_only: "read-only", full_access: "agent-full-access" },
    // codex-acp 1.1.14: session/new carries the unstable models shape, then a
    // config_option_update replaces it with family-level models (category
    // "model") plus a thought_level effort select — both axes are live.
    selection: { model: true, effort: true },
    loginMarkerPath: ".codex/auth.json",
    bundledBinName: "codex-acp",
    runtimeExecutable: { cliCommands: ["codex"], envVar: "CODEX_PATH" },
  },
  grok: {
    displayName: "Grok",
    cliCommands: ["grok"],
    // Verified against grok 1.0.0: `grok agent stdio` speaks full ACP v1
    // (initialize, session/new with the unstable models shape, session/set_model,
    // session/close, standard permission requests).
    acpArgs: ["agent", "stdio"],
    versionArgs: ["--version"],
    loginHint: "Run `grok login` in a terminal to sign in, then retry.",
    // grok advertises no ACP session modes; approvals round-trip per request.
    selection: { model: true, effort: false },
    loginMarkerPath: ".grok/auth.json",
  },
} as const satisfies Record<string, AcpAgentRegistration>

export type AcpAgentKind = keyof typeof ACP_AGENT_REGISTRY

export const ACP_AGENT_KINDS = Object.keys(ACP_AGENT_REGISTRY) as AcpAgentKind[]
