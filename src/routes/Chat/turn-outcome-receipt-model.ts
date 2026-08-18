import type { ChatTurnProcess, ChatTurnProcessStatus } from "./chat-turns.ts"

import { chatTurnProcessStatus } from "./chat-turns.ts"

export function terminalTurnOutcomeStatus(
  process: Pick<
    ChatTurnProcess,
    | "activity"
    | "errors"
    | "hasActiveTool"
    | "hasAuthorization"
    | "hasBlockingError"
    | "hasStoppedTool"
    | "hasToolError"
    | "hasVisibleOutcome"
    | "tools"
  >,
  turnIsActive: boolean,
): ChatTurnProcessStatus | null {
  if (turnIsActive || process.hasVisibleOutcome || process.activity) {
    return null
  }
  if (process.tools.length === 0 && process.errors.length === 0) {
    return null
  }
  return chatTurnProcessStatus(process, false)
}
