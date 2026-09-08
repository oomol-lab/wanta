import type { ChatMessage } from "./common.ts"

import { toolPolicyErrorCode } from "./error.ts"

export interface TurnPermissionRejection {
  source: "policy" | "user"
  reason?: string
  messageId?: string
  callId?: string
}

export type TurnCompletionEvidence =
  | { kind: "completed"; assistant: ChatMessage }
  | { kind: "history_unavailable" | "missing_turn" | "missing_response" }
  | { kind: "tools_running" }
  | { kind: "permission_blocked"; rejection: TurnPermissionRejection }

/** Match host-owned rejection metadata to the last step, never to model prose. */
export function inspectTurnCompletion(
  messages: readonly ChatMessage[],
  userMessageId: string,
  rejections: readonly TurnPermissionRejection[] = [],
): TurnCompletionEvidence {
  const userIndex = messages.findIndex((message) => message.id === userMessageId && message.role === "user")
  if (userIndex < 0) return { kind: "missing_turn" }
  const turn = messages.slice(userIndex + 1)
  // History from a newer user turn cannot prove completion of this generation.
  const nextUser = turn.findIndex((message) => message.role === "user")
  const assistant = (nextUser < 0 ? turn : turn.slice(0, nextUser)).findLast((message) => message.role === "assistant")
  if (!assistant) return { kind: "missing_response" }
  if (
    assistant.parts.some((part) => part.kind === "tool" && (part.status === "pending" || part.status === "running"))
  ) {
    return { kind: "tools_running" }
  }
  const finish = assistant.finishReason?.trim().toLowerCase().replaceAll("_", "-")
  if (!["tool-calls", "tool-use"].includes(finish ?? "") && (finish || assistant.completedAt !== undefined)) {
    return { kind: "completed", assistant }
  }
  const rejection = rejections.findLast(
    (item) =>
      item.messageId === assistant.id &&
      item.callId !== undefined &&
      assistant.parts.some((part) => part.kind === "tool" && part.callId === item.callId && part.status === "error"),
  )
  return rejection ? { kind: "permission_blocked", rejection } : { kind: "missing_response" }
}

export function permissionRejectionMessage(rejection: TurnPermissionRejection): string {
  return rejection.source === "policy"
    ? `Wanta automatically blocked this tool call under its permission policy (${rejection.reason ?? "unspecified"}). This was not a user rejection. Do not retry the blocked operation or bypass the policy. Use an allowed alternative or explain what remains incomplete.`
    : "The user declined this tool call. Do not repeat it without new authorization. Explain what remains incomplete."
}

export function completionFailureMessage(
  evidence: Exclude<TurnCompletionEvidence, { kind: "completed" | "tools_running" }>,
): string {
  if (evidence.kind === "permission_blocked") {
    return evidence.rejection.source === "policy"
      ? `${toolPolicyErrorCode(evidence.rejection.reason)}: Wanta stopped this turn after automatically blocking a tool call (${evidence.rejection.reason ?? "unspecified"}). Previously completed operations were not rolled back.`
      : "CHAT_TOOL_USER_DECLINED: This turn ended after you declined a tool call. Previously completed operations were not rolled back."
  }
  if (evidence.kind === "history_unavailable" || evidence.kind === "missing_turn") {
    return "CHAT_HISTORY_UNAVAILABLE: Unable to verify this turn in the saved conversation history. Previously executed operations may already have taken effect."
  }
  return "CHAT_RESPONSE_INCOMPLETE: The agent stopped without a final response. Previously completed operations were not rolled back."
}
