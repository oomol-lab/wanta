import type {
  AssistantActivityEvent,
  AgentMode,
  AgentPermissionMode,
  ChatAttachment,
  ChatSessionSnapshot,
  ChatContextMention,
  GenerationStoppedEvent,
  ChatMessage,
  ChatOrganizationSkillContext,
  ChatPermissionReply,
  ChatPermissionRequest,
  ChatProjectContext,
  ChatQuestionRequest,
  ReasoningLevel,
} from "../../electron/chat/common.ts"
import type { ModelChoice } from "../../electron/models/common.ts"
import type { SessionScope } from "../../electron/session/common.ts"
import type { ChatMessagesMap } from "./use-chat-event-buffer.ts"
import type { QuestionDraftStore } from "@/routes/Chat/question-fields"
import type { ChatStatus } from "ai"

import * as React from "react"
import {
  agentAttachments,
  appendOptimisticConversationTurn,
  applyCancelledToolParts,
  hasVisibleMessageDelta,
  markAssistantMessageToolsInterrupted,
  markAssistantMessageToolsCancelled,
  markLatestAssistantToolsCancelled,
  markQuestionToolAnswered,
  markQuestionToolsCancelled,
  mergeFetchedMessages,
  removePart,
  setConnectionStatusPart,
  setGenerationNoticePart,
  setAttachmentPart,
  setErrorPart,
  setMessageFinishReason,
  setMessageInfo,
  visibleChatError,
} from "./chat-message-state.ts"
import { useChatEventBuffer } from "./use-chat-event-buffer.ts"
import { useChatRunState } from "./use-chat-run-state.ts"
import { useChatService } from "@/components/AppContext"
import { reportRendererHandledError } from "@/lib/renderer-diagnostics"

type MessagesMap = ChatMessagesMap
type PendingQuestionsMap = Record<string, ChatQuestionRequest[]>
type PendingPermissionsMap = Record<string, ChatPermissionRequest[]>
type CancelledToolPartsMap = Map<string, Set<string>>

const userStoppedToolCancelWindowMs = 30_000

function questionDraftKey(sessionId: string, requestId: string): string {
  return `${sessionId}\0${requestId}`
}

export interface UseChat {
  messages: ChatMessage[]
  pendingQuestions: ChatQuestionRequest[]
  pendingPermissions: ChatPermissionRequest[]
  status: ChatStatus
  activity: AssistantActivityEvent | null
  messagesLoaded: boolean
  error: string | null
  getSessionStatus: (sessionId: string) => ChatStatus
  getSessionRunStartedAt: (sessionId: string) => number | null
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
  rejectQuestion: (sessionId: string, requestId: string) => Promise<void>
  questionDrafts: QuestionDraftStore
  permissionMode: AgentPermissionMode
  setPermissionMode: (sessionId: string, mode: AgentPermissionMode) => number
}

