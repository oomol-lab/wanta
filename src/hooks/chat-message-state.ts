import type {
  ChatAttachment,
  ChatContextMention,
  ChatMessage,
  ChatMessagePart,
  ChatRole,
  MessageAttachmentEvent,
  MessageArtifactsEvent,
  MessageDeltaEvent,
  MessageErrorEvent,
  MessagePartRemovedEvent,
  MessageReasoningDeltaEvent,
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

function shouldCancelToolPart(part: ChatMessagePart): boolean {
  return part.kind === "tool" && (part.status === "pending" || part.status === "running" || part.status === "error")
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
  return ensured.map((message) => {
    if (message.id !== event.messageId) {
      return message
    }
    const parts =
      message.role === "user"
        ? message.parts.filter((part) => !(part.kind === "text" && part.partId === "local"))
        : message.parts
    const existing = parts.find((part) => part.partId === event.partId)
    const currentText = existing?.kind === "text" ? (existing.text ?? "") : ""
    const text = event.text || (event.delta ? currentText + event.delta : currentText)
    return { ...message, parts: upsertPart(parts, { kind: "text", partId: event.partId, text }) }
  })
}

export function setReasoningPart(msgs: ChatMessage[], event: MessageReasoningDeltaEvent): ChatMessage[] {
  const ensured = ensureMessage(msgs, event.messageId, "assistant")
  return ensured.map((message) => {
    if (message.id !== event.messageId) {
      return message
    }
    const existing = message.parts.find((part) => part.partId === event.partId)
    const currentText = existing?.kind === "reasoning" ? (existing.text ?? "") : ""
    const text = event.text || (event.delta ? currentText + event.delta : currentText)
    return { ...message, parts: upsertPart(message.parts, { kind: "reasoning", partId: event.partId, text }) }
  })
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

export function setMessageArtifactRoot(msgs: ChatMessage[], event: MessageArtifactsEvent): ChatMessage[] {
  const ensured = ensureMessage(msgs, event.messageId, "assistant")
  return ensured.map((message) =>
    message.id === event.messageId ? { ...message, artifactRoot: event.artifactRoot } : message,
  )
}

function messageText(message: ChatMessage): string {
  return message.parts
    .filter((part) => part.kind === "text")
    .map((part) => part.text ?? "")
    .join("")
}

function messageAttachments(message: ChatMessage): ChatAttachment[] {
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

function hasUserMessage(msgs: ChatMessage[], text: string, attachments?: ChatAttachment[]): boolean {
  const expectedAttachments = attachmentsKey(attachments)
  return msgs.some(
    (message) =>
      message.role === "user" &&
      messageText(message) === text &&
      attachmentsKey(messageAttachments(message)) === expectedAttachments,
  )
}

export function appendOptimisticConversationTurn(
  msgs: ChatMessage[],
  text: string,
  attachments?: ChatAttachment[],
  contextMentions?: ChatContextMention[],
): ChatMessage[] {
  if (hasUserMessage(msgs, text, attachments)) {
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
  const missingLocalUsers = current.filter(
    (message) =>
      message.role === "user" &&
      message.id.startsWith("local-user-") &&
      !hasUserMessage(fetched, messageText(message), messageAttachments(message)),
  )
  const localUserByContent = new Map(
    current
      .filter((message) => message.role === "user" && message.id.startsWith("local-user-"))
      .map((message) => [`${messageText(message)}\n---\n${attachmentsKey(messageAttachments(message))}`, message]),
  )
  const currentById = new Map(current.map((message) => [message.id, message]))
  const artifactRootByMessageId = new Map(
    current.flatMap((message) => (message.artifactRoot ? [[message.id, message.artifactRoot] as const] : [])),
  )
  const fetchedWithLocalState = fetched.map((message) => {
    const matchedLocalUser =
      message.role === "user"
        ? localUserByContent.get(`${messageText(message)}\n---\n${attachmentsKey(messageAttachments(message))}`)
        : undefined
    const currentMessage = currentById.get(message.id) ?? matchedLocalUser
    const artifactRoot = artifactRootByMessageId.get(message.id)
    return {
      ...message,
      clientId: currentMessage?.clientId ?? message.clientId ?? serverClientId(message.id),
      ...(message.role === "user" && currentMessage?.contextMentions && !message.contextMentions
        ? { contextMentions: currentMessage.contextMentions }
        : {}),
      parts: preserveLocalErrorParts(message.parts, currentErrorPartsById.get(message.id)),
      ...(artifactRoot && !message.artifactRoot ? { artifactRoot } : {}),
    }
  })
  const merged = missingLocalUsers.length > 0 ? [...missingLocalUsers, ...fetchedWithLocalState] : fetchedWithLocalState
  return missingLocalAssistants.length > 0 ? [...merged, ...missingLocalAssistants] : merged
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

export function markSessionCompletedUnread(
  unreadSessionIds: Set<string>,
  completedSessionId: string,
  visibleSessionId: string | null,
): Set<string> {
  if (completedSessionId === visibleSessionId || unreadSessionIds.has(completedSessionId)) {
    return unreadSessionIds
  }
  return new Set(unreadSessionIds).add(completedSessionId)
}

export function markSessionViewed(unreadSessionIds: Set<string>, visibleSessionId: string | null): Set<string> {
  if (!visibleSessionId || !unreadSessionIds.has(visibleSessionId)) {
    return unreadSessionIds
  }
  const next = new Set(unreadSessionIds)
  next.delete(visibleSessionId)
  return next
}

export function visibleChatError(
  errorsBySession: Record<string, string | undefined>,
  globalError: string | null,
  activeSessionId: string | null,
): string | null {
  return activeSessionId ? (errorsBySession[activeSessionId] ?? globalError) : globalError
}
