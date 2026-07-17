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
  setChatConnectionDrawers: SetChatConnectionDrawers
  setIsDraftSession: React.Dispatch<React.SetStateAction<boolean>>
  setPendingChatTransition: React.Dispatch<React.SetStateAction<PendingChatTransition | null>>
  setRoute: React.Dispatch<React.SetStateAction<Route>>
  setSelectedSessionId: React.Dispatch<React.SetStateAction<string | null>>
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
  setChatConnectionDrawers,
  setIsDraftSession,
  setPendingChatTransition,
  setRoute,
  setSelectedSessionId,
}: UseChatConnectionRetryOptions) {
  const { isProviderActive, refresh, summary } = connections
  const pendingRetries = React.useRef(new Map<string, PendingChatConnectionRetry>())
  const [retryWatches, setRetryWatches] = React.useState<Record<string, ChatConnectionRetryWatch>>({})

  const cancelRetryForDrawer = React.useCallback((drawerKey: string): void => {
    pendingRetries.current.delete(drawerKey)
    setRetryWatches((current) => {
      if (!Object.hasOwn(current, drawerKey)) {
        return current
      }
      const next = { ...current }
      delete next[drawerKey]
      return next
    })
  }, [])

  const clearRetries = React.useCallback((): void => {
    pendingRetries.current.clear()
    setRetryWatches({})
  }, [])

  const prepareRetry = React.useCallback(
    (input: ChatConnectionRetryInput): void => {
      const startedAt = Date.now()
      pendingRetries.current.set(input.drawerKey, { ...input, startedAt })
      setRetryWatches((current) => ({
        ...current,
        [input.drawerKey]: {
          drawerKey: input.drawerKey,
          service: input.service,
          startedAt,
        },
      }))
      void refresh({ forceRefresh: true }, { silent: true })
    },
    [refresh],
  )

  // 聊天触发的授权闭环：等待 provider 连上后刷新连接摘要，再回到原 session 重试。
  React.useEffect(() => {
    const watches = Object.values(retryWatches)
    if (watches.length === 0) {
      return
    }

    let cancelled = false
    let timeoutId: number | undefined
    const expireRetries = (drawerKeys: string[]): void => {
      if (drawerKeys.length === 0) {
        return
      }
      const expired = new Set(drawerKeys)
      for (const drawerKey of expired) {
        pendingRetries.current.delete(drawerKey)
      }
      setChatConnectionDrawers((current) => {
        if (![...expired].some((drawerKey) => Object.hasOwn(current, drawerKey))) {
          return current
        }
        const next = { ...current }
        for (const drawerKey of expired) {
          delete next[drawerKey]
        }
        return next
      })
      setRetryWatches((current) => {
        const next = { ...current }
        for (const drawerKey of expired) {
          delete next[drawerKey]
        }
        return next
      })
    }
    const refreshUntilConnected = async (): Promise<void> => {
      if (cancelled) {
        return
      }
      const now = Date.now()
      const expiredKeys = watches
        .filter((watch) => now - watch.startedAt >= AUTH_RETRY_POLL_TIMEOUT_MS)
        .map((watch) => watch.drawerKey)
      expireRetries(expiredKeys)
      const activeWatches = watches.filter((watch) => !expiredKeys.includes(watch.drawerKey))
      if (activeWatches.length === 0) {
        return
      }

      try {
        const connected = await Promise.all(activeWatches.map((watch) => isProviderActive(watch.service)))
        if (!cancelled && connected.some(Boolean)) {
          await refresh({ forceRefresh: true }, { silent: true })
        }
      } catch (error) {
        if (!cancelled) {
          reportRendererHandledError("connections.authRetry", "Failed to check provider connection state", error)
        }
      } finally {
        if (!cancelled) {
          timeoutId = window.setTimeout(() => {
            void refreshUntilConnected()
          }, AUTH_RETRY_POLL_INTERVAL_MS)
        }
      }
    }

    void refreshUntilConnected()
    return () => {
      cancelled = true
      if (timeoutId !== undefined) {
        window.clearTimeout(timeoutId)
      }
    }
  }, [isProviderActive, refresh, retryWatches, setChatConnectionDrawers])

  React.useEffect(() => {
    const pending = [...pendingRetries.current.values()]
      .filter((candidate) => sessionScopeKey(sessionScope) === sessionScopeKey(candidate.sessionScope))
      .filter((candidate) => summary?.providers.some((provider) => providerIsRetryReady(provider, candidate.service)))
      .sort((left, right) => left.startedAt - right.startedAt)[0]
    if (!pending) {
      return
    }

    pendingRetries.current.delete(pending.drawerKey)
    setRetryWatches((current) => {
      if (!Object.hasOwn(current, pending.drawerKey)) {
        return current
      }
      const next = { ...current }
      delete next[pending.drawerKey]
      return next
    })
    setChatConnectionDrawers((current) => {
      if (!Object.hasOwn(current, pending.drawerKey)) {
        return current
      }
      const next = { ...current }
      delete next[pending.drawerKey]
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
  }, [
    isSessionRunning,
    queueSessionMessage,
    retryWatches,
    send,
    sessionScope,
    setChatConnectionDrawers,
    setIsDraftSession,
    setPendingChatTransition,
    setRoute,
    setSelectedSessionId,
    summary,
  ])

  return { cancelRetryForDrawer, clearRetries, prepareRetry }
}
