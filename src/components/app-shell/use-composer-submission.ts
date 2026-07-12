import type {
  AgentMode,
  AgentPermissionMode,
  ChatContextMention,
  ChatOrganizationSkillContext,
  ChatProjectContext,
  ReasoningLevel,
} from "../../../electron/chat/common.ts"
import type { ModelChoice } from "../../../electron/models/common.ts"
import type { SessionInfo, SessionProject, SessionScope } from "../../../electron/session/common.ts"
import type { ChatSendRequest, ChatSendResult, TurnRetryOptions } from "./app-shell-model.ts"
import type { AppShellRoute } from "./app-shell-types.ts"
import type { PendingChatTransition } from "./pending-chat.ts"
import type { SidebarSegment } from "./sidebar-persistence.ts"
import type { UseSessionTitleGenerationResult } from "./use-session-title-generation.ts"
import type { UseChat } from "@/hooks/useChat"

import * as React from "react"
import { buildFallbackSessionTitle } from "../../../electron/session/title.ts"
import { buildSessionTitleInput, rememberTurnRetryOptions, sessionScopeKey } from "./app-shell-model.ts"
import { chatTurnInputKey } from "@/routes/Chat/chat-turns"

export interface ComposerSubmissionMemory {
  contextMentionsBySession: React.RefObject<Map<string, ChatContextMention[]>>
  modeBySession: React.RefObject<Map<string, AgentMode | undefined>>
  modelBySession: React.RefObject<Map<string, ModelChoice | undefined>>
  permissionModeBySession: React.RefObject<Map<string, AgentPermissionMode | undefined>>
  reasoningLevelBySession: React.RefObject<Map<string, ReasoningLevel | undefined>>
  retryOptionsBySession: React.RefObject<Map<string, Map<string, TurnRetryOptions>>>
}

export interface ComposerSubmissionController {
  isDraftSendInFlight: (draftKey: string) => boolean
  isSendInFlight: () => boolean
  memory: ComposerSubmissionMemory
  sendNow: (request: ChatSendRequest) => Promise<ChatSendResult>
}

