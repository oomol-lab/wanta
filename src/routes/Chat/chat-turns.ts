import type {
  AuthorizationInfo,
  AssistantActivityEvent,
  ChatAttachment,
  ChatMessage,
  ChatMessagePart,
} from "../../../electron/chat/common.ts"

import { parseSearchAuthorizationSignal } from "../../../electron/chat/authorization-signal.ts"
import { normalizeServiceSlug, parseToolAuthorization } from "./tool-display.ts"
import { hasBlockingToolError, hasStoppedTool, isActiveToolPart } from "./tool-state.ts"

export interface ChatTurn {
  id: string
  user: ChatMessage | null
  assistants: ChatMessage[]
}

export interface ChatTurnRetrySource {
  text: string
  attachments: ChatAttachment[]
  userMessageId: string
  userClientId?: string
}

export interface ChatTurnProcess {
  tools: ChatMessagePart[]
  errors: ChatMessagePart[]
  hasFinalAnswer: boolean
  hasActiveTool: boolean
  hasToolError: boolean
  hasBlockingError: boolean
  hasStoppedTool: boolean
  hasAuthorization: boolean
  hasSuccessfulConnectorCall: boolean
  suggestedAuthorization?: AuthorizationInfo
  activity: AssistantActivityEvent | null
  startedAt?: number
  endedAt?: number
}

export type ChatTurnProcessStatus =
  | "running"
  | "completed"
  | "completedWithIssues"
  | "retrying"
  | "needsAction"
  | "error"
  | "stopped"

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

function sameChatTurn(left: ChatTurn, right: ChatTurn): boolean {
  return (
    left.id === right.id &&
    left.user === right.user &&
    left.assistants.length === right.assistants.length &&
    left.assistants.every((message, index) => message === right.assistants[index])
  )
}

export function reuseStableChatTurns(previous: ChatTurn[], next: ChatTurn[]): ChatTurn[] {
  let changed = previous.length !== next.length
  const turns = next.map((turn, index) => {
    const current = previous[index]
    if (current && sameChatTurn(current, turn)) {
      return current
    }
    changed = true
    return turn
  })
  return changed ? turns : previous
}

export function latestAssistantMessage(messages: ChatMessage[]): ChatMessage | undefined {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index]
    if (message?.role === "assistant") {
      return message
    }
  }
  return undefined
}

export function userMessageText(message: Pick<ChatMessage, "parts">): string {
  return message.parts
    .filter((part) => part.kind === "text")
    .map((part) => part.text ?? "")
    .join("")
}

export function userMessageAttachments(message: Pick<ChatMessage, "parts">): ChatAttachment[] {
  return message.parts
    .filter((part) => part.kind === "attachment" && part.attachment)
    .map((part) => part.attachment as ChatAttachment)
}

export function chatTurnInputKey(input: Pick<ChatTurnRetrySource, "attachments" | "text">): string {
  const attachmentsKey = input.attachments
    .map((attachment) =>
      [
        attachment.path,
        attachment.id,
        attachment.name,
        attachment.mime,
        String(attachment.size),
        attachment.kind ?? "",
      ].join("\0"),
    )
    .sort()
    .join("\0\0")
  return `${input.text}\0---\0${attachmentsKey}`
}

export function retrySourceFromTurn(turn: ChatTurn): ChatTurnRetrySource | null {
  if (!turn.user) {
    return null
  }
  const text = userMessageText(turn.user)
  const attachments = userMessageAttachments(turn.user)
  if (!text && attachments.length === 0) {
    return null
  }
  return {
    text,
    attachments,
    userMessageId: turn.user.id,
    ...(turn.user.clientId ? { userClientId: turn.user.clientId } : {}),
  }
}

export function activityForChatTurn(
  turn: ChatTurn,
  activity: AssistantActivityEvent | null,
  activeAssistantMessageId: string | undefined,
  isLatestTurn: boolean,
): AssistantActivityEvent | null {
  if (!activity) {
    return null
  }
  const targetMessageId = activity.messageId ?? activeAssistantMessageId
  if (!targetMessageId) {
    return isLatestTurn ? activity : null
  }
  return turn.assistants.some((message) => message.id === targetMessageId) ? activity : null
}

export function assistantTextParts(message: ChatMessage): ChatMessagePart[] {
  return message.parts.filter((part) => part.kind === "text" && Boolean(part.text?.trim()))
}

export function assistantErrorParts(message: ChatMessage): ChatMessagePart[] {
  return message.parts.filter((part) => part.kind === "error")
}

