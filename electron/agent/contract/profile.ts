import type { AgentPermissionMode } from "../../chat/common.ts"
import type { AcpAgentKind, AcpAgentRegistration } from "../acp/registry.ts"

import { AGENT_PERMISSION_MODES } from "../../chat/common.ts"
import { ACP_AGENT_REGISTRY } from "../acp/registry.ts"

// Central capability declaration for every agent kind (BYOA).
//
// One AgentProfile per agent, all in one place, exhaustively checked at compile
// time via `satisfies Record<AgentKind, AgentProfile>`. UI and chat logic must
// derive behavior (model selector, BYOK panel, login prompts, history loading)
// from these declarations and from reflected adapter events — never from
// `if (agent === "...")` branches.

/** Closed set of integrated agents: built-in kernel plus registry-backed ACP agents. */
export type AgentKind = "opencode" | AcpAgentKind

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
  /** Settling permissionAsked events via permission-response inputs. */
  permissionResponse: boolean
  /** Settling questionAsked events via question-response inputs. */
  questionResponse: boolean
  /** Agent-native model selection via set-model inputs (and prompt agentModelId). */
  setModel: boolean
  /** Agent-native reasoning-effort selection via set-effort inputs (and prompt agentEffortId). */
  setEffort: boolean
}

/** Canonical display order of the normalized permission modes. */
export const AGENT_PERMISSION_MODE_ORDER: readonly AgentPermissionMode[] = AGENT_PERMISSION_MODES

/**
 * Who owns model selection for this agent. "wanta" means the Wanta model
 * catalog applies (model selector and BYOK UI visible); "agent" means the
 * agent brings its own models and Wanta must hide model routing UI.
 */
export type AgentModelSource = "wanta" | "agent"

/**
 * How the agent authenticates. An external harness may use Wanta's account or
 * BYOK model route without receiving the underlying provider credential.
 */
export type AgentAuthMode = { kind: "wanta-account" } | { kind: "agent-cli"; loginCommand: string }

export interface AgentProfile {
  kind: AgentKind
  /** Engine-technical name; user-facing labels are resolved via i18n by kind. */
  displayName: string
  modelSource: AgentModelSource
  auth: AgentAuthMode
  inputs: AgentInputCapabilityFlags
  /** Normalized permission modes this agent supports, in display order. */
  permissionModes: readonly AgentPermissionMode[]
}

/**
 * External agents own their native base prompts. Each registration declares
 * whether model/auth routing stays agent-owned or uses Wanta. ACP has no
 * portable dynamic system-prompt field, so Wanta's per-turn host context uses
 * a delimited compatibility block while host capabilities enforce identity
 * outside the prompt. Attachments are delivered as file references.
 */
const externalAgentInputs: AgentInputCapabilityFlags = {
  attachments: true,
  modes: false,
  permissionResponse: true,
  questionResponse: false,
  setModel: false,
  setEffort: false,
}

function acpAgentProfiles(): Record<AcpAgentKind, AgentProfile> {
  const profiles = {} as Record<AcpAgentKind, AgentProfile>
  const entries = Object.entries(ACP_AGENT_REGISTRY) as Array<[AcpAgentKind, AcpAgentRegistration]>
  for (const [kind, registration] of entries) {
    const modeMap = registration.permissionModeMap ?? {}
    profiles[kind] = {
      kind,
      displayName: registration.displayName,
      modelSource: registration.modelSource ?? "agent",
      auth:
        registration.modelSource === "wanta"
          ? { kind: "wanta-account" }
          : { kind: "agent-cli", loginCommand: registration.loginHint },
      inputs: {
        ...externalAgentInputs,
        setModel: registration.selection?.model ?? false,
        setEffort: registration.selection?.effort ?? false,
      },
      // No mode map = the agent keeps its own approval flow; "default" is the
      // only declarable stance (single-mode agents render no picker).
      permissionModes: registration.permissionModeMap
        ? AGENT_PERMISSION_MODE_ORDER.filter((mode) => mode in modeMap)
        : ["default"],
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
      permissionResponse: true,
      questionResponse: true,
      setModel: false,
      setEffort: false,
    },
    permissionModes: ["default", "full_access"],
  },
  ...acpAgentProfiles(),
} satisfies Record<AgentKind, AgentProfile> as Record<AgentKind, AgentProfile>

/** The agent's login-command hint; empty for Wanta-account agents. */
export function agentLoginHint(kind: AgentKind): string {
  const auth = AGENT_PROFILES[kind].auth
  return auth.kind === "agent-cli" ? auth.loginCommand : ""
}

/** Agent kinds handled by external adapters (everything except the built-in kernel). */
export type ExternalAgentKind = Exclude<AgentKind, "opencode">

export const EXTERNAL_AGENT_KINDS = (Object.keys(AGENT_PROFILES) as AgentKind[]).filter(
  (kind): kind is ExternalAgentKind => kind !== "opencode",
)

export function isExternalAgentKind(kind: AgentKind): kind is ExternalAgentKind {
  return kind !== "opencode"
}