export function useComposerSubmission({
  activeChatSessionId,
  activeComposerDraftKey,
  activeProject,
  activeProjectContext,
  activeSession,
  createSession,
  currentScopeKey,
  displayedPermissionMode,
  messages,
  messagesLoaded,
  organizationSkills,
  persistPermissionMode,
  send,
  sessionScope,
  setIsDraftSession,
  setPendingChatTransition,
  setRoute,
  setSelectedSessionId,
  setSidebarSegment,
  titleGeneration,
}: {
  activeChatSessionId: string | null
  activeComposerDraftKey: string
  activeProject?: SessionProject
  activeProjectContext?: ChatProjectContext
  activeSession?: SessionInfo
  createSession: (title?: string, projectId?: string) => Promise<SessionInfo>
  currentScopeKey: string
  displayedPermissionMode: AgentPermissionMode
  messages: Parameters<typeof buildSessionTitleInput>[0]
  messagesLoaded: boolean
  organizationSkills: ChatOrganizationSkillContext[]
  persistPermissionMode: (sessionId: string, mode: AgentPermissionMode) => void
  send: UseChat["send"]
  sessionScope: SessionScope | null
  setIsDraftSession: React.Dispatch<React.SetStateAction<boolean>>
  setPendingChatTransition: React.Dispatch<React.SetStateAction<PendingChatTransition | null>>
  setRoute: React.Dispatch<React.SetStateAction<AppShellRoute>>
  setSelectedSessionId: React.Dispatch<React.SetStateAction<string | null>>
  setSidebarSegment: React.Dispatch<React.SetStateAction<SidebarSegment>>
  titleGeneration: Pick<
    UseSessionTitleGenerationResult,
    "getAutoFallbackTitle" | "isAutoRefreshable" | "refreshGeneratedTitle" | "rememberAutoFallbackTitle"
  >
}): ComposerSubmissionController {
  const modelBySession = React.useRef<Map<string, ModelChoice | undefined>>(new Map())
  const reasoningLevelBySession = React.useRef<Map<string, ReasoningLevel | undefined>>(new Map())
  const modeBySession = React.useRef<Map<string, AgentMode | undefined>>(new Map())
  const permissionModeBySession = React.useRef<Map<string, AgentPermissionMode | undefined>>(new Map())
  const contextMentionsBySession = React.useRef<Map<string, ChatContextMention[]>>(new Map())
  const retryOptionsBySession = React.useRef<Map<string, Map<string, TurnRetryOptions>>>(new Map())
  const sendInFlightKeys = React.useRef(new Set<string>())
  const activeDraftKeyRef = React.useRef(activeComposerDraftKey)
  const scopeKeyRef = React.useRef(currentScopeKey)
  activeDraftKeyRef.current = activeComposerDraftKey
  scopeKeyRef.current = currentScopeKey

  const sendNow = React.useCallback(
    async (request: ChatSendRequest): Promise<ChatSendResult> => {
      const {
        afterOptimisticSubmit,
        attachments = [],
        contextMentions = [],
        mode,
        model,
        organizationSkills: requestOrganizationSkills,
        permissionMode: permissionModeArg,
        projectContext: requestProjectContext,
        reasoningLevel,
        sessionScope: requestSessionScope,
        text,
      } = request
      const effectiveSessionScope = requestSessionScope ?? sessionScope
      const effectiveScopeKey = sessionScopeKey(effectiveSessionScope)
      const effectiveOrganizationSkills = requestOrganizationSkills ?? organizationSkills
      const effectiveProjectContext = requestProjectContext ?? activeProjectContext
      const sendKey = activeComposerDraftKey
      const isCurrentSendTarget = (): boolean =>
        activeDraftKeyRef.current === sendKey && scopeKeyRef.current === effectiveScopeKey
      if (sendInFlightKeys.current.has(sendKey)) {
        return { reason: "send_in_flight", status: "rejected" }
      }
      if (!effectiveSessionScope || currentScopeKey !== effectiveScopeKey) {
        return { reason: "workspace_not_ready", status: "rejected" }
      }
      sendInFlightKeys.current.add(sendKey)
      try {
        setRoute("chat")
        let sessionId = activeChatSessionId
        const titleInput = { ...buildSessionTitleInput(messages, text, attachments), model }
        const fallbackTitle = buildFallbackSessionTitle(titleInput)
        const autoFallbackTitle = sessionId ? titleGeneration.getAutoFallbackTitle(sessionId) : undefined
        const allowPlaceholderTitle =
          !sessionId || (activeSession ? titleGeneration.isAutoRefreshable(activeSession, true, fallbackTitle) : false)
        const shouldRefreshTitle =
          !sessionId ||
          (activeSession
            ? titleGeneration.isAutoRefreshable(activeSession, allowPlaceholderTitle, fallbackTitle)
            : false)
        const bridgeEmptySend = messagesLoaded && messages.length === 0
        const createdAt = Date.now()
        const selectedPermissionMode = permissionModeArg ?? displayedPermissionMode
        if (bridgeEmptySend && isCurrentSendTarget()) {
          setPendingChatTransition({
            sessionId,
            scopeKey: effectiveScopeKey,
            text,
            attachments,
            contextMentions,
            model,
            reasoningLevel,
            mode,
            permissionMode: selectedPermissionMode,
            createdAt,
          })
        }
        if (!sessionId) {
          let info: SessionInfo
          try {
            info = await createSession(fallbackTitle, effectiveProjectContext?.id ?? activeProject?.id)
          } catch (error) {
            if (bridgeEmptySend && isCurrentSendTarget()) {
              setPendingChatTransition(null)
            }
            return { error, status: "failed" }
          }
          sessionId = info.id
          titleGeneration.rememberAutoFallbackTitle(sessionId, fallbackTitle)
          if (isCurrentSendTarget()) {
            setSelectedSessionId(sessionId)
            setIsDraftSession(false)
            setSidebarSegment(info.projectId ? "projects" : "tasks")
            setPendingChatTransition((pending) =>
              pending?.createdAt === createdAt && pending.scopeKey === effectiveScopeKey
                ? { ...pending, sessionId: info.id }
                : pending,
            )
          }
        }
        persistPermissionMode(sessionId, selectedPermissionMode)
        if (shouldRefreshTitle) {
          void titleGeneration.refreshGeneratedTitle(
            sessionId,
            titleInput,
            allowPlaceholderTitle,
            !activeChatSessionId ? fallbackTitle : autoFallbackTitle,
          )
        }
        modelBySession.current.set(sessionId, model)
        reasoningLevelBySession.current.set(sessionId, reasoningLevel)
        modeBySession.current.set(sessionId, mode)
        permissionModeBySession.current.set(sessionId, selectedPermissionMode)
        contextMentionsBySession.current.set(sessionId, contextMentions)
        rememberTurnRetryOptions(retryOptionsBySession.current, sessionId, chatTurnInputKey({ text, attachments }), {
          contextMentions,
          organizationSkills: effectiveOrganizationSkills,
          projectContext: effectiveProjectContext,
          model,
          reasoningLevel,
          mode,
          permissionMode: selectedPermissionMode,
          sessionScope: effectiveSessionScope,
        })
        try {
          const sendPromise = send(sessionId, text, attachments, {
            contextMentions,
            model,
            organizationSkills: effectiveOrganizationSkills,
            projectContext: effectiveProjectContext,
            reasoningLevel,
            sessionScope: effectiveSessionScope,
            mode,
            permissionMode: selectedPermissionMode,
          })
          afterOptimisticSubmit?.()
          await sendPromise
        } catch (error) {
          if (bridgeEmptySend && isCurrentSendTarget()) {
            setPendingChatTransition(null)
          }
          return { error, status: "failed" }
        }
        return { delivery: "sent", status: "accepted" }
      } finally {
        sendInFlightKeys.current.delete(sendKey)
      }
    },
    [
      activeChatSessionId,
      activeComposerDraftKey,
      activeProject?.id,
      activeProjectContext,
      activeSession,
      createSession,
      currentScopeKey,
      displayedPermissionMode,
      messages,
      messagesLoaded,
      organizationSkills,
      persistPermissionMode,
      send,
      sessionScope,
      setIsDraftSession,
      setPendingChatTransition,
      setRoute,
      setSelectedSessionId,
      setSidebarSegment,
      titleGeneration,
    ],
  )

  const isDraftSendInFlight = React.useCallback(
    (draftKey: string): boolean => sendInFlightKeys.current.has(draftKey),
    [],
  )
  const isSendInFlight = React.useCallback(
    (): boolean => sendInFlightKeys.current.has(activeComposerDraftKey),
    [activeComposerDraftKey],
  )

  return {
    isDraftSendInFlight,
    isSendInFlight,
    memory: {
      contextMentionsBySession,
      modeBySession,
      modelBySession,
      permissionModeBySession,
      reasoningLevelBySession,
      retryOptionsBySession,
    },
    sendNow,
  }
}
