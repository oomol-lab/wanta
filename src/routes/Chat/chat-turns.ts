import type { AssistantActivityEvent, ChatMessage, ChatMessagePart } from "../../../electron/chat/common.ts"

import { hasBlockingToolError, hasStoppedTool } from "./tool-state.ts"

export interface ChatTurn {
  id: string
  user: ChatMessage | null
  assistants: ChatMessage[]
}

export interface ChatTurnProcess {
  tools: ChatMessagePart[]
  errors: ChatMessagePart[]
  hasFinalAnswer: boolean
  hasActiveTool: boolean
  hasBlockingError: boolean
  hasStoppedTool: boolean
  hasAuthorization: boolean
  activity: AssistantActivityEvent | null
  startedAt?: number
  endedAt?: number
}

export function groupChatTurns(messages: ChatMessage[]): ChatTurn[] {
  const turns: ChatTurn[] = []
  let current: ChatTurn | null = null

  const pushCurrent = (): void => {
    if (current) {
      turns.push(current)
      current = null
    }
  }

  for (const message of messages) {
    if (message.role === "user") {
      pushCurrent()
      current = { id: message.clientId ?? message.id, user: message, assistants: [] }
      continue
    }

    if (!current) {
      current = { id: message.clientId ?? message.id, user: null, assistants: [] }
    }
    current.assistants.push(message)
  }

  pushCurrent()
  return turns
}

export function assistantTextParts(message: ChatMessage): ChatMessagePart[] {
  return message.parts.filter((part) => part.kind === "text" && Boolean(part.text?.trim()))
}

export function assistantErrorParts(message: ChatMessage): ChatMessagePart[] {
  return message.parts.filter((part) => part.kind === "error")
}

export function summarizeTurnProcess(
  turn: ChatTurn,
  activity: AssistantActivityEvent | null,
  activeAssistantMessageId?: string,
): ChatTurnProcess {
  const tools = turn.assistants.flatMap((message) => message.parts.filter((part) => part.kind === "tool"))
  const errors = turn.assistants.flatMap(assistantErrorParts)
  const hasFinalAnswer = turn.assistants.some((message) => assistantTextParts(message).length > 0)
  const activeTurnActivity =
    activity &&
    (!activity.messageId && !activeAssistantMessageId
      ? true
      : turn.assistants.some((message) => message.id === activeAssistantMessageId || message.id === activity.messageId))
      ? activity
      : null
  const timings = tools
    .map((part) => part.timing)
    .filter((timing): timing is NonNullable<ChatMessagePart["timing"]> => Boolean(timing))
  const timingStarts = timings
    .map((timing) => timing.start)
    .filter((value): value is number => typeof value === "number")
  const timingEnds = timings.map((timing) => timing.end).filter((value): value is number => typeof value === "number")
  const messageTimes = [turn.user?.createdAt, ...turn.assistants.map((message) => message.createdAt)].filter(
    (value): value is number => typeof value === "number" && Number.isFinite(value),
  )
  const startedAt =
    timingStarts.length > 0
      ? Math.min(...timingStarts)
      : messageTimes.length > 0
        ? Math.min(...messageTimes)
        : undefined
  const endedAt = timingEnds.length > 0 ? Math.max(...timingEnds) : undefined

  return {
    tools,
    errors,
    hasFinalAnswer,
    hasActiveTool: tools.some((part) => part.status === "pending" || part.status === "running"),
    hasBlockingError: hasBlockingToolError(tools) || errors.length > 0,
    hasStoppedTool: hasStoppedTool(tools),
    hasAuthorization: tools.some(
      (part) =>
        part.tool === "call_action" &&
        part.status === "completed" &&
        Boolean(part.output?.includes("authorization_required")),
    ),
    activity: activeTurnActivity,
    startedAt,
    endedAt,
  }
}
