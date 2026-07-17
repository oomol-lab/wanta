import type {
  ChatMessage,
  ChatMessagePart,
  ToolCallResultEvent,
  ToolCallStartedEvent,
} from "../../electron/chat/common.ts"
import type { TextDeltaEvent, TextDeltaKind } from "./chat-message-state.ts"

import * as React from "react"
import { coalesceTextDeltaEvent, setPart, setReasoningPart, setTextPart, textDeltaKey } from "./chat-message-state.ts"

export type ChatMessagesMap = Record<string, ChatMessage[]>

interface PendingTextDelta {
  event: TextDeltaEvent
  kind: TextDeltaKind
}

interface PendingToolPart {
  messageId: string
  part: ChatMessagePart
  sessionId: string
}

// 工具事件可能早于同一 text part 的尾部 delta 抵达；短暂等待可避免先露工具、再在上方补字。
const toolPartSettleDelayMs = 240
const toolPartMaxSettleDelayMs = 1200

export interface ChatEventBuffer {
  delayToolFlushForText: (event: TextDeltaEvent) => void
  enqueueTextDelta: (kind: TextDeltaKind, event: TextDeltaEvent) => void
  enqueueToolCallResult: (event: ToolCallResultEvent, cancelled: boolean) => void
  enqueueToolCallStarted: (event: ToolCallStartedEvent) => void
  flushTextDeltas: () => void
  flushToolParts: () => void
  forgetToolPart: (sessionId: string, messageId: string, partId: string) => void
  forgetSession: (sessionId: string) => void
  reset: () => void
}

