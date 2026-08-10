// Central capability declaration for every agent kind (BYOA phase 0).
//
// One AgentProfile per agent, all in one place, exhaustively checked at compile
// time via `satisfies Record<AgentKind, AgentProfile>`. UI and chat logic must
// derive behavior (model selector, BYOK panel, login prompts, history loading)
// from these declarations and from reflected adapter events — never from
// `if (agent === "...")` branches.

/** Closed set of integrated agents. Later phases extend this union. */
export type AgentKind = "opencode"

/**
 * Which optional parts of the input contract the adapter genuinely honors.
 * `prompt` and `cancel` are mandatory for every adapter and therefore not
 * declared. A flag here must match an overridden handler on the adapter; the
 * cross-adapter contract tests enforce that declaration honesty.
 */
export interface AgentInputCapabilityFlags {
  /** File/directory attachments on a prompt. */
  attachments: boolean
  /** Wanta build/plan modes. */
  modes: boolean
  /** Wanta reasoning-level selection. */
  reasoningLevels: boolean
  /** Per-turn system prompt tail injection. */
  systemPrompt: boolean
  /** Settling permissionAsked events via permission-response inputs. */
  permissionResponse: boolean
  /** Settling questionAsked events via question-response inputs. */
  questionResponse: boolean
}

/** What the agent can do about past sessions. */
export interface AgentHistoryCapabilities {
  list: boolean
  read: boolean
  resume: boolean
}

/**
 * Who owns model selection for this agent. "wanta" means the Wanta model
 * catalog applies (model selector and BYOK UI visible); "agent" means the
 * agent brings its own models and Wanta must hide model routing UI.
 */
export type AgentModelSource = "wanta" | "agent"

/**
 * How the agent authenticates. Wanta never stores subscription secrets for
 * external agents: "agent-cli" delegates entirely to the agent's own login
 * (for example `claude login`), and Wanta only reflects the observed state.
 */
export type AgentAuthMode = { kind: "wanta-account" } | { kind: "agent-cli"; loginCommand: string }

export interface AgentProfile {
  kind: AgentKind
  /** Engine-technical name; user-facing labels are resolved via i18n by kind. */
  displayName: string
  modelSource: AgentModelSource
  auth: AgentAuthMode
  inputs: AgentInputCapabilityFlags
  history: AgentHistoryCapabilities
}

export const AGENT_PROFILES = {
  opencode: {
    kind: "opencode",
    displayName: "Built-in Agent",
    modelSource: "wanta",
    auth: { kind: "wanta-account" },
    inputs: {
      attachments: true,
      modes: true,
      reasoningLevels: true,
      systemPrompt: true,
      permissionResponse: true,
      questionResponse: true,
    },
    history: { list: true, read: true, resume: true },
  },
} as const satisfies Record<AgentKind, AgentProfile>
