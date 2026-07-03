import type {
  AssistantActivityEvent,
  AgentMode,
  ChatAttachment,
  ChatContextMention,
  ChatMessage,
  ChatMessagePart,
  ChatOrganizationSkillContext,
  ChatProjectContext,
  MessageDeltaEvent,
  MessageReasoningDeltaEvent,
  ReasoningLevel,
  ToolCallResultEvent,
  ToolCallStartedEvent,
} from "../../electron/chat/common.ts"
import type { ModelChoice } from "../../electron/models/common.ts"
import type { TextDeltaEvent, TextDeltaKind } from "./chat-message-state.ts"
import type { ChatStatus } from "ai"

import * as React from "react"
import {
  agentAttachments,
  appendOptimisticConversationTurn,
  applyCancelledToolParts,
  coalesceTextDeltaEvent,
  ensureMessage,
  hasVisibleMessageDelta,
  markLatestAssistantToolsCancelled,
  markSessionCompletedUnread,
  markSessionViewed,
  mergeFetchedMessages,
  removePart,
  setConnectionStatusPart,
  setAttachmentPart,
  setErrorPart,
  setMessageArtifactRoot,
  setPart,
  setReasoningPart,
  setTextPart,
  textDeltaKey,
  visibleChatError,
} from "./chat-message-state.ts"
import { useChatService } from "@/components/AppContext"

type MessagesMap = Record<string, ChatMessage[]>
type CancelledToolPartsMap = Map<string, Set<string>>
type PendingTextDelta = {
  event: TextDeltaEvent
  kind: TextDeltaKind
}
type PendingToolPart = {
  messageId: string
  part: ChatMessagePart
  sessionId: string
}

const userStoppedToolCancelWindowMs = 30_000
// 工具事件可能早于同一 text part 的尾部 delta 抵达；短暂等待可避免先露工具、再在上方补字。
const toolPartSettleDelayMs = 240
const toolPartMaxSettleDelayMs = 1200

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
    options?: {
      contextMentions?: ChatContextMention[]
      mode?: AgentMode
      model?: ModelChoice
      organizationSkills?: ChatOrganizationSkillContext[]
      projectContext?: ChatProjectContext
      reasoningLevel?: ReasoningLevel
    },
  ) => Promise<void>
  stop: (sessionId: string) => Promise<void>
}

function setSessionStatus(
  statuses: Record<string, ChatStatus>,
  sessionId: string,
  status: ChatStatus,
): Record<string, ChatStatus> {
  return statuses[sessionId] === status ? statuses : { ...statuses, [sessionId]: status }
}

function sameAssistantActivity(
  left: AssistantActivityEvent | undefined,
  right: AssistantActivityEvent | undefined,
): boolean {
  if (!left || !right) {
    return left === right
  }
  return (
    left.sessionId === right.sessionId &&
    left.messageId === right.messageId &&
    left.phase === right.phase &&
    left.message === right.message &&
    left.attempt === right.attempt &&
    left.nextRetryAt === right.nextRetryAt
  )
}

function setSessionActivity(
  activities: Record<string, AssistantActivityEvent | undefined>,
  sessionId: string,
  activity: AssistantActivityEvent | undefined,
): Record<string, AssistantActivityEvent | undefined> {
  if (sameAssistantActivity(activities[sessionId], activity)) {
    return activities
  }
  if (!activity) {
    if (!Object.hasOwn(activities, sessionId)) {
      return activities
    }
    const next = { ...activities }
    delete next[sessionId]
    return next
  }
  return { ...activities, [sessionId]: activity }
}

