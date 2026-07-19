import type {
  ChatAttachment,
  ChatContextMention,
  AgentConnectionChangedEvent,
  ChatMessage,
  ChatMessagePart,
  GenerationInterruptedEvent,
  GenerationNoticeEvent,
  ChatQuestionRequest,
  ChatRole,
  MessageAttachmentEvent,
  MessageDeltaEvent,
  MessageErrorEvent,
  MessagePartRemovedEvent,
  MessageReasoningDeltaEvent,
  MessageStartedEvent,
} from "../../electron/chat/common.ts"

export type TextDeltaKind = "reasoning" | "text"
export type TextDeltaEvent = MessageDeltaEvent | MessageReasoningDeltaEvent

let localMessageSequence = 0

function upsertPart(parts: ChatMessagePart[], part: ChatMessagePart): ChatMessagePart[] {
  const index = parts.findIndex((p) => p.partId === part.partId)
  if (index === -1) {
    return [...parts, part]
  }
  const next = parts.slice()
  next[index] = { ...next[index], ...part }
  return next
}

export function textDeltaKey(kind: TextDeltaKind, event: TextDeltaEvent): string {
  return `${kind}\0${event.sessionId}\0${event.messageId}\0${event.partId}`
}

export function coalesceTextDeltaEvent<T extends TextDeltaEvent>(current: T | undefined, next: T): T {
  if (!current) {
    return next
  }
  if (next.text) {
    return next
  }
  if (!next.delta) {
    return current
  }
  if (current.text) {
    return { ...next, text: current.text + next.delta, delta: undefined }
  }
  return { ...next, delta: `${current.delta ?? ""}${next.delta}` }
}

function createClientId(kind: ChatRole): string {
  localMessageSequence += 1
  return `client-${kind}-${Date.now()}-${localMessageSequence}`
}

function serverClientId(id: string): string {
  return `server-${id}`
}

function jsonLikeEqual(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) {
    return true
  }
  try {
    return JSON.stringify(left) === JSON.stringify(right)
  } catch {
    return false
  }
}

function sameMessagePart(left: ChatMessagePart, right: ChatMessagePart): boolean {
  return (
    left.kind === right.kind &&
    left.partId === right.partId &&
    left.text === right.text &&
    left.statusType === right.statusType &&
    left.attempt === right.attempt &&
    left.maxAttempts === right.maxAttempts &&
    left.errorText === right.errorText &&
    left.errorKind === right.errorKind &&
    left.errorCode === right.errorCode &&
    left.callId === right.callId &&
    left.tool === right.tool &&
    left.status === right.status &&
    left.output === right.output &&
    left.error === right.error &&
    left.title === right.title &&
    left.attachmentsCount === right.attachmentsCount &&
    left.cancelled === right.cancelled &&
    jsonLikeEqual(left.attachment, right.attachment) &&
    jsonLikeEqual(left.input, right.input) &&
    jsonLikeEqual(left.metadata, right.metadata) &&
    jsonLikeEqual(left.timing, right.timing) &&
    jsonLikeEqual(left.authorization, right.authorization)
  )
}

function reuseStableMessageParts(current: ChatMessagePart[], next: ChatMessagePart[]): ChatMessagePart[] {
  let changed = current.length !== next.length
  const parts = next.map((part, index) => {
    const currentPart = current[index]
    if (currentPart && sameMessagePart(currentPart, part)) {
      return currentPart
    }
    changed = true
    return part
  })
  return changed ? parts : current
}

function sameMessageValue(left: ChatMessage, right: ChatMessage): boolean {
  return (
    left.id === right.id &&
    left.clientId === right.clientId &&
    left.role === right.role &&
    left.createdAt === right.createdAt &&
    left.completedAt === right.completedAt &&
    left.finishReason === right.finishReason &&
    left.parts === right.parts &&
    jsonLikeEqual(left.contextMentions, right.contextMentions) &&
    jsonLikeEqual(left.tokenUsage, right.tokenUsage)
  )
}

