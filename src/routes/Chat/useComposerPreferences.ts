import type { AgentMode, ReasoningLevel } from "../../../electron/chat/common.ts"

import * as React from "react"
import { WANTA_AGENT_MODES, WANTA_DEFAULT_AGENT_MODE } from "../../../electron/agent/mode.ts"
import { WANTA_DEFAULT_REASONING_LEVEL, WANTA_REASONING_LEVELS } from "../../../electron/agent/reasoning.ts"

const reasoningLevelStorageKey = "wanta:chat:reasoning-level"
const reasoningLevels = new Set<ReasoningLevel>(WANTA_REASONING_LEVELS)
const agentModeStorageKey = "wanta:chat:agent-mode"
const agentModes = new Set<AgentMode>(WANTA_AGENT_MODES)

function readStoredReasoningLevel(): ReasoningLevel {
  try {
    const stored = globalThis.localStorage?.getItem(reasoningLevelStorageKey)
    return reasoningLevels.has(stored as ReasoningLevel) ? (stored as ReasoningLevel) : WANTA_DEFAULT_REASONING_LEVEL
  } catch {
    return WANTA_DEFAULT_REASONING_LEVEL
  }
}

function writeStoredReasoningLevel(level: ReasoningLevel): void {
  try {
    globalThis.localStorage?.setItem(reasoningLevelStorageKey, level)
  } catch {
    // localStorage 不可用时保持本次会话内状态即可。
  }
}

function readStoredAgentMode(): AgentMode {
  try {
    const stored = globalThis.localStorage?.getItem(agentModeStorageKey)
    return agentModes.has(stored as AgentMode) ? (stored as AgentMode) : WANTA_DEFAULT_AGENT_MODE
  } catch {
    return WANTA_DEFAULT_AGENT_MODE
  }
}

function writeStoredAgentMode(mode: AgentMode): void {
  try {
    globalThis.localStorage?.setItem(agentModeStorageKey, mode)
  } catch {
    // localStorage 不可用时保持本次会话内状态即可。
  }
}

export function useComposerPreferences() {
  const [agentMode, setAgentModeState] = React.useState<AgentMode>(readStoredAgentMode)
  const [reasoningLevel, setReasoningLevelState] = React.useState<ReasoningLevel>(readStoredReasoningLevel)

  const setReasoningLevel = React.useCallback((level: ReasoningLevel): void => {
    setReasoningLevelState(level)
    writeStoredReasoningLevel(level)
  }, [])

  const setAgentMode = React.useCallback((mode: AgentMode): void => {
    setAgentModeState(mode)
    writeStoredAgentMode(mode)
  }, [])

  return {
    agentMode,
    reasoningLevel,
    setAgentMode,
    setReasoningLevel,
  }
}
