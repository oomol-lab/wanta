import type {
  AgentMode,
  AgentPermissionMode,
  ChatAttachment,
  ChatContextMention,
  ChatMessage,
  ReasoningLevel,
} from "../../../electron/chat/common.ts"
import type { ModelChoice } from "../../../electron/models/common.ts"

export interface PendingChatTransition {
  sessionId: string | null
  scopeKey: string
  text: string
  attachments: ChatAttachment[]
  contextMentions?: ChatContextMention[]
  model?: ModelChoice
  reasoningLevel?: ReasoningLevel
  mode?: AgentMode
  permissionMode?: AgentPermissionMode
  createdAt: number
}

const pendingServerMatchSkewMs = 30_000

function hasUserVisibleContent(message: ChatMessage): boolean {
  if (message.role !== "user") {
    return false
  }
  return message.parts.some(
    (part) =>
      (part.kind === "text" && Boolean(part.text?.trim())) || (part.kind === "attachment" && Boolean(part.attachment)),
  )
}

function userMessageText(message: ChatMessage): string {
  return message.parts
    .filter((part) => part.kind === "text")
    .map((part) => part.text ?? "")
    .join("")
}

function attachmentKey(attachment: ChatAttachment): string {
  return [
    attachment.path,
    attachment.id,
    attachment.name,
    attachment.mime,
    String(attachment.size),
    attachment.kind ?? "",
  ].join("\0")
}

function userMessageAttachmentKey(message: ChatMessage): string {
  return message.parts
    .filter((part) => part.kind === "attachment" && part.attachment)
    .map((part) => attachmentKey(part.attachment as ChatAttachment))
    .sort()
    .join("\0\0")
}

function pendingAttachmentKey(pending: PendingChatTransition): string {
  return pending.attachments.map(attachmentKey).sort().join("\0\0")
}

function matchesPendingUserMessage(pending: PendingChatTransition, message: ChatMessage): boolean {
  return (
    userMessageText(message) === pending.text && userMessageAttachmentKey(message) === pendingAttachmentKey(pending)
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
    messages.some(
      (message) =>
        message.role === "user" &&
        hasUserVisibleContent(message) &&
        (message.createdAt >= pending.createdAt ||
          (message.createdAt >= pending.createdAt - pendingServerMatchSkewMs &&
            matchesPendingUserMessage(pending, message))),
    ),
  )
}
