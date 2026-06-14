import type {
  ChatAttachment,
  ChatMessage,
  ChatMessagePart,
  ChatRole,
  MessageDeltaEvent,
} from "../../electron/chat/common.ts"
import type { ModelChoice } from "../../electron/models/common.ts"
import type { ChatStatus } from "ai"

import * as React from "react"
import { useChatService } from "@/components/AppContext"

type MessagesMap = Record<string, ChatMessage[]>
type SendOptimisticMode = "before-ack" | "after-ack"
type CancelledToolPartsMap = Map<string, Set<string>>

const userStoppedToolCancelWindowMs = 30_000

interface SendOptions {
  optimistic?: SendOptimisticMode
}

function upsertPart(parts: ChatMessagePart[], part: ChatMessagePart): ChatMessagePart[] {
  const index = parts.findIndex((p) => p.partId === part.partId)
  if (index === -1) {
    return [...parts, part]
  }
  const next = parts.slice()
  next[index] = { ...next[index], ...part }
  return next
}

function ensureMessage(msgs: ChatMessage[], id: string, role: ChatRole): ChatMessage[] {
  if (msgs.some((m) => m.id === id)) {
    return msgs
  }
  // 真实 user 消息到达时，清掉乐观占位的 local-user-* 气泡。
  const base = role === "user" ? msgs.filter((m) => !m.id.startsWith("local-user-")) : msgs
  return [...base, { id, role, parts: [], createdAt: Date.now() }]
}

function setPart(msgs: ChatMessage[], messageId: string, part: ChatMessagePart): ChatMessage[] {
  const ensured = ensureMessage(msgs, messageId, "assistant")
  return ensured.map((m) => (m.id === messageId ? { ...m, parts: upsertPart(m.parts, part) } : m))
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
    const existing = message.parts.find((part) => part.partId === event.partId)
    const currentText = existing?.kind === "text" ? (existing.text ?? "") : ""
    const text = event.text || (event.delta ? currentText + event.delta : currentText)
    return { ...message, parts: upsertPart(message.parts, { kind: "text", partId: event.partId, text }) }
  })
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

function appendOptimisticUserMessage(msgs: ChatMessage[], text: string, attachments?: ChatAttachment[]): ChatMessage[] {
  if (hasUserMessage(msgs, text, attachments)) {
    return msgs
  }
  const attachmentParts: ChatMessagePart[] = (attachments ?? []).map((attachment) => ({
    kind: "attachment",
    partId: `local-attachment-${attachment.id}`,
    attachment,
  }))
  return [
    ...msgs,
    {
      id: `local-user-${Date.now()}`,
      role: "user",
      parts: [...attachmentParts, ...(text ? [{ kind: "text" as const, partId: "local", text }] : [])],
      createdAt: Date.now(),
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

function mergeFetchedMessages(current: ChatMessage[], fetched: ChatMessage[]): ChatMessage[] {
  const missingLocalUsers = current.filter(
    (message) =>
      message.role === "user" &&
      message.id.startsWith("local-user-") &&
      !hasUserMessage(fetched, messageText(message), messageAttachments(message)),
  )
  return missingLocalUsers.length > 0 ? [...missingLocalUsers, ...fetched] : fetched
}

export interface UseChat {
  messages: ChatMessage[]
  status: ChatStatus
  messagesLoaded: boolean
  error: string | null
  getSessionStatus: (sessionId: string) => ChatStatus
  send: (
    sessionId: string,
    text: string,
    attachments?: ChatAttachment[],
    options?: SendOptions & { model?: ModelChoice },
  ) => Promise<void>
  stop: (sessionId: string) => Promise<void>
}

export function useChat(activeSessionId: string | null): UseChat {
  const chatService = useChatService()
  const [messagesMap, setMessagesMap] = React.useState<MessagesMap>({})
  const [statuses, setStatuses] = React.useState<Record<string, ChatStatus>>({})
  const [error, setError] = React.useState<string | null>(null)
  const userStoppedSessions = React.useRef(new Map<string, number>())
  const cancelledToolParts = React.useRef<CancelledToolPartsMap>(new Map())

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
        }
      }),
      chatService.serverEvents.on("messageDelta", (e) => {
        setStatuses((s) => ({ ...s, [e.sessionId]: "streaming" }))
        patch(e.sessionId, (msgs) => setTextPart(msgs, e))
      }),
      chatService.serverEvents.on("toolCallStarted", (e) => {
        setStatuses((s) => ({ ...s, [e.sessionId]: "streaming" }))
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
      chatService.serverEvents.on("messageCompleted", (e) => {
        setStatuses((s) => ({ ...s, [e.sessionId]: "ready" }))
        void reload(e.sessionId)
      }),
      chatService.serverEvents.on("generationStopped", (e) => {
        setStatuses((s) => ({ ...s, [e.sessionId]: "ready" }))
        setError(null)
        markCurrentToolsCancelled(e.sessionId)
        void reload(e.sessionId)
      }),
      chatService.serverEvents.on("agentError", (e) => {
        if (e.sessionId) {
          setStatuses((s) => ({ ...s, [e.sessionId!]: "error" }))
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
      options: SendOptions & { model?: ModelChoice } = {},
    ) => {
      const optimistic = options.optimistic ?? "before-ack"
      setError(null)
      userStoppedSessions.current.delete(sessionId)
      cancelledToolParts.current.delete(sessionId)
      setStatuses((s) => ({ ...s, [sessionId]: "submitted" }))
      if (optimistic === "before-ack") {
        patch(sessionId, (msgs) => appendOptimisticUserMessage(msgs, text, attachments))
      }
      try {
        await chatService.invoke("sendMessage", {
          sessionId,
          text,
          attachments: agentAttachments(attachments),
          model: options.model,
        })
        if (optimistic === "after-ack") {
          patch(sessionId, (msgs) => appendOptimisticUserMessage(msgs, text, attachments))
        }
      } catch (err) {
        setStatuses((s) => ({ ...s, [sessionId]: "error" }))
        setError(String(err))
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
      } catch (err) {
        setStatuses((s) => ({ ...s, [sessionId]: "error" }))
        setError(String(err))
      }
    },
    [chatService, markCurrentToolsCancelled, markSessionUserStopped],
  )

  const messages = activeSessionId ? (messagesMap[activeSessionId] ?? []) : []
  const status = activeSessionId ? (statuses[activeSessionId] ?? "ready") : "ready"
  const messagesLoaded = activeSessionId ? Object.hasOwn(messagesMap, activeSessionId) : true
  const getSessionStatus = React.useCallback(
    (sessionId: string): ChatStatus => statuses[sessionId] ?? "ready",
    [statuses],
  )
  return { messages, status, messagesLoaded, error, getSessionStatus, send, stop }
}