function reuseStableFetchedMessage(current: ChatMessage | undefined, next: ChatMessage): ChatMessage {
  if (!current) {
    return next
  }
  const parts = reuseStableMessageParts(current.parts, next.parts)
  const stableNext = parts === next.parts ? next : { ...next, parts }
  return sameMessageValue(current, stableNext) ? current : stableNext
}

function reuseStableMessageList(current: ChatMessage[], next: ChatMessage[]): ChatMessage[] {
  if (current.length !== next.length) {
    return next
  }
  return current.every((message, index) => message === next[index]) ? current : next
}

function withStableClientId(message: ChatMessage): ChatMessage {
  return message.clientId ? message : { ...message, clientId: serverClientId(message.id) }
}

function replaceLocalMessage(msgs: ChatMessage[], id: string, role: ChatRole): ChatMessage[] | null {
  const prefix = role === "user" ? "local-user-" : "local-assistant-"
  const localIndex = msgs.findLastIndex((m) => m.role === role && m.id.startsWith(prefix))
  if (localIndex === -1) {
    return null
  }
  const local = msgs[localIndex]
  if (!local) {
    return null
  }
  const next = msgs.filter((m, index) => index === localIndex || !m.id.startsWith(prefix))
  const targetIndex = next.findIndex((m) => m.id === local.id)
  if (targetIndex !== -1) {
    next[targetIndex] = { ...local, id, role, clientId: local.clientId ?? createClientId(role) }
  }
  return next
}

export function ensureMessage(msgs: ChatMessage[], id: string, role: ChatRole): ChatMessage[] {
  if (msgs.some((m) => m.id === id)) {
    return msgs.map((message) => (message.id === id ? withStableClientId(message) : message))
  }
  const replaced = replaceLocalMessage(msgs, id, role)
  if (replaced) {
    return replaced
  }
  // 没有可复用的本地气泡时，清掉残留乐观占位。
  const base = role === "user" ? msgs.filter((m) => !m.id.startsWith("local-user-")) : msgs
  return [...base, { id, clientId: serverClientId(id), role, parts: [], createdAt: Date.now() }]
}

export function setMessageInfo(msgs: ChatMessage[], event: MessageStartedEvent): ChatMessage[] {
  const ensured = ensureMessage(msgs, event.messageId, event.role)
  return ensured.map((message) => {
    if (message.id !== event.messageId) {
      return message
    }
    const finishReason = event.finishReason ?? message.finishReason
    const completedAt = event.completedAt ?? message.completedAt
    if (finishReason === message.finishReason && completedAt === message.completedAt) {
      return message
    }
    return {
      ...message,
      ...(finishReason ? { finishReason } : {}),
      ...(completedAt === undefined ? {} : { completedAt }),
    }
  })
}

export function setMessageFinishReason(msgs: ChatMessage[], messageId: string, finishReason: string): ChatMessage[] {
  return msgs.map((message) =>
    message.id === messageId && message.finishReason !== finishReason ? { ...message, finishReason } : message,
  )
}

export function setPart(msgs: ChatMessage[], messageId: string, part: ChatMessagePart): ChatMessage[] {
  const ensured = ensureMessage(msgs, messageId, "assistant")
  return ensured.map((m) => (m.id === messageId ? { ...m, parts: upsertPart(m.parts, part) } : m))
}

export function removePart(msgs: ChatMessage[], event: MessagePartRemovedEvent): ChatMessage[] {
  return msgs.map((message) =>
    message.id === event.messageId
      ? { ...message, parts: message.parts.filter((part) => part.partId !== event.partId) }
      : message,
  )
}

function latestAssistantMessageId(msgs: ChatMessage[]): string | null {
  return msgs.findLast((message) => message.role === "assistant")?.id ?? null
}

function errorPartSignature(part: ChatMessagePart): string | null {
  if (part.kind !== "error" || !part.errorText) {
    return null
  }
  return part.errorText.trim()
}

