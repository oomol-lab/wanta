import type { ChatMessage, ChatMessagePart, ChatRole } from "../../electron/chat/common"

import * as React from "react"
import { useChatService } from "@/components/AppContext"

type MessagesMap = Record<string, ChatMessage[]>

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

export interface UseChat {
  messages: ChatMessage[]
  isGenerating: boolean
  error: string | null
  send: (sessionId: string, text: string) => Promise<void>
  stop: (sessionId: string) => Promise<void>
}

export function useChat(activeSessionId: string | null): UseChat {
  const chatService = useChatService()
  const [messagesMap, setMessagesMap] = React.useState<MessagesMap>({})
  const [generating, setGenerating] = React.useState<Record<string, boolean>>({})
  const [error, setError] = React.useState<string | null>(null)

  const patch = React.useCallback((sessionId: string, updater: (msgs: ChatMessage[]) => ChatMessage[]) => {
    setMessagesMap((prev) => ({ ...prev, [sessionId]: updater(prev[sessionId] ?? []) }))
  }, [])

  const reload = React.useCallback(
    async (sessionId: string) => {
      try {
        const msgs = await chatService.invoke("getMessages", sessionId)
        setMessagesMap((prev) => ({ ...prev, [sessionId]: msgs }))
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
      }),
      chatService.serverEvents.on("messageDelta", (e) => {
        patch(e.sessionId, (msgs) => setPart(msgs, e.messageId, { kind: "text", partId: e.partId, text: e.text }))
      }),
      chatService.serverEvents.on("toolCallStarted", (e) => {
        patch(e.sessionId, (msgs) =>
          setPart(msgs, e.messageId, {
            kind: "tool",
            partId: e.partId,
            callId: e.callId,
            tool: e.tool,
            status: e.status,
            input: e.input,
          }),
        )
      }),
      chatService.serverEvents.on("toolCallResult", (e) => {
        patch(e.sessionId, (msgs) =>
          setPart(msgs, e.messageId, {
            kind: "tool",
            partId: e.partId,
            callId: e.callId,
            tool: e.tool,
            status: e.status,
            output: e.output,
            error: e.error,
          }),
        )
      }),
      chatService.serverEvents.on("messageCompleted", (e) => {
        setGenerating((g) => ({ ...g, [e.sessionId]: false }))
        void reload(e.sessionId)
      }),
      chatService.serverEvents.on("agentError", (e) => {
        if (e.sessionId) {
          setGenerating((g) => ({ ...g, [e.sessionId!]: false }))
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
    async (sessionId: string, text: string) => {
      setError(null)
      setGenerating((g) => ({ ...g, [sessionId]: true }))
      patch(sessionId, (msgs) => [
        ...msgs,
        {
          id: `local-user-${Date.now()}`,
          role: "user",
          parts: [{ kind: "text", partId: "local", text }],
          createdAt: Date.now(),
        },
      ])
      try {
        await chatService.invoke("sendMessage", { sessionId, text })
      } catch (err) {
        setGenerating((g) => ({ ...g, [sessionId]: false }))
        setError(String(err))
      }
    },
    [chatService, patch],
  )

  const stop = React.useCallback(
    async (sessionId: string) => {
      await chatService.invoke("stopGeneration", sessionId)
      setGenerating((g) => ({ ...g, [sessionId]: false }))
    },
    [chatService],
  )

  const messages = activeSessionId ? (messagesMap[activeSessionId] ?? []) : []
  const isGenerating = activeSessionId ? Boolean(generating[activeSessionId]) : false
  return { messages, isGenerating, error, send, stop }
}
