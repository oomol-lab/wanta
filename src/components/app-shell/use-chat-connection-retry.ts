import type {
  AgentMode,
  AgentPermissionMode,
  ChatAttachment,
  ChatContextMention,
  ChatOrganizationSkillContext,
  ChatProjectContext,
  ReasoningLevel,
} from "../../../electron/chat/common.ts"
import type { ConnectionProviderSummary } from "../../../electron/connections/common.ts"
import type { ModelChoice } from "../../../electron/models/common.ts"
import type { SessionScope } from "../../../electron/session/common.ts"
import type { ConnectionAuthIntent } from "./app-shell-connection-drawer-model.ts"
import type { AppShellRoute as Route } from "./app-shell-types.ts"
import type { PendingChatTransition } from "./pending-chat.ts"
import type { QueueSessionMessage } from "./use-chat-queue-state.ts"
import type { UseChat } from "@/hooks/useChat"
import type { UseConnections } from "@/hooks/useConnections"

import * as React from "react"
import { isConnectionlessNoAuthProvider } from "../../../electron/connections/summary.ts"
import { AUTH_RETRY_POLL_INTERVAL_MS, AUTH_RETRY_POLL_TIMEOUT_MS, sessionScopeKey } from "./app-shell-model.ts"
import { reportRendererHandledError } from "@/lib/renderer-diagnostics"

export interface ChatConnectionDrawerState {
  authIntent: ConnectionAuthIntent | null
  open: boolean
  selectedService: string | null
}

export interface ChatConnectionRetryInput {
  attachments: ChatAttachment[]
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

interface ChatConnectionRetryWatch {
  drawerKey: string
  service: string
  sessionId: string
  startedAt: number
}

interface PendingChatConnectionRetry extends ChatConnectionRetryInput {
  startedAt: number
}

interface UseChatConnectionRetryOptions {
  connections: Pick<UseConnections, "isProviderActive" | "refresh" | "summary">
  isSessionRunning: (sessionId: string) => boolean
  queueSessionMessage: QueueSessionMessage
  send: UseChat["send"]
  sessionScope: SessionScope | null
  setActiveSessionId: React.Dispatch<React.SetStateAction<string | null>>
  setChatConnectionDrawers: SetChatConnectionDrawers
  setIsDraftSession: React.Dispatch<React.SetStateAction<boolean>>
  setPendingChatTransition: React.Dispatch<React.SetStateAction<PendingChatTransition | null>>
  setRoute: React.Dispatch<React.SetStateAction<Route>>
}

function providerIsRetryReady(provider: ConnectionProviderSummary, service: string): boolean {
  return (
    provider.service === service &&
    provider.status === "connected" &&
    (provider.appStatus === "active" || isConnectionlessNoAuthProvider(provider))
  )
}

export function useChatConnectionRetry({
  connections,
  isSessionRunning,
  queueSessionMessage,
  send,
  sessionScope,
  setActiveSessionId,
  setChatConnectionDrawers,
  setIsDraftSession,
  setPendingChatTransition,
  setRoute,
}: UseChatConnectionRetryOptions) {
  const { isProviderActive, refresh, summary } = connections
  const pendingRetry = React.useRef<PendingChatConnectionRetry | null>(null)
  const [retryWatch, setRetryWatch] = React.useState<ChatConnectionRetryWatch | null>(null)

  const cancelRetryForDrawer = React.useCallback((drawerKey: string): void => {
    if (pendingRetry.current?.drawerKey === drawerKey) {
      pendingRetry.current = null
    }
    setRetryWatch((current) => (current?.drawerKey === drawerKey ? null : current))
  }, [])

  const clearRetries = React.useCallback((): void => {
    pendingRetry.current = null
    setRetryWatch(null)
  }, [])

  const prepareRetry = React.useCallback(
    (input: ChatConnectionRetryInput): void => {
      const startedAt = Date.now()
      pendingRetry.current = { ...input, startedAt }
      setRetryWatch({
        drawerKey: input.drawerKey,
        service: input.service,
        sessionId: input.sessionId,
        startedAt,
      })
      void refresh({ forceRefresh: true }, { silent: true })
    },
    [refresh],
  )

  // 聊天触发的授权闭环：等待 provider 连上后刷新连接摘要，再回到原 session 重试。
  React.useEffect(() => {
    if (!retryWatch) {
      return
    }

    let cancelled = false
    const refreshUntilConnected = async (): Promise<void> => {
      if (cancelled) {
        return
      }
      if (Date.now() - retryWatch.startedAt >= AUTH_RETRY_POLL_TIMEOUT_MS) {
        if (
          pendingRetry.current?.sessionId === retryWatch.sessionId &&
          pendingRetry.current.service === retryWatch.service
        ) {
          pendingRetry.current = null
        }
        setChatConnectionDrawers((current) => {
          if (!Object.hasOwn(current, retryWatch.drawerKey)) {
            return current
          }
          const next = { ...current }
          delete next[retryWatch.drawerKey]
          return next
        })
        setRetryWatch(null)
        return
      }

      try {
        const connected = await isProviderActive(retryWatch.service)
        if (!cancelled && connected) {
          await refresh({ forceRefresh: true }, { silent: true })
        }
      } catch (error) {
        if (!cancelled) {
          reportRendererHandledError("connections.authRetry", "Failed to check provider connection state", error)
        }
      }
    }

    void refreshUntilConnected()
    const id = window.setInterval(() => {
      void refreshUntilConnected()
    }, AUTH_RETRY_POLL_INTERVAL_MS)
    return () => {
      cancelled = true
      window.clearInterval(id)
    }
  }, [isProviderActive, refresh, retryWatch, setChatConnectionDrawers])

  React.useEffect(() => {
    const pending = pendingRetry.current
    if (!pending) {
      return
    }
    if (sessionScopeKey(sessionScope) !== sessionScopeKey(pending.sessionScope)) {
      return
    }
    if (!summary?.providers.some((provider) => providerIsRetryReady(provider, pending.service))) {
      return
    }

    pendingRetry.current = null
    setRetryWatch(null)
    setChatConnectionDrawers((current) => {
      if (!Object.hasOwn(current, pending.drawerKey)) {
        return current
      }
      const next = { ...current }
      delete next[pending.drawerKey]
      return next
    })
    setRoute("chat")
    setActiveSessionId(pending.sessionId)
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
  }, [
    isSessionRunning,
    queueSessionMessage,
    send,
    sessionScope,
    setActiveSessionId,
    setChatConnectionDrawers,
    setIsDraftSession,
    setPendingChatTransition,
    setRoute,
    summary,
  ])

  return { cancelRetryForDrawer, clearRetries, prepareRetry }
}