export function setErrorPart(msgs: ChatMessage[], event: MessageErrorEvent): ChatMessage[] {
  const messageId = event.messageId ?? latestAssistantMessageId(msgs) ?? `local-assistant-error-${Date.now()}`
  const nextPart: ChatMessagePart = {
    kind: "error",
    partId: event.partId,
    errorText: event.message,
    ...(event.errorKind ? { errorKind: event.errorKind } : {}),
    ...(event.errorCode ? { errorCode: event.errorCode } : {}),
  }
  const ensured = ensureMessage(msgs, messageId, "assistant")
  const nextSignature = errorPartSignature(nextPart)
  return ensured.map((message) => {
    if (message.id !== messageId) {
      return message
    }
    const existingDuplicate = nextSignature
      ? message.parts.find((part) => errorPartSignature(part) === nextSignature)
      : undefined
    return {
      ...message,
      parts: upsertPart(
        message.parts,
        existingDuplicate ? { ...nextPart, partId: existingDuplicate.partId } : nextPart,
      ),
    }
  })
}

export function setConnectionStatusPart(msgs: ChatMessage[], event: AgentConnectionChangedEvent): ChatMessage[] {
  const statusType = (() => {
    switch (event.status) {
      case "reconnecting":
        return "reconnecting"
      case "reconnected":
        return "reconnected"
      case "runtime_restarting":
        return "runtimeRestarting"
      case "runtime_recovered":
        return "runtimeRecovered"
      case "runtime_failed":
        return "runtimeFailed"
      case "failed":
        return "connectionFailed"
    }
  })()
  const messageId = event.messageId ?? `local-assistant-status-${event.createdAt}`
  const part: ChatMessagePart = {
    kind: "status",
    partId: `connection-${event.status}-${event.attempt ?? 0}-${event.createdAt}`,
    statusType,
    ...(event.attempt ? { attempt: event.attempt } : {}),
    ...(event.maxAttempts ? { maxAttempts: event.maxAttempts } : {}),
    ...(event.message ? { text: event.message } : {}),
  }
  const ensured = ensureMessage(msgs, messageId, "assistant")
  return ensured.map((message) =>
    message.id === messageId ? { ...message, parts: upsertPart(message.parts, part) } : message,
  )
}

export function setGenerationNoticePart(msgs: ChatMessage[], event: GenerationNoticeEvent): ChatMessage[] {
  const statusType = event.kind === "tool_running_without_output" ? "toolRunningWithoutOutput" : "generationStale"
  const messageId = event.messageId ?? latestAssistantMessageId(msgs) ?? `local-assistant-status-${event.createdAt}`
  const part: ChatMessagePart = {
    kind: "status",
    partId: `generation-notice-${event.kind}`,
    statusType,
  }
  const ensured = ensureMessage(msgs, messageId, "assistant")
  return ensured.map((message) =>
    message.id === messageId ? { ...message, parts: upsertPart(message.parts, part) } : message,
  )
}

function shouldCancelToolPart(part: ChatMessagePart): boolean {
  return part.kind === "tool" && (part.status === "pending" || part.status === "running" || part.status === "error")
}

function shouldInterruptToolPart(part: ChatMessagePart): boolean {
  return part.kind === "tool" && (part.status === "pending" || part.status === "running")
}

function cancelledToolPart(part: ChatMessagePart, stoppedAt: number): ChatMessagePart {
  const shouldFreezeTiming =
    (part.status === "pending" || part.status === "running") && typeof part.timing?.end !== "number"
  return {
    ...part,
    cancelled: true,
    ...(shouldFreezeTiming ? { timing: { ...part.timing, end: stoppedAt } } : {}),
  }
}

function interruptedToolPart(part: ChatMessagePart, event: GenerationInterruptedEvent): ChatMessagePart {
  const shouldFreezeTiming = typeof part.timing?.end !== "number"
  return {
    ...part,
    status: "error",
    error: part.error ?? event.message,
    cancelled: false,
    ...(shouldFreezeTiming ? { timing: { ...part.timing, end: event.interruptedAt } } : {}),
  }
}

function isQuestionToolPartForRequest(part: ChatMessagePart, request: ChatQuestionRequest): boolean {
  // question 工具事件可能和同一条 assistant 消息里的其他工具交错，只按 callId 精确命中目标问题。
  return Boolean(
    request.tool && part.kind === "tool" && part.tool === "question" && part.callId === request.tool.callId,
  )
}

