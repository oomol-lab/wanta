import type {
  AssistantActivityEvent,
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
import type { ModelChoice } from "../../electron/models/common.ts"
import type { ChatStatus } from "ai"

import * as React from "react"
import { useChatService } from "@/components/AppContext"

type MessagesMap = Record<string, ChatMessage[]>
type CancelledToolPartsMap = Map<string, Set<string>>

const userStoppedToolCancelWindowMs = 30_000
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

function setPart(msgs: ChatMessage[], messageId: string, part: ChatMessagePart): ChatMessage[] {
  const ensured = ensureMessage(msgs, messageId, "assistant")
  return ensured.map((m) => (m.id === messageId ? { ...m, parts: upsertPart(m.parts, part) } : m))
}

function removePart(msgs: ChatMessage[], event: MessagePartRemovedEvent): ChatMessage[] {
  return msgs.map((message) =>
    message.id === event.messageId
      ? { ...message, parts: message.parts.filter((part) => part.partId !== event.partId) }
      : message,
  )
}

function latestAssistantMessageId(msgs: ChatMessage[]): string | null {
  return msgs.findLast((message) => message.role === "assistant")?.id ?? null
}

export function setErrorPart(msgs: ChatMessage[], event: MessageErrorEvent): ChatMessage[] {
  const messageId = event.messageId ?? latestAssistantMessageId(msgs) ?? `local-assistant-error-${Date.now()}`
  return setPart(msgs, messageId, {
    kind: "error",
    partId: event.partId,
    errorText: event.message,
    ...(event.errorKind ? { errorKind: event.errorKind } : {}),
    ...(event.errorCode ? { errorCode: event.errorCode } : {}),
  })
}

function shouldCancelToolPart(part: ChatMessagePart): boolean {
  return part.kind === "tool" && (part.status === "pending" || part.status === "running" || part.status === "error")
}

function markLatestAssistantToolsCancelled(msgs: ChatMessage[]): { messages: ChatMessage[]; partIds: string[] } {
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
    return { ...part, cancelled: true }
  })
  if (partIds.length === 0) {
    return { messages: msgs, partIds }
  }
  const messages = msgs.slice()
  messages[messageIndex] = { ...message, parts }
  return { messages, partIds }
}

function applyCancelledToolParts(msgs: ChatMessage[], partIds: Set<string> | undefined): ChatMessage[] {
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
      return { ...part, cancelled: true }
    })
    return partsChanged ? { ...message, parts } : message
  })
  return changed ? messages : msgs
}

