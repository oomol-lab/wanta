import type {
  AgentMode,
  AgentPermissionMode,
  ChatAttachment,
  ChatContextMention,
  ChatTeamSkillContext,
  ChatProjectContext,
  ReasoningLevel,
} from "../../../electron/chat/common.ts"
import type { ModelChoice } from "../../../electron/models/common.ts"
import type { SessionScope } from "../../../electron/session/common.ts"
import type { ChatSendRequest, ChatSendResult } from "./app-shell-model.ts"
import type { ChatQueueMap, QueuedMessageMovePlacement } from "./chat-queue.ts"
import type { ChatStatus } from "ai"

import * as React from "react"
import { createQueuedChatMessage } from "./app-shell-model.ts"
import {
  appendQueuedMessage,
  clearQueuedMessages,
  moveQueuedMessage,
  removeQueuedMessage,
  settleQueuedMessageAfterDispatchFailure,
  shouldDispatchQueuedMessage,
} from "./chat-queue.ts"
import { reportRendererHandledError } from "@/lib/renderer-diagnostics"
import { releaseAttachmentSnapshots } from "@/routes/Chat/chat-attachment-utils"

type SendQueuedMessage = (request: ChatSendRequest & { afterOptimisticSubmit?: () => void }) => Promise<ChatSendResult>

export type QueueSessionMessage = (
  sessionId: string,
  text: string,
  attachments: ChatAttachment[],
  contextMentions: ChatContextMention[] | undefined,
  model?: ModelChoice,
  reasoningLevel?: ReasoningLevel,
  mode?: AgentMode,
  permissionMode?: AgentPermissionMode,
  teamSkills?: ChatTeamSkillContext[],
  projectContext?: ChatProjectContext,
  sessionScope?: SessionScope,
) => void

interface UseChatQueueStateOptions {
  activeSessionId: string | null
  dispatchBlocked: boolean
  initialSendPending: boolean
  isSendInFlight: () => boolean
  sendQueuedMessage: SendQueuedMessage
  status: ChatStatus
}