export function useChatEventBuffer(
  setMessagesMap: React.Dispatch<React.SetStateAction<ChatMessagesMap>>,
  messagesMutationVersions: React.RefObject<Map<string, number>>,
): ChatEventBuffer {
  const pendingTextDeltas = React.useRef(new Map<string, PendingTextDelta>())
  const pendingTextFrame = React.useRef<number | null>(null)
  const pendingToolParts = React.useRef(new Map<string, PendingToolPart>())
  const pendingToolTimer = React.useRef<number | null>(null)
  const pendingToolDelayStartedAt = React.useRef<number | null>(null)

  const flushTextDeltas = React.useCallback(() => {
    if (pendingTextFrame.current !== null) {
      window.cancelAnimationFrame(pendingTextFrame.current)
      pendingTextFrame.current = null
    }
    if (pendingTextDeltas.current.size === 0) {
      return
    }
    const queued = Array.from(pendingTextDeltas.current.values())
    pendingTextDeltas.current.clear()
    setMessagesMap((previous) => {
      let nextMap: ChatMessagesMap | null = null
      for (const { event, kind } of queued) {
        const baseMap = nextMap ?? previous
        const currentMessages = baseMap[event.sessionId] ?? []
        const nextMessages =
          kind === "text" ? setTextPart(currentMessages, event) : setReasoningPart(currentMessages, event)
        nextMap ??= { ...previous }
        nextMap[event.sessionId] = nextMessages
      }
      return nextMap ?? previous
    })
  }, [setMessagesMap])

  const enqueueTextDelta = React.useCallback(
    (kind: TextDeltaKind, event: TextDeltaEvent) => {
      messagesMutationVersions.current.set(
        event.sessionId,
        (messagesMutationVersions.current.get(event.sessionId) ?? 0) + 1,
      )
      const key = textDeltaKey(kind, event)
      const pending = pendingTextDeltas.current.get(key)
      pendingTextDeltas.current.set(key, { event: coalesceTextDeltaEvent(pending?.event, event), kind })
      if (pendingTextFrame.current === null) {
        pendingTextFrame.current = window.requestAnimationFrame(() => {
          pendingTextFrame.current = null
          flushTextDeltas()
        })
      }
    },
    [flushTextDeltas, messagesMutationVersions],
  )

  const flushToolParts = React.useCallback(() => {
    if (pendingToolTimer.current !== null) {
      window.clearTimeout(pendingToolTimer.current)
      pendingToolTimer.current = null
    }
    pendingToolDelayStartedAt.current = null
    flushTextDeltas()
    if (pendingToolParts.current.size === 0) {
      return
    }
    const queued = Array.from(pendingToolParts.current.values())
    pendingToolParts.current.clear()
    setMessagesMap((previous) => {
      let nextMap: ChatMessagesMap | null = null
      for (const { messageId, part, sessionId } of queued) {
        const baseMap = nextMap ?? previous
        const nextMessages = setPart(baseMap[sessionId] ?? [], messageId, part)
        nextMap ??= { ...previous }
        nextMap[sessionId] = nextMessages
      }
      return nextMap ?? previous
    })
  }, [flushTextDeltas, setMessagesMap])

  const scheduleToolFlush = React.useCallback(() => {
    if (pendingToolTimer.current !== null) {
      window.clearTimeout(pendingToolTimer.current)
    }
    const now = Date.now()
    pendingToolDelayStartedAt.current ??= now
    const elapsed = now - pendingToolDelayStartedAt.current
    const delay = Math.max(0, Math.min(toolPartSettleDelayMs, toolPartMaxSettleDelayMs - elapsed))
    pendingToolTimer.current = window.setTimeout(() => {
      pendingToolTimer.current = null
      flushToolParts()
    }, delay)
  }, [flushToolParts])

  const enqueueToolPart = React.useCallback(
    (sessionId: string, messageId: string, part: ChatMessagePart) => {
      messagesMutationVersions.current.set(sessionId, (messagesMutationVersions.current.get(sessionId) ?? 0) + 1)
      pendingToolParts.current.set(`${sessionId}\0${messageId}\0${part.partId}`, { messageId, part, sessionId })
      scheduleToolFlush()
    },
    [messagesMutationVersions, scheduleToolFlush],
  )

  const enqueueToolCallStarted = React.useCallback(
    (event: ToolCallStartedEvent) => {
      enqueueToolPart(event.sessionId, event.messageId, {
        kind: "tool",
        partId: event.partId,
        callId: event.callId,
        tool: event.tool,
        status: event.status,
        input: event.input,
        title: event.title,
        metadata: event.metadata,
        timing: event.timing,
      })
    },
    [enqueueToolPart],
  )

  const enqueueToolCallResult = React.useCallback(
    (event: ToolCallResultEvent, cancelled: boolean) => {
      enqueueToolPart(event.sessionId, event.messageId, {
        kind: "tool",
        partId: event.partId,
        callId: event.callId,
        tool: event.tool,
        status: event.status,
        input: event.input,
        output: event.output,
        error: event.error,
        title: event.title,
        metadata: event.metadata,
        timing: event.timing,
        attachmentsCount: event.attachmentsCount,
        authorization: event.authorization,
        ...(cancelled ? { cancelled: true } : {}),
      })
    },
    [enqueueToolPart],
  )

  const delayToolFlushForText = React.useCallback(
    (event: TextDeltaEvent) => {
      for (const pending of pendingToolParts.current.values()) {
        if (pending.sessionId === event.sessionId && pending.messageId === event.messageId) {
          scheduleToolFlush()
          return
        }
      }
    },
    [scheduleToolFlush],
  )

  const forgetToolPart = React.useCallback((sessionId: string, messageId: string, partId: string) => {
    pendingToolParts.current.delete(`${sessionId}\0${messageId}\0${partId}`)
  }, [])

  const forgetSession = React.useCallback((sessionId: string): void => {
    for (const [key, pending] of pendingTextDeltas.current) {
      if (pending.event.sessionId === sessionId) pendingTextDeltas.current.delete(key)
    }
    for (const [key, pending] of pendingToolParts.current) {
      if (pending.sessionId === sessionId) pendingToolParts.current.delete(key)
    }
  }, [])

  const reset = React.useCallback((): void => {
    if (pendingTextFrame.current !== null) window.cancelAnimationFrame(pendingTextFrame.current)
    if (pendingToolTimer.current !== null) window.clearTimeout(pendingToolTimer.current)
    pendingTextFrame.current = null
    pendingToolTimer.current = null
    pendingToolDelayStartedAt.current = null
    pendingTextDeltas.current.clear()
    pendingToolParts.current.clear()
  }, [])

  React.useEffect(() => {
    return () => {
      if (pendingTextFrame.current !== null) {
        window.cancelAnimationFrame(pendingTextFrame.current)
      }
      pendingTextDeltas.current.clear()
      if (pendingToolTimer.current !== null) {
        window.clearTimeout(pendingToolTimer.current)
      }
      pendingToolParts.current.clear()
    }
  }, [])

  return {
    delayToolFlushForText,
    enqueueTextDelta,
    enqueueToolCallResult,
    enqueueToolCallStarted,
    flushTextDeltas,
    flushToolParts,
    forgetSession,
    forgetToolPart,
    reset,
  }
}
