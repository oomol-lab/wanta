import type { ChatQuestionRequest } from "../../../electron/chat/common.ts"
import type { ChatStatus } from "ai"

export type ChatQuestionState = "active" | "stopped"

export interface ChatPendingQuestion {
  request: ChatQuestionRequest
  state: ChatQuestionState
}

export function questionPromptBusy(state: ChatQuestionState, status: ChatStatus): boolean {
  return state === "active" && status === "submitted"
}

export function shouldStopBeforeDiscardingQuestion(state: ChatQuestionState, isGenerating: boolean): boolean {
  return state === "stopped" && isGenerating
}
