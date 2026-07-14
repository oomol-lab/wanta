import type { AgentMode } from "./common.ts"

export interface ChatTurnExecution {
  artifactProjectRoot?: string
  mode?: AgentMode
}

export function resolveChatTurnExecution(options: {
  forcedMode?: AgentMode
  requestedMode?: AgentMode
  trustedProjectRoot?: string
}): ChatTurnExecution {
  const mode = options.forcedMode ?? options.requestedMode
  return {
    ...(mode ? { mode } : {}),
    ...(mode !== "plan" && options.trustedProjectRoot ? { artifactProjectRoot: options.trustedProjectRoot } : {}),
  }
}
