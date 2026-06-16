import type { ChatAttachment, ChatMessage } from "../../../electron/chat/common.ts"
import type { ModelChoice } from "../../../electron/models/common.ts"

export interface PendingChatTransition {
  sessionId: string | null
  text: string
  attachments: ChatAttachment[]
  model?: ModelChoice
  createdAt: number
}

function hasUserVisibleContent(message: ChatMessage): boolean {
  if (message.role !== "user") {
    return false
  }
  return message.parts.some(
    (part) =>
      (part.kind === "text" && Boolean(part.text?.trim())) || (part.kind === "attachment" && Boolean(part.attachment)),
  )
}

export function isPendingChatCaughtUp(
  pending: PendingChatTransition | null,
  activeSessionId: string | null,
  messages: ChatMessage[],
): boolean {
  return Boolean(
    pending?.sessionId &&
    activeSessionId === pending.sessionId &&
    messages.some((message) => hasUserVisibleContent(message)),
  )
}