export function useChatQueueState({
  activeSessionId,
  dispatchBlocked,
  initialSendPending,
  isSendInFlight,
  sendQueuedMessage,
  status,
}: UseChatQueueStateOptions) {
  const [queuedMessagesBySession, setQueuedMessagesBySession] = React.useState<ChatQueueMap>({})
  const queuedMessagesBySessionRef = React.useRef(queuedMessagesBySession)
  queuedMessagesBySessionRef.current = queuedMessagesBySession
  const updateQueuedMessages = React.useCallback((update: (current: ChatQueueMap) => ChatQueueMap): void => {
    setQueuedMessagesBySession((current) => {
      const next = update(current)
      queuedMessagesBySessionRef.current = next
      return next
    })
  }, [])
  const [heldQueuedSessions, setHeldQueuedSessions] = React.useState<Set<string>>(() => new Set())
  const dispatchingQueuedSessionsRef = React.useRef<Set<string>>(new Set())
  const activeQueuedMessages = activeSessionId ? (queuedMessagesBySession[activeSessionId] ?? []) : []
  const activeQueueHeld = activeSessionId ? heldQueuedSessions.has(activeSessionId) : false

  const queueSessionMessage = React.useCallback(
    (
      sessionId: string,
      text: string,
      attachments: ChatAttachment[],
      contextMentions: ChatContextMention[] | undefined,
      model?: ModelChoice,
      reasoningLevel?: ReasoningLevel,
      mode?: AgentMode,
      permissionMode?: AgentPermissionMode,
      teamSkills?: ChatTeamSkillContext[],
      projectContext?: ChatProjectContext,
      sessionScope?: SessionScope,
    ): void => {
      const queuedMessage = createQueuedChatMessage(
        sessionId,
        text,
        attachments,
        contextMentions,
        model,
        reasoningLevel,
        mode,
        permissionMode,
        teamSkills,
        projectContext,
        sessionScope,
      )
      updateQueuedMessages((current) => appendQueuedMessage(current, queuedMessage))
    },
    [updateQueuedMessages],
  )

  const queueActiveMessage = React.useCallback(
    (
      text: string,
      attachments: ChatAttachment[],
      contextMentions: ChatContextMention[] | undefined,
      model?: ModelChoice,
      reasoningLevel?: ReasoningLevel,
      mode?: AgentMode,
      permissionMode?: AgentPermissionMode,
      teamSkills?: ChatTeamSkillContext[],
      projectContext?: ChatProjectContext,
      sessionScope?: SessionScope,
    ): boolean => {
      if (!activeSessionId) {
        return false
      }
      queueSessionMessage(
        activeSessionId,
        text,
        attachments,
        contextMentions,
        model,
        reasoningLevel,
        mode,
        permissionMode,
        teamSkills,
        projectContext,
        sessionScope,
      )
      return true
    },
    [activeSessionId, queueSessionMessage],
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

  const holdQueuedSessionIfQueued = React.useCallback(
    (sessionId: string): void => {
      if ((queuedMessagesBySession[sessionId] ?? []).length === 0) {
        return
      }
      setHeldQueuedSessions((current) => {
        if (current.has(sessionId)) {
          return current
        }
        const next = new Set(current)
        next.add(sessionId)
        return next
      })
    },
    [queuedMessagesBySession],
  )

  const clearQueuedSession = React.useCallback(
    (sessionId: string): void => {
      const discarded = queuedMessagesBySessionRef.current[sessionId] ?? []
      releaseAttachmentSnapshots(discarded.flatMap((message) => message.attachments))
      updateQueuedMessages((current) => clearQueuedMessages(current, sessionId))
      setHeldQueuedSessions((current) => {
        if (!current.has(sessionId)) {
          return current
        }
        const next = new Set(current)
        next.delete(sessionId)
        return next
      })
    },
    [updateQueuedMessages],
  )

  React.useEffect(
    () => () => {
      const discarded = Object.values(queuedMessagesBySessionRef.current).flat()
      releaseAttachmentSnapshots(discarded.flatMap((message) => message.attachments))
    },
    [],
  )

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
    if (
      !activeSessionId ||
      !shouldDispatchQueuedMessage(status, initialSendPending, activeQueueHeld, dispatchBlocked)
    ) {
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
    let optimisticSubmitted = false
    void sendQueuedMessage({
      afterOptimisticSubmit: () => {
        optimisticSubmitted = true
        // optimistic turn 已进入聊天记录，后续失败由该 turn 的错误恢复处理，不能再塞回队列造成重复发送。
        updateQueuedMessages((current) => removeQueuedMessage(current, activeSessionId, message.id))
      },
      attachments: message.attachments,
      contextMentions: message.contextMentions ?? [],
      mode: message.mode,
      model: message.model,
      teamSkills: message.teamSkills,
      permissionMode: message.permissionMode,
      projectContext: message.projectContext,
      reasoningLevel: message.reasoningLevel,
      sessionScope: message.sessionScope,
      text: message.text,
    })
      .then((result) => {
        if (result.status === "failed") {
          updateQueuedMessages((current) =>
            settleQueuedMessageAfterDispatchFailure(current, message, optimisticSubmitted),
          )
        }
      })
      .catch((cause: unknown) => {
        updateQueuedMessages((current) =>
          settleQueuedMessageAfterDispatchFailure(current, message, optimisticSubmitted),
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
    dispatchBlocked,
    initialSendPending,
    isSendInFlight,
    queuedMessagesBySession,
    sendQueuedMessage,
    status,
    updateQueuedMessages,
  ])

  const handleQueuedMessageRemove = React.useCallback(
    (messageId: string) => {
      if (!activeSessionId) {
        return
      }
      const discarded = (queuedMessagesBySessionRef.current[activeSessionId] ?? []).find(
        (message) => message.id === messageId,
      )
      if (discarded) {
        releaseAttachmentSnapshots(discarded.attachments)
      }
      updateQueuedMessages((current) => removeQueuedMessage(current, activeSessionId, messageId))
    },
    [activeSessionId, updateQueuedMessages],
  )

  const handleQueuedMessageMove = React.useCallback(
    (messageId: string, targetId: string, placement: QueuedMessageMovePlacement) => {
      if (!activeSessionId) {
        return
      }
      updateQueuedMessages((current) => moveQueuedMessage(current, activeSessionId, messageId, targetId, placement))
    },
    [activeSessionId, updateQueuedMessages],
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
    holdQueuedSessionIfQueued,
    queueActiveMessage,
    queueSessionMessage,
    releaseActiveQueue,
  }
}