function withFinishedTiming(part: ChatMessagePart, endedAt: number): ChatMessagePart {
  // 结束时间一旦来自 OpenCode 就保持不变；只给本地补齐的回答/取消状态冻结 end。
  return typeof part.timing?.end === "number" ? part : { ...part, timing: { ...part.timing, end: endedAt } }
}

export function markQuestionToolAnswered(
  msgs: ChatMessage[],
  request: ChatQuestionRequest,
  answers: string[][] | undefined,
  answeredAt = Date.now(),
): ChatMessage[] {
  if (!request.tool) {
    return msgs
  }
  // answered 事件只带 request/tool 信息，通过 messageId + callId 更新对应 question 工具。
  let changed = false
  const messages = msgs.map((message) => {
    if (message.id !== request.tool?.messageId || message.role !== "assistant") {
      return message
    }
    let partsChanged = false
    const parts = message.parts.map((part) => {
      if (!isQuestionToolPartForRequest(part, request)) {
        return part
      }
      changed = true
      partsChanged = true
      return withFinishedTiming(
        {
          ...part,
          status: "completed",
          cancelled: false,
          ...(answers ? { metadata: { ...part.metadata, answers } } : {}),
        },
        answeredAt,
      )
    })
    return partsChanged ? { ...message, parts } : message
  })
  return changed ? messages : msgs
}

export function markQuestionToolsCancelled(
  msgs: ChatMessage[],
  requests: readonly ChatQuestionRequest[],
  stoppedAt = Date.now(),
): { messages: ChatMessage[]; partIds: string[] } {
  // stopped/rejected question 只取消关联的 question 工具，避免误伤同一回复里的其他运行工具。
  const byMessageId = new Map<string, ChatQuestionRequest[]>()
  for (const request of requests) {
    if (!request.tool) {
      continue
    }
    byMessageId.set(request.tool.messageId, [...(byMessageId.get(request.tool.messageId) ?? []), request])
  }
  if (byMessageId.size === 0) {
    return { messages: msgs, partIds: [] }
  }
  let changed = false
  const cancelledPartIds: string[] = []
  const messages = msgs.map((message) => {
    const messageRequests = byMessageId.get(message.id)
    if (!messageRequests || message.role !== "assistant") {
      return message
    }
    let partsChanged = false
    const parts = message.parts.map((part) => {
      if (
        !messageRequests.some((request) => isQuestionToolPartForRequest(part, request)) ||
        !shouldCancelToolPart(part)
      ) {
        return part
      }
      changed = true
      partsChanged = true
      cancelledPartIds.push(part.partId)
      return cancelledToolPart(part, stoppedAt)
    })
    return partsChanged ? { ...message, parts } : message
  })
  return { messages: changed ? messages : msgs, partIds: cancelledPartIds }
}

export function markLatestAssistantToolsCancelled(
  msgs: ChatMessage[],
  stoppedAt = Date.now(),
): { messages: ChatMessage[]; partIds: string[] } {
  const messageIndex = msgs.findLastIndex((message) => message.role === "assistant")
  if (messageIndex === -1) {
    return { messages: msgs, partIds: [] }
  }
  const message = msgs[messageIndex]
  if (!message) {
    return { messages: msgs, partIds: [] }
  }
  const partIds: string[] = []
  const parts = message.parts.map((part) => {
    if (!shouldCancelToolPart(part)) {
      return part
    }
    partIds.push(part.partId)
    return cancelledToolPart(part, stoppedAt)
  })
  if (partIds.length === 0) {
    return { messages: msgs, partIds }
  }
  const messages = msgs.slice()
  messages[messageIndex] = { ...message, parts }
  return { messages, partIds }
}