export function useChat(activeSessionId: string | null): UseChat {
  const chatService = useChatService()
  const { activities, applyActiveRun, getSessionRunStartedAt, getSessionStatus, setActivity, setStatus, statuses } =
    useChatRunState()
  const [messagesMap, setMessagesMap] = React.useState<MessagesMap>({})
  const [pendingQuestionsMap, setPendingQuestionsMap] = React.useState<PendingQuestionsMap>({})
  const [pendingPermissionsMap, setPendingPermissionsMap] = React.useState<PendingPermissionsMap>({})
  const [permissionModes, setPermissionModes] = React.useState<Record<string, AgentPermissionMode>>({})
  const [globalError, setGlobalError] = React.useState<string | null>(null)
  const [errorsBySession, setErrorsBySession] = React.useState<Record<string, string | undefined>>({})
  const userStoppedSessions = React.useRef(new Map<string, number>())
  const cancelledToolParts = React.useRef<CancelledToolPartsMap>(new Map())
  const pendingQuestionsMutationVersions = React.useRef(new Map<string, number>())
  const pendingPermissionsMutationVersions = React.useRef(new Map<string, number>())
  const activeRunMutationVersions = React.useRef(new Map<string, number>())
  const messagesMutationVersions = React.useRef(new Map<string, number>())
  const pendingQuestionsMapRef = React.useRef(pendingQuestionsMap)
  const pendingPermissionsMapRef = React.useRef(pendingPermissionsMap)
  const permissionModesRef = React.useRef(permissionModes)
  const permissionModeVersionsRef = React.useRef<Record<string, number>>({})
  const questionDraftSnapshots = React.useRef(new Map<string, ReturnType<QuestionDraftStore["read"]>>())
  const answeredQuestionIds = React.useRef(new Map<string, Set<string>>())
  const {
    delayToolFlushForText: delayPendingToolFlushForText,
    enqueueTextDelta,
    enqueueToolCallResult,
    enqueueToolCallStarted,
    flushTextDeltas: flushPendingTextDeltas,
    flushToolParts: flushPendingToolParts,
    forgetToolPart: forgetPendingToolPart,
  } = useChatEventBuffer(setMessagesMap, messagesMutationVersions)

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

  const patch = React.useCallback((sessionId: string, updater: (msgs: ChatMessage[]) => ChatMessage[]) => {
    messagesMutationVersions.current.set(sessionId, (messagesMutationVersions.current.get(sessionId) ?? 0) + 1)
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

  const markActiveRunMutated = React.useCallback((sessionId: string): void => {
    activeRunMutationVersions.current.set(sessionId, (activeRunMutationVersions.current.get(sessionId) ?? 0) + 1)
  }, [])

  const markPendingQuestionsMutated = React.useCallback((sessionId: string) => {
    pendingQuestionsMutationVersions.current.set(
      sessionId,
      (pendingQuestionsMutationVersions.current.get(sessionId) ?? 0) + 1,
    )
  }, [])

  const removePendingQuestion = React.useCallback(
    (sessionId: string, requestId: string) => {
      markPendingQuestionsMutated(sessionId)
      answeredQuestionIds.current.get(sessionId)?.delete(requestId)
      questionDraftSnapshots.current.delete(questionDraftKey(sessionId, requestId))
      updatePendingQuestionsMap((current) => ({
        ...current,
        [sessionId]: (current[sessionId] ?? []).filter((request) => request.id !== requestId),
      }))
    },
    [markPendingQuestionsMutated, updatePendingQuestionsMap],
  )

  const markPendingQuestionAnswered = React.useCallback((sessionId: string, requestId: string) => {
    if (!(pendingQuestionsMapRef.current[sessionId] ?? []).some((request) => request.id === requestId)) {
      return
    }
    const ids = answeredQuestionIds.current.get(sessionId) ?? new Set<string>()
    ids.add(requestId)
    answeredQuestionIds.current.set(sessionId, ids)
  }, [])

  const removeAnsweredPendingQuestions = React.useCallback(
    (sessionId: string) => {
      const ids = answeredQuestionIds.current.get(sessionId)
      if (!ids?.size) {
        return
      }
      markPendingQuestionsMutated(sessionId)
      updatePendingQuestionsMap((current) => {
        const questions = current[sessionId] ?? []
        const nextQuestions = questions.filter((request) => !ids.has(request.id))
        if (nextQuestions.length === questions.length) {
          return current
        }
        for (const request of questions) {
          if (ids.has(request.id)) {
            questionDraftSnapshots.current.delete(questionDraftKey(sessionId, request.id))
          }
        }
        return { ...current, [sessionId]: nextQuestions }
      })
      ids.clear()
    },
    [markPendingQuestionsMutated, updatePendingQuestionsMap],
  )

  const clearPendingQuestions = React.useCallback(
    (sessionId: string) => {
      markPendingQuestionsMutated(sessionId)
      answeredQuestionIds.current.delete(sessionId)
      for (const request of pendingQuestionsMapRef.current[sessionId] ?? []) {
        questionDraftSnapshots.current.delete(questionDraftKey(sessionId, request.id))
      }
      updatePendingQuestionsMap((current) => {
        if (!current[sessionId]?.length) {
          return current
        }
        return { ...current, [sessionId]: [] }
      })
    },
    [markPendingQuestionsMutated, updatePendingQuestionsMap],
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

  const clearPendingPermissions = React.useCallback(
    (sessionId: string) => {
      markPendingPermissionsMutated(sessionId)
      updatePendingPermissionsMap((current) => {
        if (!current[sessionId]?.length) {
          return current
        }
        return { ...current, [sessionId]: [] }
      })
    },
    [markPendingPermissionsMutated, updatePendingPermissionsMap],
  )

  const replyPermissionRequest = React.useCallback(
    async (sessionId: string, requestId: string, reply: ChatPermissionReply): Promise<void> => {
      await chatService.invoke("answerPermission", { sessionId, requestId, reply })
      removePendingPermission(sessionId, requestId)
    },
    [chatService, removePendingPermission],
  )

  const setLocalPermissionMode = React.useCallback((sessionId: string, mode: AgentPermissionMode): number => {
    const version = (permissionModeVersionsRef.current[sessionId] ?? 0) + 1
    permissionModeVersionsRef.current = { ...permissionModeVersionsRef.current, [sessionId]: version }
    setPermissionModes((current) => (current[sessionId] === mode ? current : { ...current, [sessionId]: mode }))
    permissionModesRef.current = { ...permissionModesRef.current, [sessionId]: mode }
    return version
  }, [])

  const setPermissionMode = React.useCallback(
    (sessionId: string, mode: AgentPermissionMode): number => {
      const version = setLocalPermissionMode(sessionId, mode)
      void chatService
        .invoke("setPermissionMode", { sessionId, permissionMode: mode, version })
        .catch((err: unknown) => {
          console.error("[wanta] set chat permission mode failed", err)
          reportRendererHandledError("chat", "setPermissionMode invoke failed", err)
        })
      return version
    },
    [chatService, setLocalPermissionMode],
  )

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

  const applyFetchedMessages = React.useCallback(
    (sessionId: string, msgs: ChatMessage[]): void => {
      setMessagesMap((prev) => {
        const previousMessages = prev[sessionId] ?? []
        const merged = applyCancelledToolParts(
          mergeFetchedMessages(previousMessages, msgs),
          cancelledToolParts.current.get(sessionId),
        )
        const nextMessages = (() => {
          if (!isSessionUserStopped(sessionId)) {
            return merged
          }
          const { messages, partIds } = markLatestAssistantToolsCancelled(merged)
          rememberCancelledToolParts(sessionId, partIds)
          return messages
        })()
        return nextMessages === previousMessages ? prev : { ...prev, [sessionId]: nextMessages }
      })
    },
    [isSessionUserStopped, rememberCancelledToolParts],
  )

  const applyFetchedPendingQuestions = React.useCallback(
    (sessionId: string, questions: ChatQuestionRequest[]): void => {
      const fetchedIds = new Set(questions.map((request) => request.id))
      for (const request of pendingQuestionsMapRef.current[sessionId] ?? []) {
        if (!fetchedIds.has(request.id)) {
          questionDraftSnapshots.current.delete(questionDraftKey(sessionId, request.id))
        }
      }
      updatePendingQuestionsMap((prev) => ({
        ...prev,
        [sessionId]: questions,
      }))
    },
    [updatePendingQuestionsMap],
  )

  const applyFetchedPendingPermissions = React.useCallback(
    (sessionId: string, permissions: ChatPermissionRequest[]): void => {
      updatePendingPermissionsMap((prev) => ({
        ...prev,
        [sessionId]: permissions,
      }))
    },
    [updatePendingPermissionsMap],
  )

  const reload = React.useCallback(
    async (sessionId: string): Promise<ChatMessage[] | null> => {
      flushPendingToolParts()
      const messagesMutationVersion = messagesMutationVersions.current.get(sessionId) ?? 0
      try {
        const msgs = await chatService.invoke("getMessages", sessionId)
        if ((messagesMutationVersions.current.get(sessionId) ?? 0) === messagesMutationVersion) {
          applyFetchedMessages(sessionId, msgs)
        }
        return msgs
      } catch (err) {
        console.error("[wanta] getMessages failed", err)
        reportRendererHandledError("chat", "getMessages failed", err)
        return null
      }
    },
    [applyFetchedMessages, chatService, flushPendingToolParts],
  )

  const applySessionSnapshot = React.useCallback(
    (
      snapshot: ChatSessionSnapshot,
      versions: {
        activeRunMutationVersion: number
        messagesMutationVersion: number
        pendingPermissionsMutationVersion: number
        pendingQuestionsMutationVersion: number
      },
    ): void => {
      const sessionId = snapshot.sessionId
      if ((messagesMutationVersions.current.get(sessionId) ?? 0) === versions.messagesMutationVersion) {
        applyFetchedMessages(sessionId, snapshot.messages)
      }
      if ((pendingQuestionsMutationVersions.current.get(sessionId) ?? 0) === versions.pendingQuestionsMutationVersion) {
        applyFetchedPendingQuestions(sessionId, snapshot.pendingQuestions)
      }
      if (
        (pendingPermissionsMutationVersions.current.get(sessionId) ?? 0) === versions.pendingPermissionsMutationVersion
      ) {
        applyFetchedPendingPermissions(sessionId, snapshot.pendingPermissions)
      }
      if ((activeRunMutationVersions.current.get(sessionId) ?? 0) === versions.activeRunMutationVersion) {
        applyActiveRun(sessionId, snapshot.activeRun)
      }
    },
    [applyActiveRun, applyFetchedMessages, applyFetchedPendingPermissions, applyFetchedPendingQuestions],
  )

  React.useEffect(() => {
    const offs = [
      chatService.serverEvents.on("activeRunUpdated", (e) => {
        markActiveRunMutated(e.sessionId)
        applyActiveRun(e.sessionId, e.run, e.endedRunId)
      }),
      chatService.serverEvents.on("messageStarted", (e) => {
        removeAnsweredPendingQuestions(e.sessionId)
        patch(e.sessionId, (msgs) => setMessageInfo(msgs, e))
        if (e.role === "assistant") {
          setStatus(e.sessionId, "streaming")
          setActivity(e.sessionId, { sessionId: e.sessionId, messageId: e.messageId, phase: "thinking" })
        }
      }),
      chatService.serverEvents.on("messageDelta", (e) => {
        removeAnsweredPendingQuestions(e.sessionId)
        setStatus(e.sessionId, "streaming")
        if (hasVisibleMessageDelta(e)) {
          setActivity(e.sessionId, undefined)
        }
        enqueueTextDelta("text", e)
        delayPendingToolFlushForText(e)
      }),
      chatService.serverEvents.on("messageReasoningDelta", (e) => {
        removeAnsweredPendingQuestions(e.sessionId)
        setStatus(e.sessionId, "streaming")
        setActivity(e.sessionId, { sessionId: e.sessionId, messageId: e.messageId, phase: "thinking" })
        enqueueTextDelta("reasoning", e)
      }),
      chatService.serverEvents.on("messageAttachment", (e) => {
        removeAnsweredPendingQuestions(e.sessionId)
        flushPendingTextDeltas()
        patch(e.sessionId, (msgs) => setAttachmentPart(msgs, e))
      }),
      chatService.serverEvents.on("toolCallStarted", (e) => {
        removeAnsweredPendingQuestions(e.sessionId)
        setStatus(e.sessionId, "streaming")
        setActivity(e.sessionId, undefined)
        enqueueToolCallStarted(e)
      }),
      chatService.serverEvents.on("toolCallResult", (e) => {
        removeAnsweredPendingQuestions(e.sessionId)
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
        updatePendingQuestionsMap((current) => {
          const questions = current[e.sessionId] ?? []
          const answeredIds = answeredQuestionIds.current.get(e.sessionId)
          const next = [
            e.request,
            ...questions.filter((request) => request.id !== e.request.id && !answeredIds?.has(request.id)),
          ]
          if (answeredIds?.size) {
            for (const request of questions) {
              if (answeredIds.has(request.id)) {
                questionDraftSnapshots.current.delete(questionDraftKey(e.sessionId, request.id))
              }
            }
            answeredIds.clear()
          }
          return { ...current, [e.sessionId]: next }
        })
      }),
      chatService.serverEvents.on("questionReplied", (e) => {
        const request = (pendingQuestionsMapRef.current[e.sessionId] ?? []).find((item) => item.id === e.requestId)
        markQuestionRequestAnswered(e.sessionId, request, e.answers)
        markPendingQuestionAnswered(e.sessionId, e.requestId)
      }),
      chatService.serverEvents.on("questionRejected", (e) => {
        const request = (pendingQuestionsMapRef.current[e.sessionId] ?? []).find((item) => item.id === e.requestId)
        markQuestionRequestsCancelled(e.sessionId, request ? [request] : [])
        removePendingQuestion(e.sessionId, e.requestId)
      }),
      chatService.serverEvents.on("permissionAsked", (e) => {
        flushPendingToolParts()
        setStatus(e.sessionId, "streaming")
        setActivity(e.sessionId, undefined)
        markPendingPermissionsMutated(e.sessionId)
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
        const { finishReason, messageId } = e
        if (messageId && finishReason) {
          patch(e.sessionId, (msgs) => setMessageFinishReason(msgs, messageId, finishReason))
        }
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
        removeAnsweredPendingQuestions(e.sessionId)
        flushPendingToolParts()
        setStatus(e.sessionId, "ready")
        setActivity(e.sessionId, undefined)
        void reload(e.sessionId)
      }),
      chatService.serverEvents.on("messageError", (e) => {
        removeAnsweredPendingQuestions(e.sessionId)
        flushPendingToolParts()
        setStatus(e.sessionId, "error")
        setActivity(e.sessionId, undefined)
        clearSessionError(e.sessionId)
        patch(e.sessionId, (msgs) => setErrorPart(msgs, e))
      }),
      chatService.serverEvents.on("generationInterrupted", (e) => {
        flushPendingToolParts()
        setStatus(e.sessionId, "error")
        setActivity(e.sessionId, undefined)
        clearSessionError(e.sessionId)
        patch(e.sessionId, (msgs) => markAssistantMessageToolsInterrupted(msgs, e))
        clearPendingQuestions(e.sessionId)
        clearPendingPermissions(e.sessionId)
      }),
      chatService.serverEvents.on("generationNotice", (e) => {
        flushPendingToolParts()
        setStatus(e.sessionId, "streaming")
        setActivity(e.sessionId, undefined)
        patch(e.sessionId, (msgs) => setGenerationNoticePart(msgs, e))
      }),
      chatService.serverEvents.on("generationStopped", (e) => {
        flushPendingToolParts()
        setStatus(e.sessionId, "ready")
        setActivity(e.sessionId, undefined)
        clearSessionError(e.sessionId)
        markCurrentToolsCancelled(e.sessionId, e)
        clearPendingQuestions(e.sessionId)
        clearPendingPermissions(e.sessionId)
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
    applyActiveRun,
    chatService,
    clearPendingPermissions,
    clearSessionError,
    clearPendingQuestions,
    delayPendingToolFlushForText,
    enqueueToolCallResult,
    enqueueToolCallStarted,
    enqueueTextDelta,
    flushPendingToolParts,
    flushPendingTextDeltas,
    forgetPendingToolPart,
    isSessionUserStopped,
    markCurrentToolsCancelled,
    markActiveRunMutated,
    markPendingPermissionsMutated,
    markPendingQuestionsMutated,
    markPendingQuestionAnswered,
    markQuestionRequestAnswered,
    markQuestionRequestsCancelled,
    patch,
    reload,
    rememberCancelledToolParts,
    removeAnsweredPendingQuestions,
    removePendingPermission,
    removePendingQuestion,
    setActivity,
    setSessionError,
    setStatus,
    updatePendingPermissionsMap,
    updatePendingQuestionsMap,
  ])

  React.useEffect(() => {
    let cancelled = false
    const activeRunVersionsAtRequest = new Map(activeRunMutationVersions.current)
    void chatService
      .invoke("getActiveRuns")
      .then((runs) => {
        if (cancelled) {
          return
        }
        for (const run of runs) {
          if (
            (activeRunMutationVersions.current.get(run.sessionId) ?? 0) ===
            (activeRunVersionsAtRequest.get(run.sessionId) ?? 0)
          ) {
            applyActiveRun(run.sessionId, run)
          }
        }
      })
      .catch((err: unknown) => {
        console.error("[wanta] getActiveRuns failed", err)
        reportRendererHandledError("chat", "getActiveRuns failed", err)
      })
    return () => {
      cancelled = true
    }
  }, [applyActiveRun, chatService])

  React.useEffect(() => {
    if (activeSessionId) {
      let cancelled = false
      const activeRunMutationVersion = activeRunMutationVersions.current.get(activeSessionId) ?? 0
      const messagesMutationVersion = messagesMutationVersions.current.get(activeSessionId) ?? 0
      const pendingQuestionsMutationVersion = pendingQuestionsMutationVersions.current.get(activeSessionId) ?? 0
      const pendingPermissionsMutationVersion = pendingPermissionsMutationVersions.current.get(activeSessionId) ?? 0
      void chatService
        .invoke("getSessionSnapshot", activeSessionId)
        .then((snapshot) => {
          if (cancelled || snapshot.sessionId !== activeSessionId) {
            return
          }
          applySessionSnapshot(snapshot, {
            activeRunMutationVersion,
            messagesMutationVersion,
            pendingPermissionsMutationVersion,
            pendingQuestionsMutationVersion,
          })
        })
        .catch((err: unknown) => {
          console.error("[wanta] getSessionSnapshot failed", err)
          reportRendererHandledError("chat", "getSessionSnapshot failed", err)
        })
      return () => {
        cancelled = true
      }
    }
  }, [activeSessionId, applySessionSnapshot, chatService])

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
      if (!options.sessionScope) {
        throw new Error("Organization scope is required")
      }
      setGlobalError(null)
      clearSessionError(sessionId)
      userStoppedSessions.current.delete(sessionId)
      cancelledToolParts.current.delete(sessionId)
      const selectedPermissionMode = options.permissionMode ?? sessionPermissionMode(sessionId)
      const permissionModeVersion = setLocalPermissionMode(sessionId, selectedPermissionMode)
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
          permissionMode: selectedPermissionMode,
          permissionModeVersion,
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
    [chatService, clearSessionError, patch, sessionPermissionMode, setActivity, setLocalPermissionMode, setStatus],
  )

  const stop = React.useCallback(
    async (sessionId: string) => {
      setGlobalError(null)
      clearSessionError(sessionId)
      markSessionUserStopped(sessionId)
      markCurrentToolsCancelled(sessionId)
      clearPendingQuestions(sessionId)
      clearPendingPermissions(sessionId)
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
      clearPendingPermissions,
      clearSessionError,
      clearPendingQuestions,
      markCurrentToolsCancelled,
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
        markPendingQuestionAnswered(sessionId, requestId)
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
      markPendingQuestionAnswered,
      markQuestionRequestAnswered,
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
        await replyPermissionRequest(sessionId, requestId, reply)
      } catch (err) {
        reportRendererHandledError("chat", "answerPermission invoke failed", err)
        setStatus(sessionId, "error")
        setActivity(sessionId, undefined)
        setSessionError(sessionId, err instanceof Error ? err.message : String(err))
        throw err
      }
    },
    [clearSessionError, replyPermissionRequest, setActivity, setSessionError, setStatus],
  )

  const rejectQuestion = React.useCallback(
    async (sessionId: string, requestId: string) => {
      setGlobalError(null)
      clearSessionError(sessionId)
      const request = (pendingQuestionsMapRef.current[sessionId] ?? []).find((item) => item.id === requestId)
      setStatus(sessionId, "streaming")
      setActivity(sessionId, { sessionId, phase: "thinking" })
      try {
        await chatService.invoke("rejectQuestion", { sessionId, requestId })
        removePendingQuestion(sessionId, requestId)
        markQuestionRequestsCancelled(sessionId, request ? [request] : [])
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
      markQuestionRequestsCancelled,
      removePendingQuestion,
      setActivity,
      setSessionError,
      setStatus,
    ],
  )

  const messages = activeSessionId ? (messagesMap[activeSessionId] ?? []) : []
  const permissionMode = activeSessionId ? (permissionModes[activeSessionId] ?? "default") : "default"
  const pendingPermissions = activeSessionId ? (pendingPermissionsMap[activeSessionId] ?? []) : []
  const pendingQuestions = activeSessionId ? (pendingQuestionsMap[activeSessionId] ?? []) : []
  const status = activeSessionId ? (statuses[activeSessionId] ?? "ready") : "ready"
  const activity = activeSessionId ? (activities[activeSessionId] ?? null) : null
  const messagesLoaded = activeSessionId ? Object.hasOwn(messagesMap, activeSessionId) : true
  const questionDrafts = React.useMemo<QuestionDraftStore>(
    () => ({
      read: (sessionId, request, expectedDraftCount) => {
        const snapshot = questionDraftSnapshots.current.get(questionDraftKey(sessionId, request.id))
        return snapshot && snapshot.drafts.length === expectedDraftCount ? snapshot : null
      },
      remove: (sessionId, request) => {
        questionDraftSnapshots.current.delete(questionDraftKey(sessionId, request.id))
      },
      write: (sessionId, request, snapshot) => {
        questionDraftSnapshots.current.set(questionDraftKey(sessionId, request.id), snapshot)
      },
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
    getSessionRunStartedAt,
    send,
    stop,
    answerQuestion,
    answerPermission,
    rejectQuestion,
    questionDrafts,
    permissionMode,
    setPermissionMode,
  }
}
