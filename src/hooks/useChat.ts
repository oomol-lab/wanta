import type {
  ChatAttachment,
  ChatMessage,
  ChatMessagePart,
  ChatRole,
  MessageDeltaEvent,
} from "../../electron/chat/common"
import type { ModelChoice } from "../../electron/models/common"
import type { ChatStatus } from "ai"

import * as React from "react"
import { useChatService } from "@/components/AppContext"

type MessagesMap = Record<string, ChatMessage[]>
type SendOptimisticMode = "before-ack" | "after-ack"

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

  const patch = React.useCallback((sessionId: string, updater: (msgs: ChatMessage[]) => ChatMessage[]) => {
    setMessagesMap((prev) => ({ ...prev, [sessionId]: updater(prev[sessionId] ?? []) }))
  }, [])

  const reload = React.useCallback(
    async (sessionId: string) => {
      try {
        const msgs = await chatService.invoke("getMessages", sessionId)
        setMessagesMap((prev) => ({ ...prev, [sessionId]: mergeFetchedMessages(prev[sessionId] ?? [], msgs) }))
      } catch (err) {
        console.error("[lumo] getMessages failed", err)
      }
    },
    [chatService],
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
        setStatuses((s) => ({ ...s, [e.sessionId]: "streaming" }))
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
          }),
        )
      }),
      chatService.serverEvents.on("messageCompleted", (e) => {
        setStatuses((s) => ({ ...s, [e.sessionId]: "ready" }))
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
  }, [chatService, patch, reload])

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
      await chatService.invoke("stopGeneration", sessionId)
      setStatuses((s) => ({ ...s, [sessionId]: "ready" }))
    },
    [chatService],
  )

  const messages = activeSessionId ? (messagesMap[activeSessionId] ?? []) : []
  const status = activeSessionId ? (statuses[activeSessionId] ?? "ready") : "ready"
  const messagesLoaded = activeSessionId ? Object.hasOwn(messagesMap, activeSessionId) : true
  return { messages, status, messagesLoaded, error, send, stop }
}
