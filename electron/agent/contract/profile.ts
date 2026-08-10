import type { AcpAgentKind } from "../acp/registry.ts"

import { ACP_AGENT_REGISTRY } from "../acp/registry.ts"

// Central capability declaration for every agent kind (BYOA).
//
// One AgentProfile per agent, all in one place, exhaustively checked at compile
// time via `satisfies Record<AgentKind, AgentProfile>`. UI and chat logic must
// derive behavior (model selector, BYOK panel, login prompts, history loading)
// from these declarations and from reflected adapter events — never from
// `if (agent === "...")` branches.

/** Closed set of integrated agents: built-in kernel, native adapters, and ACP registry entries. */
export type AgentKind = "opencode" | "claude-code" | AcpAgentKind

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

/**
 * External agents own their models, auth, and system prompts; Wanta reflects
 * them and never routes models or injects prompt tails.
 */
const externalAgentInputs: AgentInputCapabilityFlags = {
  attachments: false,
  modes: false,
  reasoningLevels: false,
  systemPrompt: false,
  permissionResponse: true,
  questionResponse: false,
}

/** In-run transcript reads only; no history listing or cross-restart resume yet. */
const externalAgentHistory: AgentHistoryCapabilities = { list: false, read: true, resume: false }

function acpAgentProfiles(): Record<AcpAgentKind, AgentProfile> {
  const profiles = {} as Record<AcpAgentKind, AgentProfile>
  for (const [kind, registration] of Object.entries(ACP_AGENT_REGISTRY)) {
    profiles[kind as AcpAgentKind] = {
      kind: kind as AcpAgentKind,
      displayName: registration.displayName,
      modelSource: "agent",
      auth: { kind: "agent-cli", loginCommand: registration.loginHint },
      inputs: externalAgentInputs,
      history: externalAgentHistory,
    }
  }
  return profiles
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
  "claude-code": {
    kind: "claude-code",
    displayName: "Claude Code",
    modelSource: "agent",
    auth: { kind: "agent-cli", loginCommand: "Run `claude` in a terminal and sign in, then retry." },
    inputs: externalAgentInputs,
    history: externalAgentHistory,
  },
  ...acpAgentProfiles(),
} satisfies Record<AgentKind, AgentProfile> as Record<AgentKind, AgentProfile>

/** Agent kinds handled by external adapters (everything except the built-in kernel). */
export type ExternalAgentKind = Exclude<AgentKind, "opencode">

export const EXTERNAL_AGENT_KINDS = (Object.keys(AGENT_PROFILES) as AgentKind[]).filter(
  (kind): kind is ExternalAgentKind => kind !== "opencode",
)

export function isExternalAgentKind(kind: AgentKind): kind is ExternalAgentKind {
  return kind !== "opencode"
}