export function markAssistantMessageToolsCancelled(
  msgs: ChatMessage[],
  messageId: string | undefined,
  targetPartIds: readonly string[] | undefined,
  stoppedAt = Date.now(),
): { messages: ChatMessage[]; partIds: string[] } {
  if (!messageId) {
    return markLatestAssistantToolsCancelled(msgs, stoppedAt)
  }
  if (targetPartIds?.length === 0) {
    return { messages: msgs, partIds: [] }
  }
  // 有 messageId 时优先使用服务端回传的 partIds；undefined 才表示回退到整条 assistant 消息。
  const targetPartIdSet = targetPartIds ? new Set(targetPartIds) : null
  let changed = false
  const cancelledPartIds: string[] = []
  const messages = msgs.map((message) => {
    if (message.id !== messageId || message.role !== "assistant") {
      return message
    }
    let partsChanged = false
    const parts = message.parts.map((part) => {
      if (!shouldCancelToolPart(part) || (targetPartIdSet && !targetPartIdSet.has(part.partId))) {
        return part
      }
      changed = true
      partsChanged = true
      cancelledPartIds.push(part.partId)
      return cancelledToolPart(part, stoppedAt)
    })
    return partsChanged ? { ...message, parts } : message
  })
  return { messages: changed ? messages : msgs, partIds: cancelledPartIds }
}

export function markAssistantMessageToolsInterrupted(
  msgs: ChatMessage[],
  event: GenerationInterruptedEvent,
): ChatMessage[] {
  if (!event.messageId) {
    return msgs
  }
  const targetPartIdSet = event.partIds ? new Set(event.partIds) : null
  let changed = false
  const messages = msgs.map((message) => {
    if (message.id !== event.messageId || message.role !== "assistant") {
      return message
    }
    let partsChanged = false
    const parts = message.parts.map((part) => {
      if (!shouldInterruptToolPart(part) || (targetPartIdSet && !targetPartIdSet.has(part.partId))) {
        return part
      }
      changed = true
      partsChanged = true
      return interruptedToolPart(part, event)
    })
    return partsChanged ? { ...message, parts } : message
  })
  return changed ? messages : msgs
}

export function applyCancelledToolParts(
  msgs: ChatMessage[],
  partIds: Set<string> | undefined,
  stoppedAt = Date.now(),
): ChatMessage[] {
  if (!partIds || partIds.size === 0) {
    return msgs
  }
  let changed = false
  const messages = msgs.map((message) => {
    let partsChanged = false
    const parts = message.parts.map((part) => {
      if (part.kind !== "tool" || !partIds.has(part.partId) || part.cancelled === true) {
        return part
      }
      changed = true
      partsChanged = true
      return cancelledToolPart(part, stoppedAt)
    })
    return partsChanged ? { ...message, parts } : message
  })
  return changed ? messages : msgs
}

export function setTextPart(msgs: ChatMessage[], event: MessageDeltaEvent): ChatMessage[] {
  const ensured = ensureMessage(msgs, event.messageId, "assistant")
  const messageIndex = ensured.findIndex((message) => message.id === event.messageId)
  const message = ensured[messageIndex]
  if (!message) {
    return ensured
  }
  const parts =
    message.role === "user"
      ? message.parts.filter((part) => !(part.kind === "text" && part.partId === "local"))
      : message.parts
  const existing = parts.find((part) => part.partId === event.partId)
  const currentText = existing?.kind === "text" ? (existing.text ?? "") : ""
  const text = event.text || (event.delta ? currentText + event.delta : currentText)
  const next = ensured.slice()
  next[messageIndex] = { ...message, parts: upsertPart(parts, { kind: "text", partId: event.partId, text }) }
  return next
}

export function setReasoningPart(msgs: ChatMessage[], event: MessageReasoningDeltaEvent): ChatMessage[] {
  const ensured = ensureMessage(msgs, event.messageId, "assistant")
  const messageIndex = ensured.findIndex((message) => message.id === event.messageId)
  const message = ensured[messageIndex]
  if (!message) {
    return ensured
  }
  const existing = message.parts.find((part) => part.partId === event.partId)
  const currentText = existing?.kind === "reasoning" ? (existing.text ?? "") : ""
  const text = event.text || (event.delta ? currentText + event.delta : currentText)
  const next = ensured.slice()
  next[messageIndex] = {
    ...message,
    parts: upsertPart(message.parts, { kind: "reasoning", partId: event.partId, text }),
  }
  return next
}

export function hasVisibleMessageDelta(event: MessageDeltaEvent): boolean {
  return Boolean(event.text.trim() || event.delta?.trim())
}