function successfulCallActionServices(tools: ChatMessagePart[]): Set<string> {
  const services = new Set<string>()
  for (const part of tools) {
    if (part.tool !== "call_action" || part.status !== "completed" || typeof part.input?.service !== "string") {
      continue
    }
    try {
      const parsed = JSON.parse(part.output ?? "{}") as { status?: unknown }
      if (parsed.status === "error" || parsed.status === "authorization_required") {
        continue
      }
      services.add(normalizeServiceSlug(part.input.service))
    } catch {
      // Unknown output shape is not enough evidence that authorization is valid.
    }
  }
  return services
}

function suggestedAuthorizationFromTools(tools: ChatMessagePart[]): AuthorizationInfo | undefined {
  const successfulServices = successfulCallActionServices(tools)
  if (successfulServices.size > 0) {
    return undefined
  }
  for (const part of tools) {
    if (part.tool !== "search_actions" || part.status !== "completed") {
      continue
    }
    const authorization = parseSearchAuthorizationSignal(part.output, part.input)
    if (authorization) {
      return authorization
    }
  }
  return undefined
}

function searchAuthorizationContext(
  input: Record<string, unknown> | undefined,
  userText: string,
): { keywords?: unknown; query?: unknown; userText?: string } {
  return {
    keywords: input?.keywords,
    query: input?.query,
    ...(userText ? { userText } : {}),
  }
}

export function shouldShowSuggestedAuthorization(
  process: Pick<ChatTurnProcess, "activity" | "hasActiveTool" | "suggestedAuthorization">,
  turnIsActive: boolean,
): boolean {
  return Boolean(process.suggestedAuthorization && !turnIsActive && !process.hasActiveTool && !process.activity)
}

export function isLiveTurnProcess(
  process: Pick<ChatTurnProcess, "activity" | "hasActiveTool" | "tools">,
  live = false,
): boolean {
  return live && (process.tools.length > 0 || process.hasActiveTool || Boolean(process.activity))
}

export function chatTurnProcessStatus(
  process: Pick<
    ChatTurnProcess,
    "activity" | "hasActiveTool" | "hasAuthorization" | "hasBlockingError" | "hasStoppedTool" | "hasToolError" | "tools"
  >,
  live = false,
): ChatTurnProcessStatus {
  if (process.activity?.phase === "retrying") {
    return "retrying"
  }
  if (isLiveTurnProcess(process, live)) {
    return "running"
  }
  if (process.hasAuthorization) {
    return "needsAction"
  }
  if (process.hasBlockingError) {
    return "error"
  }
  if (process.hasToolError) {
    return "completedWithIssues"
  }
  if (process.hasStoppedTool) {
    return "stopped"
  }
  if (process.hasActiveTool) {
    return "stopped"
  }
  return "completed"
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

  const hasToolError = hasBlockingToolError(tools)
  const hasAuthorization = tools.some((part) => Boolean(parseToolAuthorization(part)))
  const hasSuccessfulConnectorCall = successfulCallActionServices(tools).size > 0
  const userText = turn.user ? userMessageText(turn.user) : ""

  return {
    tools,
    errors,
    hasFinalAnswer,
    hasActiveTool: tools.some(isActiveToolPart),
    hasToolError,
    hasBlockingError: errors.length > 0 || (hasToolError && !hasFinalAnswer),
    hasStoppedTool: hasStoppedTool(tools),
    hasAuthorization,
    hasSuccessfulConnectorCall,
    ...(hasAuthorization
      ? {}
      : {
          suggestedAuthorization: suggestedAuthorizationFromTools(
            tools.map((part) =>
              part.tool === "search_actions"
                ? { ...part, input: searchAuthorizationContext(part.input, userText) }
                : part,
            ),
          ),
        }),
    activity: activeTurnActivity,
    startedAt,
    endedAt,
  }
}

export function shouldShowTurnProcess(process: Pick<ChatTurnProcess, "activity" | "tools">): boolean {
  return process.tools.length > 0 || process.activity?.phase === "retrying"
}

export function shouldShowPlainTurnActivity(
  process: Pick<ChatTurnProcess, "activity" | "errors" | "hasFinalAnswer" | "tools">,
): boolean {
  return Boolean(
    process.activity &&
    process.activity.phase !== "retrying" &&
    process.tools.length === 0 &&
    process.errors.length === 0 &&
    !process.hasFinalAnswer,
  )
}
