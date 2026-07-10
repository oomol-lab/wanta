import type { ChatEmit } from "../agent/event-translator.ts"
import type { AgentEventConnectionStatus } from "../agent/manager.ts"
import type { GenerationInterruptedReason, GenerationNoticeKind } from "./common.ts"

export type InactivityWatchdogAction = "pause" | "schedule"

export interface GenerationInactivityState {
  activeToolCount: number
  blocked: boolean
}

export interface TerminalConnectionInterruption {
  message: string
  reason: GenerationInterruptedReason
}

export function inactivityWatchdogActionForEvent(event: ChatEmit["event"]): InactivityWatchdogAction {
  return event === "questionAsked" || event === "permissionAsked" ? "pause" : "schedule"
}

export function generationNoticeKindForInactivity(state: GenerationInactivityState): GenerationNoticeKind | null {
  if (state.blocked) {
    return null
  }
  return state.activeToolCount > 0 ? "tool_running_without_output" : "generation_stale"
}

export function terminalConnectionInterruption(
  status: AgentEventConnectionStatus,
): TerminalConnectionInterruption | null {
  switch (status.status) {
    case "failed":
      return {
        message: "CHAT_COMPLETION_INTERRUPTED: OpenCode event stream reconnection failed.",
        reason: "connection_failed",
      }
    case "runtime_recovered":
      return {
        message: "CHAT_COMPLETION_INTERRUPTED: OpenCode runtime restarted before this turn completed.",
        reason: "runtime_restarted",
      }
    case "runtime_failed":
      return {
        message: "CHAT_COMPLETION_INTERRUPTED: OpenCode runtime could not restart.",
        reason: "runtime_failed",
      }
    case "reconnected":
    case "reconnecting":
    case "runtime_restarting":
      return null
  }
}
