import type {
  AssistantActivityEvent,
  AgentMode,
  AgentPermissionMode,
  ChatAttachment,
  ChatContextMention,
  GenerationStoppedEvent,
  ChatMessage,
  ChatMessagePart,
  ChatOrganizationSkillContext,
  ChatPermissionReply,
  ChatPermissionRequest,
  ChatProjectContext,
  ChatQuestionRequest,
  MessageDeltaEvent,
  MessageReasoningDeltaEvent,
  ReasoningLevel,
  ToolCallResultEvent,
  ToolCallStartedEvent,
} from "../../electron/chat/common.ts"
import type { ModelChoice } from "../../electron/models/common.ts"
import type { SessionScope } from "../../electron/session/common.ts"
import type { TextDeltaEvent, TextDeltaKind } from "./chat-message-state.ts"
import type { SessionPermissionGrant } from "@/routes/Chat/permission-request"
import type { QuestionDraftStore } from "@/routes/Chat/question-fields"
import type { ChatPendingQuestion } from "@/routes/Chat/question-state"
import type { ChatStatus } from "ai"

import * as React from "react"
import {
  agentAttachments,
  appendOptimisticConversationTurn,
  applyCancelledToolParts,
  coalesceTextDeltaEvent,
  ensureMessage,
  hasVisibleMessageDelta,
  markAssistantMessageToolsCancelled,
  markLatestAssistantToolsCancelled,
  markQuestionToolAnswered,
  markQuestionToolsCancelled,
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
import { reportRendererHandledError } from "@/lib/renderer-diagnostics"
import {
  createSessionPermissionGrant,
  isOoCliPermissionRequest,
  requestMatchesSessionGrant,
} from "@/routes/Chat/permission-request"
import {
  removeStoppedQuestionIds,
  reconcilePendingQuestions,
  setSessionStoppedQuestionIds,
} from "@/routes/Chat/question-model"
import {
  addStoredDismissedQuestions,
  addStoredRecoverableQuestions,
  addStoredStoppedQuestions,
  readStoredQuestionDraft,
  readStoredQuestionPromptSnapshot,
  removeStoredRecoverableQuestion,
  removeStoredQuestionDraft,
  removeStoredStoppedQuestion,
  writeStoredQuestionDraft,
} from "@/routes/Chat/question-persistence"

type MessagesMap = Record<string, ChatMessage[]>
type PendingQuestionsMap = Record<string, ChatQuestionRequest[]>
type PendingPermissionsMap = Record<string, ChatPermissionRequest[]>
type StoppedQuestionsMap = Record<string, string[]>
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
  pendingQuestions: ChatPendingQuestion[]
  pendingPermissions: ChatPermissionRequest[]
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
      permissionMode?: AgentPermissionMode
      projectContext?: ChatProjectContext
      reasoningLevel?: ReasoningLevel
      sessionScope?: SessionScope
    },
  ) => Promise<void>
  stop: (sessionId: string) => Promise<void>
  answerQuestion: (sessionId: string, requestId: string, answers: string[][]) => Promise<void>
  answerPermission: (sessionId: string, requestId: string, reply: ChatPermissionReply) => Promise<void>
  discardQuestion: (sessionId: string, requestId: string) => void
  rejectQuestion: (sessionId: string, requestId: string) => Promise<void>
  questionDrafts: QuestionDraftStore
  permissionMode: AgentPermissionMode
  setPermissionMode: (sessionId: string, mode: AgentPermissionMode) => void
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
  const [pendingQuestionsMap, setPendingQuestionsMap] = React.useState<PendingQuestionsMap>({})
  const [pendingPermissionsMap, setPendingPermissionsMap] = React.useState<PendingPermissionsMap>({})
  const [permissionModes, setPermissionModes] = React.useState<Record<string, AgentPermissionMode>>({})
  const [stoppedQuestionsMap, setStoppedQuestionsMap] = React.useState<StoppedQuestionsMap>({})
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
  const pendingQuestionsFetchVersions = React.useRef(new Map<string, number>())
  const pendingQuestionsMutationVersions = React.useRef(new Map<string, number>())
  const pendingPermissionsFetchVersions = React.useRef(new Map<string, number>())
  const pendingPermissionsMutationVersions = React.useRef(new Map<string, number>())
  const pendingQuestionsMapRef = React.useRef(pendingQuestionsMap)
  const pendingPermissionsMapRef = React.useRef(pendingPermissionsMap)
  const permissionModesRef = React.useRef(permissionModes)
  const sessionPermissionGrants = React.useRef(new Map<string, SessionPermissionGrant[]>())
  const stoppedQuestionsMapRef = React.useRef(stoppedQuestionsMap)

  const updatePendingQuestionsMap = React.useCallback(
    (updater: (current: PendingQuestionsMap) => PendingQuestionsMap) => {
      const next = updater(pendingQuestionsMapRef.current)
      pendingQuestionsMapRef.current = next
      setPendingQuestionsMap(next)
    },
    [],
  )

  const updatePendingPermissionsMap = React.useCallback(
    (updater: (current: PendingPermissionsMap) => PendingPermissionsMap) => {
      const next = updater(pendingPermissionsMapRef.current)
      pendingPermissionsMapRef.current = next
      setPendingPermissionsMap(next)
    },
    [],
  )

  React.useEffect(() => {
    permissionModesRef.current = permissionModes
  }, [permissionModes])

  const sessionPermissionMode = React.useCallback(
    (sessionId: string): AgentPermissionMode => permissionModesRef.current[sessionId] ?? "default",
    [],
  )

  React.useEffect(() => {
    stoppedQuestionsMapRef.current = stoppedQuestionsMap
  }, [stoppedQuestionsMap])

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

  const markPendingQuestionsMutated = React.useCallback((sessionId: string) => {
    pendingQuestionsMutationVersions.current.set(
      sessionId,
      (pendingQuestionsMutationVersions.current.get(sessionId) ?? 0) + 1,
    )
  }, [])

  const clearStoppedQuestion = React.useCallback((sessionId: string, target: ChatQuestionRequest | string) => {
    removeStoredStoppedQuestion(sessionId, target)
    setStoppedQuestionsMap((current) => {
      const stoppedIds = current[sessionId] ?? []
      const nextStoppedIds = removeStoppedQuestionIds(
        stoppedIds,
        pendingQuestionsMapRef.current[sessionId] ?? [],
        target,
      )
      if (nextStoppedIds === stoppedIds) {
        return current
      }
      const next = { ...current }
      if (nextStoppedIds.length > 0) {
        next[sessionId] = nextStoppedIds
      } else {
        delete next[sessionId]
      }
      return next
    })
  }, [])

  const markPendingQuestionsStopped = React.useCallback((sessionId: string) => {
    const requests = pendingQuestionsMapRef.current[sessionId] ?? []
    const requestIds = requests.map((request) => request.id)
    if (requestIds.length === 0) {
      return
    }
    addStoredStoppedQuestions(sessionId, requests)
    setStoppedQuestionsMap((current) => {
      const existing = current[sessionId] ?? []
      const nextIds = [...existing]
      for (const requestId of requestIds) {
        if (!nextIds.includes(requestId)) {
          nextIds.push(requestId)
        }
      }
      return nextIds.length === existing.length ? current : { ...current, [sessionId]: nextIds }
    })
  }, [])

  const removePendingQuestion = React.useCallback(
    (sessionId: string, requestId: string) => {
      const request = (pendingQuestionsMapRef.current[sessionId] ?? []).find((item) => item.id === requestId)
      const target = request ?? requestId
      markPendingQuestionsMutated(sessionId)
      removeStoredRecoverableQuestion(sessionId, target)
      clearStoppedQuestion(sessionId, target)
      removeStoredQuestionDraft(sessionId, target)
      updatePendingQuestionsMap((current) => ({
        ...current,
        [sessionId]: (current[sessionId] ?? []).filter((request) => request.id !== requestId),
      }))
    },
    [clearStoppedQuestion, markPendingQuestionsMutated, updatePendingQuestionsMap],
  )

  const dismissPendingQuestion = React.useCallback(
    (sessionId: string, requestId: string) => {
      // 用户主动丢弃的问题要写入 dismissed，后续 reload/recovery 不再把同一 tool 恢复成待回答。
      const request = (pendingQuestionsMapRef.current[sessionId] ?? []).find((item) => item.id === requestId)
      if (request) {
        addStoredDismissedQuestions(sessionId, [request])
      }
      removePendingQuestion(sessionId, requestId)
    },
    [removePendingQuestion],
  )

  const markPendingPermissionsMutated = React.useCallback((sessionId: string) => {
    pendingPermissionsMutationVersions.current.set(
      sessionId,
      (pendingPermissionsMutationVersions.current.get(sessionId) ?? 0) + 1,
    )
  }, [])

  const removePendingPermission = React.useCallback(
    (sessionId: string, requestId: string) => {
      markPendingPermissionsMutated(sessionId)
      updatePendingPermissionsMap((current) => ({
        ...current,
        [sessionId]: (current[sessionId] ?? []).filter((request) => request.id !== requestId),
      }))
    },
    [markPendingPermissionsMutated, updatePendingPermissionsMap],
  )

  const addSessionPermissionGrant = React.useCallback((sessionId: string, request: ChatPermissionRequest): void => {
    const grant = createSessionPermissionGrant(request)
    if (!grant) {
      return
    }
    const grants = sessionPermissionGrants.current.get(sessionId) ?? []
    const exists = grants.some(
      (item) => item.action === grant.action && item.patterns.join("\n") === grant.patterns.join("\n"),
    )
    if (!exists) {
      sessionPermissionGrants.current.set(sessionId, [...grants, grant])
    }
  }, [])

  const hasSessionPermissionGrant = React.useCallback((sessionId: string, request: ChatPermissionRequest): boolean => {
    const grants = sessionPermissionGrants.current.get(sessionId) ?? []
    return grants.some((grant) => requestMatchesSessionGrant(request, grant))
  }, [])

  const isAutoApprovablePermission = React.useCallback(
    (sessionId: string, request: ChatPermissionRequest, permissionMode: AgentPermissionMode): boolean =>
      isOoCliPermissionRequest(request) ||
      hasSessionPermissionGrant(sessionId, request) ||
      permissionMode === "full_access",
    [hasSessionPermissionGrant],
  )

  const replyPermissionRequest = React.useCallback(
    async (sessionId: string, requestId: string, reply: ChatPermissionReply): Promise<void> => {
      await chatService.invoke("answerPermission", { sessionId, requestId, reply })
      removePendingPermission(sessionId, requestId)
    },
    [chatService, removePendingPermission],
  )

  const replyAllPendingPermissions = React.useCallback(
    (sessionId: string, reply: ChatPermissionReply): void => {
      const requests = pendingPermissionsMapRef.current[sessionId] ?? []
      if (requests.length === 0) {
        return
      }
      for (const request of requests) {
        void replyPermissionRequest(sessionId, request.id, reply).catch((err: unknown) => {
          reportRendererHandledError("chat", "answerPermission invoke failed", err)
          setSessionError(sessionId, err instanceof Error ? err.message : String(err))
        })
      }
    },
    [replyPermissionRequest, setSessionError],
  )

  const setPermissionMode = React.useCallback(
    (sessionId: string, mode: AgentPermissionMode): void => {
      setPermissionModes((current) => (current[sessionId] === mode ? current : { ...current, [sessionId]: mode }))
      permissionModesRef.current = { ...permissionModesRef.current, [sessionId]: mode }
      if (mode === "full_access") {
        replyAllPendingPermissions(sessionId, "once")
      }
    },
    [replyAllPendingPermissions],
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
    (sessionId: string, stopped?: Pick<GenerationStoppedEvent, "messageId" | "partIds" | "stoppedAt">) => {
      flushPendingToolParts()
      patch(sessionId, (msgs) => {
        const { messages, partIds } = stopped?.messageId
          ? markAssistantMessageToolsCancelled(msgs, stopped.messageId, stopped.partIds, stopped.stoppedAt)
          : markLatestAssistantToolsCancelled(msgs, stopped?.stoppedAt)
        rememberCancelledToolParts(sessionId, partIds)
        return messages
      })
    },
    [flushPendingToolParts, patch, rememberCancelledToolParts],
  )

  const markQuestionRequestsCancelled = React.useCallback(
    (sessionId: string, requests: readonly ChatQuestionRequest[]) => {
      if (requests.length === 0) {
        return
      }
      // question 的取消只落到关联 tool part，避免停止一题时把同轮其它运行工具也标成取消。
      patch(sessionId, (msgs) => {
        const { messages, partIds } = markQuestionToolsCancelled(msgs, requests)
        rememberCancelledToolParts(sessionId, partIds)
        return messages
      })
    },
    [patch, rememberCancelledToolParts],
  )

  const markQuestionRequestAnswered = React.useCallback(
    (sessionId: string, request: ChatQuestionRequest | undefined, answers: string[][] | undefined) => {
      if (!request) {
        return
      }
      // 回答成功后立即把 question tool 标成 completed，随后 reload 再与服务端消息对齐。
      patch(sessionId, (msgs) => markQuestionToolAnswered(msgs, request, answers))
    },
    [patch],
  )

  const reload = React.useCallback(
    async (sessionId: string): Promise<ChatMessage[] | null> => {
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
        return msgs
      } catch (err) {
        console.error("[wanta] getMessages failed", err)
        reportRendererHandledError("chat", "getMessages failed", err)
        return null
      }
    },
    [chatService, flushPendingToolParts, isSessionUserStopped, rememberCancelledToolParts],
  )

  const reloadPendingQuestions = React.useCallback(
    async (sessionId: string, currentMessages: ChatMessage[] | null = null) => {
      const fetchVersion = (pendingQuestionsFetchVersions.current.get(sessionId) ?? 0) + 1
      const mutationVersion = pendingQuestionsMutationVersions.current.get(sessionId) ?? 0
      pendingQuestionsFetchVersions.current.set(sessionId, fetchVersion)
      const applyReconciliation = (fetchedQuestions: ChatQuestionRequest[] | null): void => {
        const storedQuestions = readStoredQuestionPromptSnapshot(sessionId)
        const reconciliation = reconcilePendingQuestions({
          currentMessages,
          dismissedQuestions: storedQuestions.dismissedQuestions,
          fetchedQuestions,
          previousQuestions: pendingQuestionsMapRef.current[sessionId] ?? [],
          sessionId,
          stoppedQuestionIds: stoppedQuestionsMapRef.current[sessionId] ?? [],
          storedRecoverableQuestions: storedQuestions.recoverableQuestions,
          storedStoppedQuestions: storedQuestions.stoppedQuestions,
        })
        for (const requestId of reconciliation.stoppedQuestionIdsToRemove) {
          removeStoredStoppedQuestion(sessionId, requestId)
        }
        for (const requestId of reconciliation.recoverableQuestionIdsToRemove) {
          removeStoredRecoverableQuestion(sessionId, requestId)
        }
        if (reconciliation.recoveredQuestionsToStore.length > 0) {
          addStoredRecoverableQuestions(sessionId, reconciliation.recoveredQuestionsToStore)
        }
        setStoppedQuestionsMap((current) =>
          setSessionStoppedQuestionIds(current, sessionId, reconciliation.stoppedQuestionIds),
        )
        if (!reconciliation.shouldApplyPendingQuestions) {
          return
        }
        updatePendingQuestionsMap((prev) => ({
          ...prev,
          [sessionId]: reconciliation.pendingQuestions,
        }))
      }
      try {
        const questions = await chatService.invoke("getPendingQuestions", sessionId)
        if (pendingQuestionsFetchVersions.current.get(sessionId) !== fetchVersion) {
          return
        }
        if ((pendingQuestionsMutationVersions.current.get(sessionId) ?? 0) !== mutationVersion) {
          return
        }
        applyReconciliation(questions)
      } catch (err) {
        if (pendingQuestionsFetchVersions.current.get(sessionId) !== fetchVersion) {
          return
        }
        if ((pendingQuestionsMutationVersions.current.get(sessionId) ?? 0) !== mutationVersion) {
          return
        }
        applyReconciliation(null)
        console.error("[wanta] getPendingQuestions failed", err)
        reportRendererHandledError("chat", "getPendingQuestions failed", err)
      }
    },
    [chatService, updatePendingQuestionsMap],
  )

  const reloadPendingPermissions = React.useCallback(
    async (sessionId: string) => {
      const fetchVersion = (pendingPermissionsFetchVersions.current.get(sessionId) ?? 0) + 1
      const mutationVersion = pendingPermissionsMutationVersions.current.get(sessionId) ?? 0
      pendingPermissionsFetchVersions.current.set(sessionId, fetchVersion)
      try {
        const permissions = await chatService.invoke("getPendingPermissions", sessionId)
        if (pendingPermissionsFetchVersions.current.get(sessionId) !== fetchVersion) {
          return
        }
        if ((pendingPermissionsMutationVersions.current.get(sessionId) ?? 0) !== mutationVersion) {
          return
        }
        const permissionMode = sessionPermissionMode(sessionId)
        const remainingPermissions: ChatPermissionRequest[] = []
        for (const permission of permissions) {
          const autoApprovable = isAutoApprovablePermission(sessionId, permission, permissionMode)
          if (autoApprovable) {
            void replyPermissionRequest(sessionId, permission.id, "once").catch((err: unknown) => {
              reportRendererHandledError("chat", "answerPermission invoke failed", err)
              setSessionError(sessionId, err instanceof Error ? err.message : String(err))
            })
          } else {
            remainingPermissions.push(permission)
          }
        }
        updatePendingPermissionsMap((prev) => ({
          ...prev,
          [sessionId]: remainingPermissions,
        }))
      } catch (err) {
        console.error("[wanta] getPendingPermissions failed", err)
        reportRendererHandledError("chat", "getPendingPermissions failed", err)
      }
    },
    [
      chatService,
      isAutoApprovablePermission,
      replyPermissionRequest,
      sessionPermissionMode,
      setSessionError,
      updatePendingPermissionsMap,
    ],
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
      chatService.serverEvents.on("questionAsked", (e) => {
        flushPendingToolParts()
        setStatus(e.sessionId, "streaming")
        setActivity(e.sessionId, undefined)
        markPendingQuestionsMutated(e.sessionId)
        clearStoppedQuestion(e.sessionId, e.request)
        addStoredRecoverableQuestions(e.sessionId, [e.request])
        updatePendingQuestionsMap((current) => {
          const questions = current[e.sessionId] ?? []
          const next = [e.request, ...questions.filter((request) => request.id !== e.request.id)]
          return { ...current, [e.sessionId]: next }
        })
      }),
      chatService.serverEvents.on("questionReplied", (e) => {
        const request = (pendingQuestionsMapRef.current[e.sessionId] ?? []).find((item) => item.id === e.requestId)
        markQuestionRequestAnswered(e.sessionId, request, e.answers)
        removePendingQuestion(e.sessionId, e.requestId)
      }),
      chatService.serverEvents.on("questionRejected", (e) => {
        const request = (pendingQuestionsMapRef.current[e.sessionId] ?? []).find((item) => item.id === e.requestId)
        markQuestionRequestsCancelled(e.sessionId, request ? [request] : [])
        removePendingQuestion(e.sessionId, e.requestId)
      }),
      chatService.serverEvents.on("permissionAsked", (e) => {
        flushPendingToolParts()
        const permissionMode = sessionPermissionMode(e.sessionId)
        const autoApprovable = isAutoApprovablePermission(e.sessionId, e.request, permissionMode)
        setStatus(e.sessionId, autoApprovable ? "streaming" : "ready")
        setActivity(e.sessionId, undefined)
        markPendingPermissionsMutated(e.sessionId)
        if (autoApprovable) {
          void replyPermissionRequest(e.sessionId, e.request.id, "once").catch((err: unknown) => {
            reportRendererHandledError("chat", "answerPermission invoke failed", err)
            setStatus(e.sessionId, "error")
            setSessionError(e.sessionId, err instanceof Error ? err.message : String(err))
          })
          return
        }
        updatePendingPermissionsMap((current) => {
          const permissions = current[e.sessionId] ?? []
          const next = [e.request, ...permissions.filter((request) => request.id !== e.request.id)]
          return { ...current, [e.sessionId]: next }
        })
      }),
      chatService.serverEvents.on("permissionReplied", (e) => {
        removePendingPermission(e.sessionId, e.requestId)
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
        markCurrentToolsCancelled(e.sessionId, e)
        markPendingQuestionsStopped(e.sessionId)
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
    clearStoppedQuestion,
    delayPendingToolFlushForText,
    enqueueToolCallResult,
    enqueueToolCallStarted,
    enqueueTextDelta,
    flushPendingToolParts,
    flushPendingTextDeltas,
    forgetPendingToolPart,
    isAutoApprovablePermission,
    isSessionUserStopped,
    markCurrentToolsCancelled,
    markPendingPermissionsMutated,
    markPendingQuestionsMutated,
    markPendingQuestionsStopped,
    markQuestionRequestAnswered,
    markQuestionRequestsCancelled,
    patch,
    reload,
    rememberCancelledToolParts,
    removePendingPermission,
    removePendingQuestion,
    replyPermissionRequest,
    sessionPermissionMode,
    setActivity,
    setSessionError,
    setStatus,
    updatePendingPermissionsMap,
    updatePendingQuestionsMap,
  ])

  React.useEffect(() => {
    if (activeSessionId) {
      void (async () => {
        const messages = await reload(activeSessionId)
        await reloadPendingQuestions(activeSessionId, messages)
      })()
      void reloadPendingPermissions(activeSessionId)
    }
  }, [activeSessionId, reload, reloadPendingPermissions, reloadPendingQuestions])

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
        permissionMode?: AgentPermissionMode
        projectContext?: ChatProjectContext
        reasoningLevel?: ReasoningLevel
        sessionScope?: SessionScope
      } = {},
    ) => {
      setGlobalError(null)
      clearSessionError(sessionId)
      userStoppedSessions.current.delete(sessionId)
      cancelledToolParts.current.delete(sessionId)
      setPermissionMode(sessionId, options.permissionMode ?? sessionPermissionMode(sessionId))
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
          permissionMode: options.permissionMode ?? sessionPermissionMode(sessionId),
          projectContext: options.projectContext,
          reasoningLevel: options.reasoningLevel,
          scope: options.sessionScope,
        })
      } catch (err) {
        reportRendererHandledError("chat", "sendMessage invoke failed", err)
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
        throw err
      }
    },
    [chatService, clearSessionError, patch, sessionPermissionMode, setActivity, setPermissionMode, setStatus],
  )

  const stop = React.useCallback(
    async (sessionId: string) => {
      setGlobalError(null)
      clearSessionError(sessionId)
      markSessionUserStopped(sessionId)
      markCurrentToolsCancelled(sessionId)
      markPendingQuestionsStopped(sessionId)
      try {
        await chatService.invoke("stopGeneration", sessionId)
        setStatus(sessionId, "ready")
        setActivity(sessionId, undefined)
      } catch (err) {
        reportRendererHandledError("chat", "stopGeneration invoke failed", err)
        setStatus(sessionId, "error")
        setActivity(sessionId, undefined)
        setSessionError(sessionId, String(err))
      }
    },
    [
      chatService,
      clearSessionError,
      markCurrentToolsCancelled,
      markPendingQuestionsStopped,
      markSessionUserStopped,
      setActivity,
      setSessionError,
      setStatus,
    ],
  )

  const answerQuestion = React.useCallback(
    async (sessionId: string, requestId: string, answers: string[][]) => {
      setGlobalError(null)
      clearSessionError(sessionId)
      const request = (pendingQuestionsMapRef.current[sessionId] ?? []).find((item) => item.id === requestId)
      setStatus(sessionId, "streaming")
      setActivity(sessionId, { sessionId, phase: "thinking" })
      try {
        await chatService.invoke("answerQuestion", { sessionId, requestId, answers })
        markQuestionRequestAnswered(sessionId, request, answers)
        removePendingQuestion(sessionId, requestId)
      } catch (err) {
        reportRendererHandledError("chat", "answerQuestion invoke failed", err)
        setStatus(sessionId, "error")
        setActivity(sessionId, undefined)
        setSessionError(sessionId, err instanceof Error ? err.message : String(err))
        throw err
      }
    },
    [
      chatService,
      clearSessionError,
      markQuestionRequestAnswered,
      removePendingQuestion,
      setActivity,
      setSessionError,
      setStatus,
    ],
  )

  const answerPermission = React.useCallback(
    async (sessionId: string, requestId: string, reply: ChatPermissionReply) => {
      setGlobalError(null)
      clearSessionError(sessionId)
      setStatus(sessionId, "streaming")
      setActivity(sessionId, { sessionId, phase: "thinking" })
      try {
        const request = (pendingPermissionsMapRef.current[sessionId] ?? []).find((item) => item.id === requestId)
        if (reply === "always" && request) {
          addSessionPermissionGrant(sessionId, request)
        }
        await replyPermissionRequest(sessionId, requestId, reply === "always" ? "once" : reply)
      } catch (err) {
        reportRendererHandledError("chat", "answerPermission invoke failed", err)
        setStatus(sessionId, "error")
        setActivity(sessionId, undefined)
        setSessionError(sessionId, err instanceof Error ? err.message : String(err))
        throw err
      }
    },
    [addSessionPermissionGrant, clearSessionError, replyPermissionRequest, setActivity, setSessionError, setStatus],
  )

  const discardQuestion = React.useCallback(
    (sessionId: string, requestId: string) => {
      const request = (pendingQuestionsMapRef.current[sessionId] ?? []).find((item) => item.id === requestId)
      markQuestionRequestsCancelled(sessionId, request ? [request] : [])
      dismissPendingQuestion(sessionId, requestId)
    },
    [dismissPendingQuestion, markQuestionRequestsCancelled],
  )

  const rejectQuestion = React.useCallback(
    async (sessionId: string, requestId: string) => {
      setGlobalError(null)
      clearSessionError(sessionId)
      const request = (pendingQuestionsMapRef.current[sessionId] ?? []).find((item) => item.id === requestId)
      try {
        await chatService.invoke("rejectQuestion", { sessionId, requestId })
        markSessionUserStopped(sessionId)
        removePendingQuestion(sessionId, requestId)
        markCurrentToolsCancelled(sessionId, request?.tool ? { messageId: request.tool.messageId } : undefined)
        setStatus(sessionId, "ready")
        setActivity(sessionId, undefined)
      } catch (err) {
        reportRendererHandledError("chat", "rejectQuestion invoke failed", err)
        setStatus(sessionId, "error")
        setActivity(sessionId, undefined)
        setSessionError(sessionId, err instanceof Error ? err.message : String(err))
        throw err
      }
    },
    [
      chatService,
      clearSessionError,
      markCurrentToolsCancelled,
      markSessionUserStopped,
      removePendingQuestion,
      setActivity,
      setSessionError,
      setStatus,
    ],
  )

  const messages = activeSessionId ? (messagesMap[activeSessionId] ?? []) : []
  const permissionMode = activeSessionId ? (permissionModes[activeSessionId] ?? "default") : "default"
  const pendingPermissions = activeSessionId ? (pendingPermissionsMap[activeSessionId] ?? []) : []
  const pendingQuestions = activeSessionId
    ? (pendingQuestionsMap[activeSessionId] ?? []).map((request) => ({
        request,
        state: stoppedQuestionsMap[activeSessionId]?.includes(request.id) ? ("stopped" as const) : ("active" as const),
      }))
    : []
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
  const questionDrafts = React.useMemo<QuestionDraftStore>(
    () => ({
      read: (sessionId, request, expectedDraftCount) => readStoredQuestionDraft(sessionId, request, expectedDraftCount),
      remove: (sessionId, request) => removeStoredQuestionDraft(sessionId, request),
      write: (sessionId, request, snapshot) => writeStoredQuestionDraft(sessionId, request, snapshot),
    }),
    [],
  )
  const error = visibleChatError(errorsBySession, globalError, activeSessionId)
  return {
    messages,
    pendingQuestions,
    pendingPermissions,
    status,
    activity,
    messagesLoaded,
    error,
    getSessionStatus,
    hasUnreadSession,
    send,
    stop,
    answerQuestion,
    answerPermission,
    discardQuestion,
    rejectQuestion,
    questionDrafts,
    permissionMode,
    setPermissionMode,
  }
}