export function setAttachmentPart(msgs: ChatMessage[], event: MessageAttachmentEvent): ChatMessage[] {
  const ensured = ensureMessage(msgs, event.messageId, "user")
  return ensured.map((message) =>
    message.id === event.messageId
      ? {
          ...message,
          parts: upsertPart(
            message.parts.filter(
              (part) =>
                !(
                  part.kind === "attachment" &&
                  part.partId.startsWith("local-attachment-") &&
                  part.attachment?.path === event.attachment.path
                ),
            ),
            {
              kind: "attachment",
              partId: event.partId,
              attachment: event.attachment,
            },
          ),
        }
      : message,
  )
}

function messageText(message: Pick<ChatMessage, "parts">): string {
  return message.parts
    .filter((part) => part.kind === "text")
    .map((part) => part.text ?? "")
    .join("")
}

function messageAttachments(message: Pick<ChatMessage, "parts">): ChatAttachment[] {
  return message.parts
    .filter((part) => part.kind === "attachment" && part.attachment)
    .map((part) => part.attachment as ChatAttachment)
}

function attachmentsKey(attachments: ChatAttachment[] | undefined): string {
  return (attachments ?? [])
    .map((attachment) => attachment.path)
    .sort()
    .join("\n")
}

function userMessageContentKey(message: Pick<ChatMessage, "parts">): string {
  return `${messageText(message)}\n---\n${attachmentsKey(messageAttachments(message))}`
}

function hasLocalUserMessage(msgs: ChatMessage[], text: string, attachments?: ChatAttachment[]): boolean {
  const expectedAttachments = attachmentsKey(attachments)
  return msgs.some(
    (message) =>
      message.role === "user" &&
      message.id.startsWith("local-user-") &&
      messageText(message) === text &&
      attachmentsKey(messageAttachments(message)) === expectedAttachments,
  )
}

function userMessageCountsByContent(messages: ChatMessage[]): Map<string, number> {
  const counts = new Map<string, number>()
  for (const message of messages) {
    if (message.role !== "user") {
      continue
    }
    const key = userMessageContentKey(message)
    counts.set(key, (counts.get(key) ?? 0) + 1)
  }
  return counts
}

function missingLocalUserMessages(current: ChatMessage[], fetched: ChatMessage[]): ChatMessage[] {
  const fetchedCounts = userMessageCountsByContent(fetched)
  const currentCounts = new Map<string, number>()
  return current.filter((message) => {
    if (message.role !== "user") {
      return false
    }
    const key = userMessageContentKey(message)
    const seen = (currentCounts.get(key) ?? 0) + 1
    currentCounts.set(key, seen)
    return message.id.startsWith("local-user-") && seen > (fetchedCounts.get(key) ?? 0)
  })
}

function localUsersByContent(current: ChatMessage[]): Map<string, ChatMessage[]> {
  const localUsers = new Map<string, ChatMessage[]>()
  for (const message of current) {
    if (message.role !== "user" || !message.id.startsWith("local-user-")) {
      continue
    }
    const key = userMessageContentKey(message)
    localUsers.set(key, [...(localUsers.get(key) ?? []), message])
  }
  return localUsers
}

export function appendOptimisticConversationTurn(
  msgs: ChatMessage[],
  text: string,
  attachments?: ChatAttachment[],
  contextMentions?: ChatContextMention[],
): ChatMessage[] {
  if (hasLocalUserMessage(msgs, text, attachments)) {
    return msgs
  }
  const now = Date.now()
  const attachmentParts: ChatMessagePart[] = (attachments ?? []).map((attachment) => ({
    kind: "attachment",
    partId: `local-attachment-${attachment.id}`,
    attachment,
  }))
  return [
    ...msgs,
    {
      id: `local-user-${now}-${localMessageSequence + 1}`,
      clientId: createClientId("user"),
      role: "user",
      parts: [...attachmentParts, ...(text ? [{ kind: "text" as const, partId: "local", text }] : [])],
      ...(contextMentions && contextMentions.length > 0 ? { contextMentions } : {}),
      createdAt: now,
    },
    {
      id: `local-assistant-${now}-${localMessageSequence + 1}`,
      clientId: createClientId("assistant"),
      role: "assistant",
      parts: [],
      createdAt: now,
    },
  ]
}

