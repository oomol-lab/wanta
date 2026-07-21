export type WantaAgentMode = "build" | "plan"

export const WANTA_BUILD_AGENT_NAME = "build"
export const WANTA_PLAN_AGENT_NAME = "plan"
export const WANTA_GENERAL_SUBAGENT_NAME = "general"
export const WANTA_DEFAULT_AGENT_MODE: WantaAgentMode = WANTA_BUILD_AGENT_NAME
export const WANTA_AGENT_MODES = [WANTA_BUILD_AGENT_NAME, WANTA_PLAN_AGENT_NAME] as const

export function normalizeWantaAgentMode(mode: WantaAgentMode | undefined): WantaAgentMode {
  return mode === WANTA_PLAN_AGENT_NAME ? WANTA_PLAN_AGENT_NAME : WANTA_DEFAULT_AGENT_MODE
}