function setTextPart(msgs: ChatMessage[], event: MessageDeltaEvent): ChatMessage[] {
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

function setReasoningPart(msgs: ChatMessage[], event: MessageReasoningDeltaEvent): ChatMessage[] {
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

function setAttachmentPart(msgs: ChatMessage[], event: MessageAttachmentEvent): ChatMessage[] {
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

function setMessageArtifactRoot(msgs: ChatMessage[], event: MessageArtifactsEvent): ChatMessage[] {
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

function agentAttachments(attachments: ChatAttachment[]): ChatAttachment[] {
  return attachments.map((attachment) => ({
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
  const missing = localErrorParts.filter((part) => !partIds.has(part.partId))
  return missing.length === 0 ? parts : [...parts, ...missing]
}

export interface UseChat {
  messages: ChatMessage[]
  status: ChatStatus
  activity: AssistantActivityEvent | null
  messagesLoaded: boolean
  error: string | null
  getSessionStatus: (sessionId: string) => ChatStatus
  hasUnreadSession: (sessionId: string) => boolean
  send: (
    sessionId: string,
    text: string,
    attachments?: ChatAttachment[],
    options?: { contextMentions?: ChatContextMention[]; model?: ModelChoice },
  ) => Promise<void>
  stop: (sessionId: string) => Promise<void>
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

export function useChat(activeSessionId: string | null, visibleSessionId: string | null = activeSessionId): UseChat {
  const chatService = useChatService()
  const [messagesMap, setMessagesMap] = React.useState<MessagesMap>({})
  const [statuses, setStatuses] = React.useState<Record<string, ChatStatus>>({})
  const [activities, setActivities] = React.useState<Record<string, AssistantActivityEvent | undefined>>({})
  const [unreadSessionIds, setUnreadSessionIds] = React.useState<Set<string>>(() => new Set())
  const [error, setError] = React.useState<string | null>(null)
  const visibleSessionIdRef = React.useRef<string | null>(visibleSessionId)
  const userStoppedSessions = React.useRef(new Map<string, number>())
  const cancelledToolParts = React.useRef<CancelledToolPartsMap>(new Map())

  React.useEffect(() => {
    visibleSessionIdRef.current = visibleSessionId
    setUnreadSessionIds((current) => markSessionViewed(current, visibleSessionId))
  }, [visibleSessionId])

  const patch = React.useCallback((sessionId: string, updater: (msgs: ChatMessage[]) => ChatMessage[]) => {
    setMessagesMap((prev) => ({ ...prev, [sessionId]: updater(prev[sessionId] ?? []) }))
  }, [])

  const rememberCancelledToolParts = React.useCallback((sessionId: string, partIds: string[]) => {
    if (partIds.length === 0) {
      return
    }
    const current = cancelledToolParts.current.get(sessionId) ?? new Set<string>()
    for (const partId of partIds) {
      current.add(partId)
    }
    cancelledToolParts.current.set(sessionId, current)
  }, [])

  const markSessionUserStopped = React.useCallback((sessionId: string) => {
    const expiresAt = Date.now() + userStoppedToolCancelWindowMs
    userStoppedSessions.current.set(sessionId, expiresAt)
    const timer = window.setTimeout(() => {
      if (userStoppedSessions.current.get(sessionId) === expiresAt) {
        userStoppedSessions.current.delete(sessionId)
      }
    }, userStoppedToolCancelWindowMs)
    return timer
  }, [])

  const isSessionUserStopped = React.useCallback((sessionId: string): boolean => {
    const expiresAt = userStoppedSessions.current.get(sessionId)
    if (!expiresAt) {
      return false
    }
    if (Date.now() > expiresAt) {
      userStoppedSessions.current.delete(sessionId)
      return false
    }
    return true
  }, [])

  const markCurrentToolsCancelled = React.useCallback(
    (sessionId: string) => {
      patch(sessionId, (msgs) => {
        const { messages, partIds } = markLatestAssistantToolsCancelled(msgs)
        rememberCancelledToolParts(sessionId, partIds)
        return messages
      })
    },
    [patch, rememberCancelledToolParts],
  )

  const reload = React.useCallback(
    async (sessionId: string) => {
      try {
        const msgs = await chatService.invoke("getMessages", sessionId)
        setMessagesMap((prev) => ({
          ...prev,
          [sessionId]: (() => {
            const merged = applyCancelledToolParts(
              mergeFetchedMessages(prev[sessionId] ?? [], msgs),
              cancelledToolParts.current.get(sessionId),
            )
            if (!isSessionUserStopped(sessionId)) {
              return merged
            }
            const { messages, partIds } = markLatestAssistantToolsCancelled(merged)
            rememberCancelledToolParts(sessionId, partIds)
            return messages
          })(),
        }))
      } catch (err) {
        console.error("[lumo] getMessages failed", err)
      }
    },
    [chatService, isSessionUserStopped, rememberCancelledToolParts],
  )

  React.useEffect(() => {
    const offs = [
      chatService.serverEvents.on("messageStarted", (e) => {
        patch(e.sessionId, (msgs) => ensureMessage(msgs, e.messageId, e.role))
        if (e.role === "assistant") {
          setStatuses((s) => ({ ...s, [e.sessionId]: "streaming" }))
          setActivities((current) => ({
            ...current,
            [e.sessionId]: { sessionId: e.sessionId, messageId: e.messageId, phase: "thinking" },
          }))
        }
      }),
      chatService.serverEvents.on("messageDelta", (e) => {
        setStatuses((s) => ({ ...s, [e.sessionId]: "streaming" }))
        if (hasVisibleMessageDelta(e)) {
          setActivities((current) => ({ ...current, [e.sessionId]: undefined }))
        }
        patch(e.sessionId, (msgs) => setTextPart(msgs, e))
      }),
      chatService.serverEvents.on("messageReasoningDelta", (e) => {
        setStatuses((s) => ({ ...s, [e.sessionId]: "streaming" }))
        setActivities((current) => ({
          ...current,
          [e.sessionId]: { sessionId: e.sessionId, messageId: e.messageId, phase: "thinking" },
        }))
        patch(e.sessionId, (msgs) => setReasoningPart(msgs, e))
      }),
      chatService.serverEvents.on("messageAttachment", (e) => {
        patch(e.sessionId, (msgs) => setAttachmentPart(msgs, e))
      }),
      chatService.serverEvents.on("messageArtifacts", (e) => {
        patch(e.sessionId, (msgs) => setMessageArtifactRoot(msgs, e))
      }),
      chatService.serverEvents.on("toolCallStarted", (e) => {
        setStatuses((s) => ({ ...s, [e.sessionId]: "streaming" }))
        setActivities((current) => ({ ...current, [e.sessionId]: undefined }))
        patch(e.sessionId, (msgs) =>
          setPart(msgs, e.messageId, {
            kind: "tool",
            partId: e.partId,
            callId: e.callId,
            tool: e.tool,
            status: e.status,
            input: e.input,
            title: e.title,
            metadata: e.metadata,
            timing: e.timing,
          }),
        )
      }),
      chatService.serverEvents.on("toolCallResult", (e) => {
        const cancelled = e.status === "error" && isSessionUserStopped(e.sessionId)
        setStatuses((s) => ({ ...s, [e.sessionId]: cancelled ? "ready" : "streaming" }))
        if (!cancelled) {
          setActivities((current) => ({
            ...current,
            [e.sessionId]: { sessionId: e.sessionId, messageId: e.messageId, phase: "finalizing" },
          }))
        }
        if (cancelled) {
          rememberCancelledToolParts(e.sessionId, [e.partId])
        }
        patch(e.sessionId, (msgs) =>
          setPart(msgs, e.messageId, {
            kind: "tool",
            partId: e.partId,
            callId: e.callId,
            tool: e.tool,
            status: e.status,
            input: e.input,
            output: e.output,
            error: e.error,
            title: e.title,
            metadata: e.metadata,
            timing: e.timing,
            attachmentsCount: e.attachmentsCount,
            ...(cancelled ? { cancelled: true } : {}),
          }),
        )
      }),
      chatService.serverEvents.on("assistantActivity", (e) => {
        setStatuses((s) => ({ ...s, [e.sessionId]: "streaming" }))
        setActivities((current) => ({ ...current, [e.sessionId]: e }))
      }),
      chatService.serverEvents.on("messagePartRemoved", (e) => {
        patch(e.sessionId, (msgs) => removePart(msgs, e))
      }),
      chatService.serverEvents.on("messageCompleted", (e) => {
        setStatuses((s) => ({ ...s, [e.sessionId]: "ready" }))
        setActivities((current) => ({ ...current, [e.sessionId]: undefined }))
        setUnreadSessionIds((current) => markSessionCompletedUnread(current, e.sessionId, visibleSessionIdRef.current))
        void reload(e.sessionId)
      }),
      chatService.serverEvents.on("messageError", (e) => {
        setStatuses((s) => ({ ...s, [e.sessionId]: "error" }))
        setActivities((current) => ({ ...current, [e.sessionId]: undefined }))
        setError(null)
        patch(e.sessionId, (msgs) => setErrorPart(msgs, e))
      }),
      chatService.serverEvents.on("generationStopped", (e) => {
        setStatuses((s) => ({ ...s, [e.sessionId]: "ready" }))
        setActivities((current) => ({ ...current, [e.sessionId]: undefined }))
        setError(null)
        markCurrentToolsCancelled(e.sessionId)
        void reload(e.sessionId)
      }),
      chatService.serverEvents.on("agentError", (e) => {
        if (e.sessionId) {
          setStatuses((s) => ({ ...s, [e.sessionId!]: "error" }))
          setActivities((current) => ({ ...current, [e.sessionId!]: undefined }))
        }
        setError(e.message)
      }),
    ]
    return () => {
      for (const off of offs) {
        off()
      }
    }
  }, [chatService, isSessionUserStopped, markCurrentToolsCancelled, patch, reload, rememberCancelledToolParts])

  React.useEffect(() => {
    if (activeSessionId) {
      void reload(activeSessionId)
    }
  }, [activeSessionId, reload])

  const send = React.useCallback(
    async (
      sessionId: string,
      text: string,
      attachments: ChatAttachment[] = [],
      options: { contextMentions?: ChatContextMention[]; model?: ModelChoice } = {},
    ) => {
      setError(null)
      userStoppedSessions.current.delete(sessionId)
      cancelledToolParts.current.delete(sessionId)
      setStatuses((s) => ({ ...s, [sessionId]: "submitted" }))
      setActivities((current) => ({ ...current, [sessionId]: { sessionId, phase: "thinking" } }))
      patch(sessionId, (msgs) => appendOptimisticConversationTurn(msgs, text, attachments))
      try {
        await chatService.invoke("sendMessage", {
          sessionId,
          text,
          attachments: agentAttachments(attachments),
          contextMentions: options.contextMentions,
          model: options.model,
        })
      } catch (err) {
        setStatuses((s) => ({ ...s, [sessionId]: "error" }))
        setActivities((current) => ({ ...current, [sessionId]: undefined }))
        setError(null)
        patch(sessionId, (msgs) =>
          setErrorPart(msgs, {
            sessionId,
            partId: `local-error-${Date.now()}`,
            message: err instanceof Error ? err.message : String(err),
          }),
        )
      }
    },
    [chatService, patch],
  )

  const stop = React.useCallback(
    async (sessionId: string) => {
      setError(null)
      markSessionUserStopped(sessionId)
      markCurrentToolsCancelled(sessionId)
      try {
        await chatService.invoke("stopGeneration", sessionId)
        setStatuses((s) => ({ ...s, [sessionId]: "ready" }))
        setActivities((current) => ({ ...current, [sessionId]: undefined }))
      } catch (err) {
        setStatuses((s) => ({ ...s, [sessionId]: "error" }))
        setActivities((current) => ({ ...current, [sessionId]: undefined }))
        setError(String(err))
      }
    },
    [chatService, markCurrentToolsCancelled, markSessionUserStopped],
  )

  const messages = activeSessionId ? (messagesMap[activeSessionId] ?? []) : []
  const status = activeSessionId ? (statuses[activeSessionId] ?? "ready") : "ready"
  const activity = activeSessionId ? (activities[activeSessionId] ?? null) : null
  const messagesLoaded = activeSessionId ? Object.hasOwn(messagesMap, activeSessionId) : true
  const getSessionStatus = React.useCallback(
    (sessionId: string): ChatStatus => statuses[sessionId] ?? "ready",
    [statuses],
  )
  const hasUnreadSession = React.useCallback(
    (sessionId: string): boolean => unreadSessionIds.has(sessionId),
    [unreadSessionIds],
  )
  return { messages, status, activity, messagesLoaded, error, getSessionStatus, hasUnreadSession, send, stop }
}
