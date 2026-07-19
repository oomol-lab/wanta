import type {
  AgentMode,
  AgentPermissionMode,
  ChatAttachment,
  ChatContextMention,
  ChatOrganizationSkillContext,
  ChatProjectContext,
  ReasoningLevel,
} from "../../../electron/chat/common.ts"
import type { ModelChoice } from "../../../electron/models/common.ts"
import type { SessionScope } from "../../../electron/session/common.ts"
import type { AppShellRoute as Route } from "./app-shell-types.ts"
import type { PendingChatTransition } from "./pending-chat.ts"
import type { QueueSessionMessage } from "./use-chat-queue-state.ts"
import type { UseChat } from "@/hooks/useChat"
import type { ConnectionAuthIntent } from "@/routes/Connections/connection-route-model.ts"

import * as React from "react"
import { sessionScopeKey } from "./app-shell-model.ts"
import { connectionRetryTargetMatches, discardConnectionRetriesForSession } from "./connection-retry-model.ts"
import { reportRendererHandledError } from "@/lib/renderer-diagnostics"

export interface ChatConnectionDrawerState {
  authIntent: ConnectionAuthIntent | null
  open: boolean
  selectedService: string | null
}

export interface ChatConnectionRetryInput {
  attachments: ChatAttachment[]
  connectionName?: string
  contextMentions?: ChatContextMention[]
  drawerKey: string
  mode?: AgentMode
  model?: ModelChoice
  organizationSkills?: ChatOrganizationSkillContext[]
  permissionMode?: AgentPermissionMode
  projectContext?: ChatProjectContext
  reasoningLevel?: ReasoningLevel
  service: string
  sessionId: string
  sessionScope: SessionScope
  text: string
}

type SetChatConnectionDrawers = React.Dispatch<React.SetStateAction<Record<string, ChatConnectionDrawerState>>>

type PendingChatConnectionRetry = ChatConnectionRetryInput

interface UseChatConnectionRetryOptions {
  isSessionAvailable: (sessionId: string, scope: SessionScope) => boolean
  isSessionRunning: (sessionId: string) => boolean
  queueSessionMessage: QueueSessionMessage
  send: UseChat["send"]
  sessionScope: SessionScope | null
  setChatConnectionDrawers: SetChatConnectionDrawers
  setIsDraftSession: React.Dispatch<React.SetStateAction<boolean>>
  setPendingChatTransition: React.Dispatch<React.SetStateAction<PendingChatTransition | null>>
  setRoute: React.Dispatch<React.SetStateAction<Route>>
  setSelectedSessionId: React.Dispatch<React.SetStateAction<string | null>>
}

export function useChatConnectionRetry({
  isSessionAvailable,
  isSessionRunning,
  queueSessionMessage,
  send,
  sessionScope,
  setChatConnectionDrawers,
  setIsDraftSession,
  setPendingChatTransition,
  setRoute,
  setSelectedSessionId,
}: UseChatConnectionRetryOptions) {
  const pendingRetries = React.useRef(new Map<string, PendingChatConnectionRetry>())

  const cancelRetryForDrawer = React.useCallback((drawerKey: string): void => {
    pendingRetries.current.delete(drawerKey)
  }, [])

  const clearRetries = React.useCallback((): void => {
    pendingRetries.current.clear()
  }, [])

  const prepareRetry = React.useCallback((input: ChatConnectionRetryInput): void => {
    pendingRetries.current.set(input.drawerKey, input)
  }, [])

  const forgetSession = React.useCallback(
    (sessionId: string): void => {
      const discardedDrawerKeys = discardConnectionRetriesForSession(pendingRetries.current, sessionId)
      if (discardedDrawerKeys.length === 0) {
        return
      }
      const discarded = new Set(discardedDrawerKeys)
      setChatConnectionDrawers((current) => {
        const next = { ...current }
        let changed = false
        for (const drawerKey of discarded) {
          if (Object.hasOwn(next, drawerKey)) {
            delete next[drawerKey]
            changed = true
          }
        }
        return changed ? next : current
      })
    },
    [setChatConnectionDrawers],
  )

  // 只有连接动作确实成功后才重试，避免已有的同 provider 账号让授权抽屉刚打开就误触发。
  const completeRetryForDrawer = React.useCallback(
    (drawerKey: string, target: { service: string; connectionName?: string }): void => {
      const pending = pendingRetries.current.get(drawerKey)
      if (!pending || !connectionRetryTargetMatches(pending, target)) {
        return
      }
      if (sessionScopeKey(sessionScope) !== sessionScopeKey(pending.sessionScope)) {
        return
      }
      if (!isSessionAvailable(pending.sessionId, pending.sessionScope)) {
        forgetSession(pending.sessionId)
        return
      }

      pendingRetries.current.delete(drawerKey)
      setChatConnectionDrawers((current) => {
        if (!Object.hasOwn(current, drawerKey)) {
          return current
        }
        const next = { ...current }
        delete next[drawerKey]
        return next
      })
      setRoute("chat")
      setSelectedSessionId(pending.sessionId)
      setIsDraftSession(false)
      setPendingChatTransition(null)

      if (isSessionRunning(pending.sessionId)) {
        queueSessionMessage(
          pending.sessionId,
          pending.text,
          pending.attachments,
          pending.contextMentions ?? [],
          pending.model,
          pending.reasoningLevel,
          pending.mode,
          pending.permissionMode,
          pending.organizationSkills ?? [],
          pending.projectContext,
          pending.sessionScope,
        )
        return
      }

      void send(pending.sessionId, pending.text, pending.attachments, {
        contextMentions: pending.contextMentions ?? [],
        organizationSkills: pending.organizationSkills ?? [],
        projectContext: pending.projectContext,
        model: pending.model,
        reasoningLevel: pending.reasoningLevel,
        sessionScope: pending.sessionScope,
        mode: pending.mode,
        permissionMode: pending.permissionMode,
      }).catch((error: unknown) => {
        reportRendererHandledError("connections.authRetry", "Failed to retry authorized chat turn", error)
      })
    },
    [
      isSessionRunning,
      isSessionAvailable,
      forgetSession,
      queueSessionMessage,
      send,
      sessionScope,
      setChatConnectionDrawers,
      setIsDraftSession,
      setPendingChatTransition,
      setRoute,
      setSelectedSessionId,
    ],
  )

  const completeMatchingRetries = React.useCallback(
    (target: { service: string; connectionName?: string }): void => {
      for (const drawerKey of pendingRetries.current.keys()) {
        completeRetryForDrawer(drawerKey, target)
      }
    },
    [completeRetryForDrawer],
  )

  return {
    cancelRetryForDrawer,
    clearRetries,
    completeMatchingRetries,
    completeRetryForDrawer,
    forgetSession,
    prepareRetry,
  }
}
