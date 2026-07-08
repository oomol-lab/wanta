import type { ChatStatus } from "ai"

export type ChatTurnState =
  | { chatStatus: ChatStatus; status: "idle" }
  | { chatStatus: "submitted"; initialSendPending: boolean; status: "submitting" }
  | { chatStatus: "streaming"; status: "streaming" }
  | { chatStatus: ChatStatus; pendingPermissionCount: number; status: "awaiting_permission" }
  | { chatStatus: ChatStatus; pendingQuestionCount: number; status: "awaiting_question" }
  | { chatStatus: "error"; status: "failed" }

export interface ResolveChatTurnStateInput {
  initialSendPending: boolean
  pendingPermissionCount: number
  pendingQuestionCount: number
  status: ChatStatus
}

export function resolveChatTurnState(input: ResolveChatTurnStateInput): ChatTurnState {
  if (input.pendingPermissionCount > 0) {
    return {
      chatStatus: input.status,
      pendingPermissionCount: input.pendingPermissionCount,
      status: "awaiting_permission",
    }
  }
  if (input.pendingQuestionCount > 0) {
    return {
      chatStatus: input.status,
      pendingQuestionCount: input.pendingQuestionCount,
      status: "awaiting_question",
    }
  }
  if (input.status === "submitted") {
    return { chatStatus: "submitted", initialSendPending: input.initialSendPending, status: "submitting" }
  }
  if (input.status === "streaming") {
    return { chatStatus: "streaming", status: "streaming" }
  }
  if (input.status === "error") {
    return { chatStatus: "error", status: "failed" }
  }
  return { chatStatus: input.status, status: "idle" }
}

export function chatTurnQueuesNewMessage(state: ChatTurnState): boolean {
  return (
    state.status === "submitting" ||
    state.status === "streaming" ||
    state.status === "awaiting_permission" ||
    state.status === "awaiting_question"
  )
}

export function chatTurnAllowsDirectSend(state: ChatTurnState): boolean {
  return !chatTurnQueuesNewMessage(state)
}

export function chatTurnAllowsStop(state: ChatTurnState): boolean {
  return (
    state.status === "submitting" ||
    state.status === "streaming" ||
    (state.status === "awaiting_question" && state.chatStatus === "streaming")
  )
}

export function chatTurnBlocksQueueDispatch(state: ChatTurnState): boolean {
  return chatTurnQueuesNewMessage(state)
}

export function chatTurnShowsGenerating(state: ChatTurnState): boolean {
  return state.status === "submitting" || state.status === "streaming"
}