export function useChat(activeSessionId: string | null, visibleSessionId: string | null = activeSessionId): UseChat {
  const chatService = useChatService()
  const [messagesMap, setMessagesMap] = React.useState<MessagesMap>({})
  const [statuses, setStatuses] = React.useState<Record<string, ChatStatus>>({})
  const [activities, setActivities] = React.useState<Record<string, AssistantActivityEvent | undefined>>({})
  const [unreadSessionIds, setUnreadSessionIds] = React.useState<Set<string>>(() => new Set())
  const [globalError, setGlobalError] = React.useState<string | null>(null)
  const [errorsBySession, setErrorsBySession] = React.useState<Record<string, string | undefined>>({})
  const visibleSessionIdRef = React.useRef<string | null>(visibleSessionId)
  const userStoppedSessions = React.useRef(new Map<string, number>())
  const cancelledToolParts = React.useRef<CancelledToolPartsMap>(new Map())
  const pendingTextDeltas = React.useRef(new Map<string, PendingTextDelta>())
  const pendingTextFrame = React.useRef<number | null>(null)
  const pendingToolParts = React.useRef(new Map<string, PendingToolPart>())
  const pendingToolTimer = React.useRef<number | null>(null)
  const pendingToolDelayStartedAt = React.useRef<number | null>(null)

  React.useEffect(() => {
    visibleSessionIdRef.current = visibleSessionId
    setUnreadSessionIds((current) => markSessionViewed(current, visibleSessionId))
  }, [visibleSessionId])

  const patch = React.useCallback((sessionId: string, updater: (msgs: ChatMessage[]) => ChatMessage[]) => {
    setMessagesMap((prev) => ({ ...prev, [sessionId]: updater(prev[sessionId] ?? []) }))
  }, [])

  const clearSessionError = React.useCallback((sessionId: string) => {
    setErrorsBySession((current) => {
      if (!current[sessionId]) {
        return current
      }
      const next = { ...current }
      delete next[sessionId]
      return next
    })
  }, [])

  const setSessionError = React.useCallback((sessionId: string, message: string) => {
    setErrorsBySession((current) =>
      current[sessionId] === message
        ? current
        : {
            ...current,
            [sessionId]: message,
          },
    )
  }, [])

  const setStatus = React.useCallback((sessionId: string, status: ChatStatus) => {
    setStatuses((current) => setSessionStatus(current, sessionId, status))
  }, [])

  const setActivity = React.useCallback((sessionId: string, activity: AssistantActivityEvent | undefined) => {
    setActivities((current) => setSessionActivity(current, sessionId, activity))
  }, [])

  const flushPendingTextDeltas = React.useCallback(() => {
    if (pendingTextFrame.current !== null) {
      window.cancelAnimationFrame(pendingTextFrame.current)
      pendingTextFrame.current = null
    }
    if (pendingTextDeltas.current.size === 0) {
      return
    }
    const queued = Array.from(pendingTextDeltas.current.values())
    pendingTextDeltas.current.clear()
    setMessagesMap((prev) => {
      let nextMap: MessagesMap | null = null
      for (const { event, kind } of queued) {
        const baseMap = nextMap ?? prev
        const currentMessages = baseMap[event.sessionId] ?? []
        const nextMessages =
          kind === "text"
            ? setTextPart(currentMessages, event as MessageDeltaEvent)
            : setReasoningPart(currentMessages, event as MessageReasoningDeltaEvent)
        if (!nextMap) {
          nextMap = { ...prev }
        }
        nextMap[event.sessionId] = nextMessages
      }
      return nextMap ?? prev
    })
  }, [])

  const enqueueTextDelta = React.useCallback(
    (kind: TextDeltaKind, event: TextDeltaEvent) => {
      const key = textDeltaKey(kind, event)
      const pending = pendingTextDeltas.current.get(key)
      pendingTextDeltas.current.set(key, {
        event: coalesceTextDeltaEvent(pending?.event, event),
        kind,
      })
      if (pendingTextFrame.current === null) {
        pendingTextFrame.current = window.requestAnimationFrame(() => {
          pendingTextFrame.current = null
          flushPendingTextDeltas()
        })
      }
    },
    [flushPendingTextDeltas],
  )

  const flushPendingToolParts = React.useCallback(() => {
    if (pendingToolTimer.current !== null) {
      window.clearTimeout(pendingToolTimer.current)
      pendingToolTimer.current = null
    }
    pendingToolDelayStartedAt.current = null
    flushPendingTextDeltas()
    if (pendingToolParts.current.size === 0) {
      return
    }
    const queued = Array.from(pendingToolParts.current.values())
    pendingToolParts.current.clear()
    setMessagesMap((prev) => {
      let nextMap: MessagesMap | null = null
      for (const { messageId, part, sessionId } of queued) {
        const baseMap = nextMap ?? prev
        const currentMessages = baseMap[sessionId] ?? []
        const nextMessages = setPart(currentMessages, messageId, part)
        if (!nextMap) {
          nextMap = { ...prev }
        }
        nextMap[sessionId] = nextMessages
      }
      return nextMap ?? prev
    })
  }, [flushPendingTextDeltas])

  const schedulePendingToolFlush = React.useCallback(() => {
    if (pendingToolTimer.current !== null) {
      window.clearTimeout(pendingToolTimer.current)
    }
    const now = Date.now()
    pendingToolDelayStartedAt.current ??= now
    const elapsed = now - pendingToolDelayStartedAt.current
    const delay = Math.max(0, Math.min(toolPartSettleDelayMs, toolPartMaxSettleDelayMs - elapsed))
    pendingToolTimer.current = window.setTimeout(() => {
      pendingToolTimer.current = null
      flushPendingToolParts()
    }, delay)
  }, [flushPendingToolParts])

  const enqueueToolPart = React.useCallback(
    (sessionId: string, messageId: string, part: ChatMessagePart) => {
      pendingToolParts.current.set(`${sessionId}\0${messageId}\0${part.partId}`, { messageId, part, sessionId })
      schedulePendingToolFlush()
    },
    [schedulePendingToolFlush],
  )

  const delayPendingToolFlushForText = React.useCallback(
    (event: TextDeltaEvent) => {
      for (const pending of pendingToolParts.current.values()) {
        if (pending.sessionId === event.sessionId && pending.messageId === event.messageId) {
          schedulePendingToolFlush()
          return
        }
      }
    },
    [schedulePendingToolFlush],
  )

  const forgetPendingToolPart = React.useCallback((sessionId: string, messageId: string, partId: string) => {
    pendingToolParts.current.delete(`${sessionId}\0${messageId}\0${partId}`)
  }, [])

  const enqueueToolCallStarted = React.useCallback(
    (e: ToolCallStartedEvent) => {
      enqueueToolPart(e.sessionId, e.messageId, {
        kind: "tool",
        partId: e.partId,
        callId: e.callId,
        tool: e.tool,
        status: e.status,
        input: e.input,
        title: e.title,
        metadata: e.metadata,
        timing: e.timing,
      })
    },
    [enqueueToolPart],
  )

  const enqueueToolCallResult = React.useCallback(
    (e: ToolCallResultEvent, cancelled: boolean) => {
      enqueueToolPart(e.sessionId, e.messageId, {
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
        authorization: e.authorization,
        ...(cancelled ? { cancelled: true } : {}),
      })
    },
    [enqueueToolPart],
  )

  React.useEffect(() => {
    return () => {
      if (pendingTextFrame.current !== null) {
        window.cancelAnimationFrame(pendingTextFrame.current)
        pendingTextFrame.current = null
      }
      pendingTextDeltas.current.clear()
      if (pendingToolTimer.current !== null) {
        window.clearTimeout(pendingToolTimer.current)
        pendingToolTimer.current = null
      }
      pendingToolDelayStartedAt.current = null
      pendingToolParts.current.clear()
    }
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
      flushPendingToolParts()
      patch(sessionId, (msgs) => {
        const { messages, partIds } = markLatestAssistantToolsCancelled(msgs)
        rememberCancelledToolParts(sessionId, partIds)
        return messages
      })
    },
    [flushPendingToolParts, patch, rememberCancelledToolParts],
  )

  const reload = React.useCallback(
    async (sessionId: string) => {
      flushPendingToolParts()
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
        console.error("[wanta] getMessages failed", err)
      }
    },
    [chatService, flushPendingToolParts, isSessionUserStopped, rememberCancelledToolParts],
  )

  React.useEffect(() => {
    const offs = [
      chatService.serverEvents.on("messageStarted", (e) => {
        patch(e.sessionId, (msgs) => ensureMessage(msgs, e.messageId, e.role))
        if (e.role === "assistant") {
          setStatus(e.sessionId, "streaming")
          setActivity(e.sessionId, { sessionId: e.sessionId, messageId: e.messageId, phase: "thinking" })
        }
      }),
      chatService.serverEvents.on("messageDelta", (e) => {
        setStatus(e.sessionId, "streaming")
        if (hasVisibleMessageDelta(e)) {
          setActivity(e.sessionId, undefined)
        }
        enqueueTextDelta("text", e)
        delayPendingToolFlushForText(e)
      }),
      chatService.serverEvents.on("messageReasoningDelta", (e) => {
        setStatus(e.sessionId, "streaming")
        setActivity(e.sessionId, { sessionId: e.sessionId, messageId: e.messageId, phase: "thinking" })
        enqueueTextDelta("reasoning", e)
      }),
      chatService.serverEvents.on("messageAttachment", (e) => {
        flushPendingTextDeltas()
        patch(e.sessionId, (msgs) => setAttachmentPart(msgs, e))
      }),
      chatService.serverEvents.on("messageArtifacts", (e) => {
        patch(e.sessionId, (msgs) => setMessageArtifactRoot(msgs, e))
      }),
      chatService.serverEvents.on("toolCallStarted", (e) => {
        setStatus(e.sessionId, "streaming")
        setActivity(e.sessionId, undefined)
        enqueueToolCallStarted(e)
      }),
      chatService.serverEvents.on("toolCallResult", (e) => {
        const cancelled = e.status === "error" && isSessionUserStopped(e.sessionId)
        setStatus(e.sessionId, cancelled ? "ready" : "streaming")
        if (!cancelled) {
          setActivity(e.sessionId, { sessionId: e.sessionId, messageId: e.messageId, phase: "finalizing" })
        }
        if (cancelled) {
          rememberCancelledToolParts(e.sessionId, [e.partId])
        }
        enqueueToolCallResult(e, cancelled)
      }),
      chatService.serverEvents.on("assistantActivity", (e) => {
        setStatus(e.sessionId, "streaming")
        setActivity(e.sessionId, e)
      }),
      chatService.serverEvents.on("agentConnectionChanged", (e) => {
        if (e.status === "reconnecting" || e.status === "runtime_restarting" || e.status === "reconnected") {
          setStatus(e.sessionId, "streaming")
          setActivity(e.sessionId, undefined)
          patch(e.sessionId, (msgs) => setConnectionStatusPart(msgs, e))
          return
        }
        if (e.status === "failed" || e.status === "runtime_recovered" || e.status === "runtime_failed") {
          patch(e.sessionId, (msgs) => setConnectionStatusPart(msgs, e))
        }
        if (e.status === "failed" || e.status === "runtime_recovered" || e.status === "runtime_failed") {
          setStatus(e.sessionId, "error")
          setActivity(e.sessionId, undefined)
          return
        }
        setActivity(e.sessionId, undefined)
      }),
      chatService.serverEvents.on("messagePartRemoved", (e) => {
        flushPendingTextDeltas()
        forgetPendingToolPart(e.sessionId, e.messageId, e.partId)
        patch(e.sessionId, (msgs) => removePart(msgs, e))
      }),
      chatService.serverEvents.on("messageCompleted", (e) => {
        flushPendingToolParts()
        setStatus(e.sessionId, "ready")
        setActivity(e.sessionId, undefined)
        setUnreadSessionIds((current) => markSessionCompletedUnread(current, e.sessionId, visibleSessionIdRef.current))
        void reload(e.sessionId)
      }),
      chatService.serverEvents.on("messageError", (e) => {
        flushPendingToolParts()
        setStatus(e.sessionId, "error")
        setActivity(e.sessionId, undefined)
        clearSessionError(e.sessionId)
        patch(e.sessionId, (msgs) => setErrorPart(msgs, e))
      }),
      chatService.serverEvents.on("generationStopped", (e) => {
        flushPendingToolParts()
        setStatus(e.sessionId, "ready")
        setActivity(e.sessionId, undefined)
        clearSessionError(e.sessionId)
        markCurrentToolsCancelled(e.sessionId)
        void reload(e.sessionId)
      }),
      chatService.serverEvents.on("agentError", (e) => {
        flushPendingToolParts()
        if (e.sessionId) {
          const sessionId = e.sessionId
          setStatus(sessionId, "error")
          setActivity(sessionId, undefined)
          setSessionError(sessionId, e.message)
          return
        }
        setGlobalError(e.message)
      }),
    ]
    return () => {
      for (const off of offs) {
        off()
      }
    }
  }, [
    chatService,
    clearSessionError,
    delayPendingToolFlushForText,
    enqueueToolCallResult,
    enqueueToolCallStarted,
    enqueueTextDelta,
    flushPendingToolParts,
    flushPendingTextDeltas,
    forgetPendingToolPart,
    isSessionUserStopped,
    markCurrentToolsCancelled,
    patch,
    reload,
    rememberCancelledToolParts,
    setActivity,
    setSessionError,
    setStatus,
  ])

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
      options: {
        contextMentions?: ChatContextMention[]
        mode?: AgentMode
        model?: ModelChoice
        organizationSkills?: ChatOrganizationSkillContext[]
        projectContext?: ChatProjectContext
        reasoningLevel?: ReasoningLevel
      } = {},
    ) => {
      setGlobalError(null)
      clearSessionError(sessionId)
      userStoppedSessions.current.delete(sessionId)
      cancelledToolParts.current.delete(sessionId)
      setStatus(sessionId, "submitted")
      setActivity(sessionId, { sessionId, phase: "thinking" })
      patch(sessionId, (msgs) => appendOptimisticConversationTurn(msgs, text, attachments, options.contextMentions))
      try {
        await chatService.invoke("sendMessage", {
          sessionId,
          text,
          attachments: agentAttachments(attachments),
          contextMentions: options.contextMentions,
          mode: options.mode,
          model: options.model,
          organizationSkills: options.organizationSkills,
          projectContext: options.projectContext,
          reasoningLevel: options.reasoningLevel,
        })
      } catch (err) {
        setStatus(sessionId, "error")
        setActivity(sessionId, undefined)
        clearSessionError(sessionId)
        patch(sessionId, (msgs) =>
          setErrorPart(msgs, {
            sessionId,
            partId: `local-error-${Date.now()}`,
            message: err instanceof Error ? err.message : String(err),
          }),
        )
      }
    },
    [chatService, clearSessionError, patch, setActivity, setStatus],
  )

  const stop = React.useCallback(
    async (sessionId: string) => {
      setGlobalError(null)
      clearSessionError(sessionId)
      markSessionUserStopped(sessionId)
      markCurrentToolsCancelled(sessionId)
      try {
        await chatService.invoke("stopGeneration", sessionId)
        setStatus(sessionId, "ready")
        setActivity(sessionId, undefined)
      } catch (err) {
        setStatus(sessionId, "error")
        setActivity(sessionId, undefined)
        setSessionError(sessionId, String(err))
      }
    },
    [
      chatService,
      clearSessionError,
      markCurrentToolsCancelled,
      markSessionUserStopped,
      setActivity,
      setSessionError,
      setStatus,
    ],
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
  const error = visibleChatError(errorsBySession, globalError, activeSessionId)
  return { messages, status, activity, messagesLoaded, error, getSessionStatus, hasUnreadSession, send, stop }
}
