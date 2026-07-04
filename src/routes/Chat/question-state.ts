import type { ChatQuestionRequest } from "../../../electron/chat/common.ts"

export type ChatQuestionState = "active" | "stopped"

export interface ChatPendingQuestion {
  request: ChatQuestionRequest
  state: ChatQuestionState
}