export function agentAttachments(attachments: ChatAttachment[]): ChatAttachment[] {
  return attachments.map((attachment) => ({
    ...(attachment.agentPath
      ? {
          agentMime: attachment.agentMime,
          agentName: attachment.agentName,
          agentPath: attachment.agentPath,
          agentSize: attachment.agentSize,
        }
      : {}),
    id: attachment.id,
    name: attachment.name,
    mime: attachment.mime,
    size: attachment.size,
    path: attachment.path,
    kind: attachment.kind,
  }))
}

export function mergeFetchedMessages(current: ChatMessage[], fetched: ChatMessage[]): ChatMessage[] {
  const currentErrorPartsById = new Map(
    current.map((message) => [
      message.id,
      message.parts.filter((part) => part.kind === "error" && Boolean(part.errorText)),
    ]),
  )
  const missingLocalAssistants = current.filter(
    (message) =>
      message.role === "assistant" &&
      message.id.startsWith("local-assistant-") &&
      message.parts.some((part) => part.kind === "error" && Boolean(part.errorText)),
  )
  const missingLocalUsers = missingLocalUserMessages(current, fetched)
  const localUserByContent = localUsersByContent(current)
  const currentById = new Map(current.map((message) => [message.id, message]))
  const fetchedWithLocalState = fetched.map((message) => {
    const matchedLocalUser =
      message.role === "user" ? localUserByContent.get(userMessageContentKey(message))?.shift() : undefined
    const currentMessage = currentById.get(message.id) ?? matchedLocalUser
    return reuseStableFetchedMessage(currentMessage, {
      ...message,
      clientId: currentMessage?.clientId ?? message.clientId ?? serverClientId(message.id),
      ...(message.role === "user" && currentMessage?.contextMentions && !message.contextMentions
        ? { contextMentions: currentMessage.contextMentions }
        : {}),
      parts: preserveLocalErrorParts(message.parts, currentErrorPartsById.get(message.id)),
    })
  })
  const merged = insertMessagesByCreatedAt(fetchedWithLocalState, missingLocalUsers)
  const next = missingLocalAssistants.length > 0 ? [...merged, ...missingLocalAssistants] : merged
  return reuseStableMessageList(current, next)
}

function messageCreatedAt(message: ChatMessage): number {
  return Number.isFinite(message.createdAt) ? message.createdAt : 0
}

function insertMessagesByCreatedAt(base: ChatMessage[], additions: ChatMessage[]): ChatMessage[] {
  if (additions.length === 0) {
    return base
  }
  const sortedAdditions = additions
    .map((message, index) => ({ index, message }))
    .sort((left, right) => messageCreatedAt(left.message) - messageCreatedAt(right.message) || left.index - right.index)
    .map((item) => item.message)
  const merged = base.slice()
  for (const message of sortedAdditions) {
    const createdAt = messageCreatedAt(message)
    const insertAt = merged.findIndex((item) => messageCreatedAt(item) > createdAt)
    if (insertAt === -1) {
      merged.push(message)
    } else {
      merged.splice(insertAt, 0, message)
    }
  }
  return merged
}

function preserveLocalErrorParts(
  parts: ChatMessagePart[],
  localErrorParts: ChatMessagePart[] | undefined,
): ChatMessagePart[] {
  if (!localErrorParts || localErrorParts.length === 0) {
    return parts
  }
  const partIds = new Set(parts.map((part) => part.partId))
  const errorSignatures = new Set(
    parts.map((part) => errorPartSignature(part)).filter((signature): signature is string => Boolean(signature)),
  )
  const missing = localErrorParts.filter((part) => {
    if (partIds.has(part.partId)) {
      return false
    }
    const signature = errorPartSignature(part)
    return !signature || !errorSignatures.has(signature)
  })
  return missing.length === 0 ? parts : [...parts, ...missing]
}

export function visibleChatError(
  errorsBySession: Record<string, string | undefined>,
  globalError: string | null,
  activeSessionId: string | null,
): string | null {
  return activeSessionId ? (errorsBySession[activeSessionId] ?? globalError) : globalError
}
