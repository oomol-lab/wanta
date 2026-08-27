import type { AgentPermissionMode } from "../../chat/common.ts"
import type { WantaAgentMode } from "../mode.ts"

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
  /** Static, display-only terminal fallback. Never executed as a shell string. */
  loginCommand: string
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
  /** Map Wanta build/plan choices onto a native ACP select option. */
  workModeMap?: Readonly<Partial<Record<WantaAgentMode, { category: "collaboration_mode"; value: string }>>>
  /** Config file (relative to $HOME) whose presence suggests a completed login. */
  loginMarkerPath?: string
  /** Optional native-runtime login probe when a marker alone cannot authoritatively establish auth state. */
  loginProbe?: "claude-cli" | "grok-models"
  /** Optional read-only native catalog probe used before ACP session creation. */
  catalogProbe?: "grok-models"
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
    loginHint: "Run `claude login` in a terminal to sign in, then retry.",
    loginCommand: "claude login",
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
    // claude-agent-acp 0.70.0 exposes native model and effort config options.
    // The selected model is executed with the user's own Claude Code account
    // and local provider configuration; Wanta never supplies a model route.
    selection: { model: true, effort: true },
    loginProbe: "claude-cli",
    bundledBinName: "claude-agent-acp",
    runtimeExecutable: { cliCommands: ["claude"], envVar: "CLAUDE_CODE_EXECUTABLE" },
  },
  codex: {
    displayName: "Codex",
    cliCommands: ["codex-acp"],
    acpArgs: [],
    versionArgs: ["--version"],
    loginHint: "Run `codex login` in a terminal to sign in, then retry.",
    loginCommand: "codex login",
    // codex-acp modes: read-only / agent (workspace-write) / agent-full-access.
    permissionModeMap: { default: "agent", read_only: "read-only", full_access: "agent-full-access" },
    // codex-acp 1.6.2: session/new carries the model config option, followed by
    // config_option_update replaces it with family-level models (category
    // "model") plus a thought_level effort select — both axes are live.
    selection: { model: true, effort: true },
    workModeMap: {
      build: { category: "collaboration_mode", value: "default" },
      plan: { category: "collaboration_mode", value: "plan" },
    },
    loginMarkerPath: ".codex/auth.json",
    bundledBinName: "codex-acp",
    runtimeExecutable: { cliCommands: ["codex"], envVar: "CODEX_PATH" },
  },
  grok: {
    displayName: "Grok",
    cliCommands: ["grok"],
    // Verified against grok 1.0.5: `grok agent stdio` speaks full ACP v1
    // (initialize, session/new with the unstable models shape, session/set_model,
    // session/close, standard permission requests).
    acpArgs: ["agent", "stdio"],
    versionArgs: ["--version"],
    loginHint: "Run `grok login` in a terminal to sign in, then retry.",
    loginCommand: "grok login",
    loginProbe: "grok-models",
    catalogProbe: "grok-models",
    // Candidate ids are intersected with the modes returned by the live Grok
    // session, so an unavailable or renamed mode is never shown or applied.
    // Verified against grok 1.0.5: an authenticated session/new response
    // carries no `modes` at all, so only `default` is exposed and applying it
    // is a no-op that keeps Grok's own default policy (see applyPermissionMode).
    permissionModeMap: {
      default: "default",
      accept_edits: "acceptEdits",
      plan: "plan",
      auto: "auto",
      full_access: "bypassPermissions",
    },
    // Grok 1.0.5 exposes its account-scoped model and thought-level config
    // options over ACP. Both selections stay native to the local Grok runtime.
    selection: { model: true, effort: true },
  },
} as const satisfies Record<string, AcpAgentRegistration>

export type AcpAgentKind = keyof typeof ACP_AGENT_REGISTRY

export const ACP_AGENT_KINDS = Object.keys(ACP_AGENT_REGISTRY) as AcpAgentKind[]
