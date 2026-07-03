import type { AgentMode, ChatAttachment, ChatContextMention, ReasoningLevel } from "../../../electron/chat/common.ts"
import type { ModelChoice } from "../../../electron/models/common.ts"
import type { ChatQueueMap, QueuedMessageMovePlacement } from "./chat-queue.ts"
import type { ChatStatus } from "ai"

import * as React from "react"
import { createQueuedChatMessage } from "./app-shell-model.ts"
import {
  appendQueuedMessage,
  clearQueuedMessages,
  moveQueuedMessage,
  removeQueuedMessage,
  shouldDispatchQueuedMessage,
} from "./chat-queue.ts"
import { reportRendererHandledError } from "@/lib/renderer-diagnostics"

type SendQueuedMessage = (
  text: string,
  attachments: ChatAttachment[],
  contextMentions: ChatContextMention[],
  model?: ModelChoice,
  reasoningLevel?: ReasoningLevel,
  mode?: AgentMode,
  afterOptimisticSubmit?: () => void,
) => Promise<boolean>

interface UseChatQueueStateOptions {
  activeSessionId: string | null
  initialSendPending: boolean
  isSendInFlight: () => boolean
  sendQueuedMessage: SendQueuedMessage
  status: ChatStatus
}

export function useChatQueueState({
  activeSessionId,
  initialSendPending,
  isSendInFlight,
  sendQueuedMessage,
  status,
}: UseChatQueueStateOptions) {
  const [queuedMessagesBySession, setQueuedMessagesBySession] = React.useState<ChatQueueMap>({})
  const [heldQueuedSessions, setHeldQueuedSessions] = React.useState<Set<string>>(() => new Set())
  const dispatchingQueuedSessionsRef = React.useRef<Set<string>>(new Set())
  const activeQueuedMessages = activeSessionId ? (queuedMessagesBySession[activeSessionId] ?? []) : []
  const activeQueueHeld = activeSessionId ? heldQueuedSessions.has(activeSessionId) : false

  const queueActiveMessage = React.useCallback(
    (
      text: string,
      attachments: ChatAttachment[],
      contextMentions: ChatContextMention[] | undefined,
      model?: ModelChoice,
      reasoningLevel?: ReasoningLevel,
      mode?: AgentMode,
    ): boolean => {
      if (!activeSessionId) {
        return false
      }
      const queuedMessage = createQueuedChatMessage(
        activeSessionId,
        text,
        attachments,
        contextMentions,
        model,
        reasoningLevel,
        mode,
      )
      setQueuedMessagesBySession((current) => appendQueuedMessage(current, queuedMessage))
      return true
    },
    [activeSessionId],
  )

  const releaseActiveQueue = React.useCallback((): void => {
    if (!activeSessionId) {
      return
    }
    setHeldQueuedSessions((current) => {
      if (!current.has(activeSessionId)) {
        return current
      }
      const next = new Set(current)
      next.delete(activeSessionId)
      return next
    })
  }, [activeSessionId])

  const holdActiveQueueIfQueued = React.useCallback((): void => {
    if (!activeSessionId || (queuedMessagesBySession[activeSessionId] ?? []).length === 0) {
      return
    }
    setHeldQueuedSessions((current) => {
      if (current.has(activeSessionId)) {
        return current
      }
      const next = new Set(current)
      next.add(activeSessionId)
      return next
    })
  }, [activeSessionId, queuedMessagesBySession])

  const clearQueuedSession = React.useCallback((sessionId: string): void => {
    setQueuedMessagesBySession((current) => clearQueuedMessages(current, sessionId))
    setHeldQueuedSessions((current) => {
      if (!current.has(sessionId)) {
        return current
      }
      const next = new Set(current)
      next.delete(sessionId)
      return next
    })
  }, [])

  React.useEffect(() => {
    setHeldQueuedSessions((current) => {
      let changed = false
      const next = new Set(current)
      for (const sessionId of current) {
        if ((queuedMessagesBySession[sessionId] ?? []).length === 0) {
          next.delete(sessionId)
          changed = true
        }
      }
      return changed ? next : current
    })
  }, [queuedMessagesBySession])

  React.useEffect(() => {
    if (!activeSessionId || !shouldDispatchQueuedMessage(status, initialSendPending, activeQueueHeld)) {
      return
    }
    if (dispatchingQueuedSessionsRef.current.has(activeSessionId) || isSendInFlight()) {
      return
    }
    const message = (queuedMessagesBySession[activeSessionId] ?? [])[0] ?? null
    if (!message) {
      return
    }
    dispatchingQueuedSessionsRef.current.add(activeSessionId)
    void sendQueuedMessage(
      message.text,
      message.attachments,
      message.contextMentions ?? [],
      message.model,
      message.reasoningLevel,
      message.mode,
      () => {
        setQueuedMessagesBySession((current) => removeQueuedMessage(current, activeSessionId, message.id))
      },
    )
      .then((accepted) => {
        if (!accepted) {
          setQueuedMessagesBySession((current) =>
            current[activeSessionId]?.some((item) => item.id === message.id)
              ? current
              : appendQueuedMessage(current, message),
          )
        }
      })
      .catch((cause: unknown) => {
        setQueuedMessagesBySession((current) =>
          current[activeSessionId]?.some((item) => item.id === message.id)
            ? current
            : appendQueuedMessage(current, message),
        )
        console.error("[wanta] dispatch queued message failed", cause)
        reportRendererHandledError("chatQueue.dispatch", "Failed to dispatch queued message", cause)
      })
      .finally(() => {
        dispatchingQueuedSessionsRef.current.delete(activeSessionId)
      })
  }, [
    activeQueueHeld,
    activeSessionId,
    initialSendPending,
    isSendInFlight,
    queuedMessagesBySession,
    sendQueuedMessage,
    status,
  ])

  const handleQueuedMessageRemove = React.useCallback(
    (messageId: string) => {
      if (!activeSessionId) {
        return
      }
      setQueuedMessagesBySession((current) => removeQueuedMessage(current, activeSessionId, messageId))
    },
    [activeSessionId],
  )

  const handleQueuedMessageMove = React.useCallback(
    (messageId: string, targetId: string, placement: QueuedMessageMovePlacement) => {
      if (!activeSessionId) {
        return
      }
      setQueuedMessagesBySession((current) =>
        moveQueuedMessage(current, activeSessionId, messageId, targetId, placement),
      )
    },
    [activeSessionId],
  )

  const handleQueuedMessageResume = React.useCallback(() => {
    releaseActiveQueue()
  }, [releaseActiveQueue])

  return {
    activeQueueHeld,
    activeQueuedMessages,
    clearQueuedSession,
    handleQueuedMessageMove,
    handleQueuedMessageRemove,
    handleQueuedMessageResume,
    holdActiveQueueIfQueued,
    queueActiveMessage,
    releaseActiveQueue,
  }
}
