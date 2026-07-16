import type {
  AgentPermissionMode,
  AgentRuntimeStatus,
  AuthorizationInfo,
  ChatPermissionReply,
} from "../../../electron/chat/common.ts"
import type { KnowledgeBaseSummary } from "../../../electron/knowledge/common.ts"
import type { SessionInfo } from "../../../electron/session/common.ts"
import type { ConnectionAuthIntent } from "./app-shell-connection-drawer-model.ts"
import type { ChatSendRequest, ChatSendResult } from "./app-shell-model.ts"
import type { AppShellRoute as Route } from "./app-shell-types.ts"
import type { PendingChatTransition } from "./pending-chat.ts"
import type { SidebarSegment } from "./sidebar-persistence.ts"
import type { ChatConnectionDrawerState } from "./use-chat-connection-retry.ts"
import type { BillingDetailsTarget } from "@/components/app-shell/BillingUsagePopover"
import type { UseAuth } from "@/hooks/useAuth"
import type { ChatTurnRetrySource } from "@/routes/Chat/chat-turns"
import type { ComposerState } from "@/routes/Chat/composer-state"
import type { ConnectionCatalogFilter } from "@/routes/Connections/connection-route-model.ts"
import type { ChatStatus } from "ai"

import { PanelRightClose, PanelRightOpen } from "lucide-react"
import * as React from "react"
import { toast } from "sonner"
import { APP_COMMANDS } from "../../../electron/app-command.ts"
import { buildFallbackSessionTitle } from "../../../electron/session/title.ts"
import {
  activeProjectIdForComposer,
  buildSessionTitleInput,
  chatSendAccepted,
  connectionWorkspaceSwitchKey,
  EMPTY_CONNECTION_PROVIDERS,
  existingSessionComposerDraftKey,
  initialRoute,
  newSessionComposerDraftKeyForScopeKey,
  NO_DRAFT_PROJECT_ID,
  projectContextFromProject,
  sessionRecordScopeKey,
  sessionScopeFromWorkspace,
  sessionScopeKey,
  workspaceActivationHasFailed,
  workspaceSelectionSwitchKey,
} from "./app-shell-model.ts"
import { AppShellArtifactsPanel } from "./AppShellArtifactsPanel.tsx"
import { AppShellConnectionDrawer } from "./AppShellConnectionDrawer.tsx"
import { AppShellMainTitlebar } from "./AppShellMainTitlebar.tsx"
import { AppShellNavigationSidebar } from "./AppShellNavigationSidebar.tsx"
import { AppShellSessionProjectDialogs } from "./AppShellSessionProjectDialogs.tsx"
import { KnowledgeContextBar } from "./KnowledgeContextBar.tsx"
import { isPendingChatCaughtUp } from "./pending-chat.ts"
import { readStoredSidebarSegment, writeStoredSidebarSegment } from "./sidebar-persistence.ts"
import { nextActiveSessionIdAfterArchive } from "./sidebar-sessions.ts"
import { useAppShellCommands } from "./use-app-shell-commands.ts"
import { useAppShellSidebarSessions } from "./use-app-shell-sidebar-sessions.ts"
import { useAppShellSkillRecommendations } from "./use-app-shell-skill-recommendations.ts"
import { useArtifactsPanelState } from "./use-artifacts-panel-state.ts"
import { useChatConnectionRetry } from "./use-chat-connection-retry.ts"
import { useChatQueueState } from "./use-chat-queue-state.ts"
import { useComposerNavigation } from "./use-composer-navigation.ts"
import { useComposerSubmission } from "./use-composer-submission.ts"
import { useProjectActions } from "./use-project-actions.ts"
import { useProjectSidebarCollapseState } from "./use-project-sidebar-collapse-state.ts"
import { useSessionActions } from "./use-session-actions.ts"
import { useSessionTitleGeneration } from "./use-session-title-generation.ts"
import { useSidebarChromeState } from "./use-sidebar-chrome-state.ts"
import { useWorkspaceActivation } from "./use-workspace-activation.ts"
import { ProjectContextBar } from "@/components/app-shell/ProjectContextBar"
import { useAttentionService, useChatService } from "@/components/AppContext"
import { useSkillInventoryResource } from "@/components/AppDataHooks"
import { AppUpdateTitlebarEntry } from "@/components/AppUpdateTitlebarEntry"
import { useAppSettings } from "@/hooks/useAppSettings"
import { useAppUpdate } from "@/hooks/useAppUpdate"
import { useAttention } from "@/hooks/useAttention"
import { useChat } from "@/hooks/useChat"
import { useConnections } from "@/hooks/useConnections"
import { useKnowledgeBases } from "@/hooks/useKnowledgeBases"
import { useOrganizationSkills } from "@/hooks/useOrganizationSkills"
import { useOrganizationWorkspace } from "@/hooks/useOrganizationWorkspace"
import { useProjectGit } from "@/hooks/useProjectGit"
import { useSessions } from "@/hooks/useSessions"
import { useT } from "@/i18n/i18n"
import { appCommandShortcutLabel, labelWithShortcut } from "@/lib/app-shortcuts"
import { billingRequestScopeForWorkspace } from "@/lib/billing-scope"
import { reportRendererHandledError } from "@/lib/renderer-diagnostics"
import { resolveUserFacingError, userFacingErrorDescription } from "@/lib/user-facing-error"
import { cn } from "@/lib/utils"
import { chatTurnAllowsDirectSend, chatTurnQueuesNewMessage, resolveChatTurnState } from "@/routes/Chat/chat-turn-state"
import { chatTurnInputKey } from "@/routes/Chat/chat-turns"
import { hasComposerDraftContent, toCachedComposerState } from "@/routes/Chat/composer-state"
import { summarizeEmptyStateConnections } from "@/routes/Chat/empty-state-connections"

const ArchivedRoute = React.lazy(() =>
  import("@/routes/Archived").then((module) => ({ default: module.ArchivedRoute })),
)
const BillingRoute = React.lazy(() => import("@/routes/Billing").then((module) => ({ default: module.BillingRoute })))
const ChatArea = React.lazy(() => import("@/routes/Chat").then((module) => ({ default: module.ChatArea })))
const ConnectionsPanel = React.lazy(() =>
  import("@/routes/Connections").then((module) => ({ default: module.ConnectionsPanel })),
)
const OrganizationManagementRoute = React.lazy(() =>
  import("@/routes/Skills/OrganizationManagement").then((module) => ({ default: module.OrganizationManagementRoute })),
)
const KnowledgeRoute = React.lazy(() =>
  import("@/routes/Knowledge").then((module) => ({ default: module.KnowledgeRoute })),
)
const SettingsRoute = React.lazy(() =>
  import("@/routes/Settings").then((module) => ({ default: module.SettingsRoute })),
)
const SkillsRoute = React.lazy(() => import("@/routes/Skills").then((module) => ({ default: module.SkillsRoute })))

function releaseTransientFocus(): void {
  const blurActiveElement = (): void => {
    const activeElement = document.activeElement
    if (activeElement instanceof HTMLElement) {
      activeElement.blur()
    }
  }
  blurActiveElement()
  window.requestAnimationFrame(blurActiveElement)
}

function RouteLoadingFallback({ className }: { className?: string }) {
  return <div className={cn("h-full min-h-0 bg-background", className)} />
}

export function AppShell({ auth }: { auth: UseAuth }) {
  const t = useT()
  const attentionService = useAttentionService()
  const chatService = useChatService()
  const attention = useAttention()
  const appUpdate = useAppUpdate()
  const appSettings = useAppSettings()
  const [ready, setReady] = React.useState(false)
  const [billingInitialTarget, setBillingInitialTarget] = React.useState<BillingDetailsTarget | null>(null)
  const [agentStatus, setAgentStatus] = React.useState<AgentRuntimeStatus>({ status: "starting" })
  const organizationWorkspace = useOrganizationWorkspace(auth.state?.account?.id)
  const organizationSkills = useOrganizationSkills(organizationWorkspace.activeWorkspace, auth.state?.account?.id)
  const skillInventory = useSkillInventoryResource()
  const knowledgeBaseBetaEnabled = appSettings.settings.knowledgeBaseBetaEnabled
  const knowledgeLibrary = useKnowledgeBases(knowledgeBaseBetaEnabled)
  const connections = useConnections(organizationWorkspace.connectionWorkspace)
  const sessionScope = React.useMemo(
    () => sessionScopeFromWorkspace(organizationWorkspace.activeWorkspace),
    [organizationWorkspace.activeWorkspace],
  )
  const sessionsEnabled = auth.state?.status === "authenticated" && sessionScope !== null
  const {
    sessions,
    taskSessions,
    projectSessions,
    projects,
    loaded: sessionsLoaded,
    loadedScopeKey: sessionsLoadedScopeKey,
    error: sessionsError,
    create,
    createProject,
    assignSessionProject,
    setSessionPermissionMode,
    setSessionKnowledgeBases,
    renameProject: renameProjectAction,
    pinProject: pinProjectAction,
    archiveProject: archiveProjectAction,
    removeProject: removeProjectAction,
    generateTitle,
    rename,
    pin,
    archive,
    listArchived,
    unarchive,
    remove: removeSession,
    refresh: refreshSessions,
  } = useSessions({ enabled: sessionsEnabled, scope: sessionScope })
  const currentScopeKey = sessionScopeKey(sessionScope)
  const currentConnectionWorkspaceKey = organizationWorkspace.connectionWorkspace
    ? connectionWorkspaceSwitchKey(organizationWorkspace.connectionWorkspace)
    : null
  const activeWorkspaceKey = workspaceSelectionSwitchKey(organizationWorkspace.activeWorkspace)
  const activeOrganizationId = organizationWorkspace.activeWorkspace.organizationId || null
  const activeOrganizationSkillsMatched = organizationSkills.organizationId === activeOrganizationId
  const organizationSkillsError =
    activeOrganizationId && activeOrganizationSkillsMatched && !organizationSkills.loading
      ? organizationSkills.error
      : null
  const organizationSkillsSettled =
    !activeOrganizationId ||
    (activeOrganizationSkillsMatched && !organizationSkills.loading && organizationSkills.hasLoaded)
  const {
    activationBlocked: workspaceActivationBlocked,
    activationState: workspaceActivationState,
    handleSwitchStart: handleWorkspaceSwitchStart,
    navigationSwitching: workspaceNavigationSwitching,
  } = useWorkspaceActivation({
    activationInput: {
      agentScopeSyncError: connections.scopeSyncError,
      agentScopeWorkspaceKey: connections.agentScopeWorkspaceKey,
      connectionSettledWorkspaceKey: connections.summaryWorkspaceKey,
      connectionWorkspaceKey: currentConnectionWorkspaceKey,
      connectionsRefreshing: connections.busy === "refresh",
      currentScopeKey,
      loadedSessionScopeKey: sessionsLoadedScopeKey,
      organizationSkillsError,
      organizationSkillsSettled,
      workspaceMetadataError: organizationWorkspace.error,
    },
    activeWorkspaceKey,
    hasLoadedOrganizations: organizationWorkspace.hasLoaded,
    loadingOrganizations: organizationWorkspace.loading,
    organizationIds: organizationWorkspace.organizations.map((organization) => organization.id),
  })
  const sessionsSettledForCurrentScope = sessionsLoaded && sessionsLoadedScopeKey === currentScopeKey
  const visibleSessions = React.useMemo(
    () => (sessionsSettledForCurrentScope ? sessions : []),
    [sessions, sessionsSettledForCurrentScope],
  )
  const visibleTaskSessions = React.useMemo(
    () => (sessionsSettledForCurrentScope ? taskSessions : []),
    [sessionsSettledForCurrentScope, taskSessions],
  )
  const visibleProjectSessions = React.useMemo(
    () => (sessionsSettledForCurrentScope ? projectSessions : []),
    [projectSessions, sessionsSettledForCurrentScope],
  )
  const visibleProjects = React.useMemo(
    () => (sessionsSettledForCurrentScope ? projects : []),
    [projects, sessionsSettledForCurrentScope],
  )
  const [route, setRoute] = React.useState<Route>(initialRoute)
  const [selectedSessionId, setSelectedSessionId] = React.useState<string | null>(null)
  const [isDraftSession, setIsDraftSession] = React.useState(false)
  const [draftPermissionMode, setDraftPermissionMode] = React.useState<AgentPermissionMode>("default")
  const [draftKnowledgeBaseIds, setDraftKnowledgeBaseIds] = React.useState<string[]>([])
  const [draftProjectId, setDraftProjectId] = React.useState<string | null>(null)
  const [sidebarSegment, setSidebarSegment] = React.useState<SidebarSegment>(() =>
    readStoredSidebarSegment(globalThis.localStorage),
  )
  const [pendingChatTransition, setPendingChatTransition] = React.useState<PendingChatTransition | null>(null)
  const appChromeRef = React.useRef<HTMLDivElement | null>(null)
  const {
    handleSidebarResizeKeyDown,
    handleSidebarResizeStart,
    handleToggleSidebar,
    isSidebarResizing,
    isSidebarRestoring,
    setIsSidebarRestoring,
    setSidebarCollapsed,
    sidebarCollapsed,
    sidebarWidth,
  } = useSidebarChromeState(appChromeRef)
  const [searchOpen, setSearchOpen] = React.useState(false)
  const [composerFocusRequest, setComposerFocusRequest] = React.useState(0)
  const selectedSession = selectedSessionId
    ? (visibleSessions.find((session) => session.id === selectedSessionId) ?? null)
    : null
  const selectedSessionMatchesScope =
    Boolean(selectedSession) && sessionRecordScopeKey(selectedSession?.scope) === currentScopeKey
  const activeChatSessionId = selectedSessionMatchesScope ? selectedSessionId : null
  const activeSession = selectedSessionMatchesScope ? (selectedSession ?? undefined) : undefined
  const activeKnowledgeBaseIds = activeSession?.knowledgeBaseIds ?? draftKnowledgeBaseIds
  const activeKnowledgeBases = React.useMemo(
    () =>
      knowledgeBaseBetaEnabled
        ? activeKnowledgeBaseIds.flatMap((id) => {
            const item = knowledgeLibrary.items.find((candidate) => candidate.id === id)
            return item ? [item] : []
          })
        : [],
    [activeKnowledgeBaseIds, knowledgeBaseBetaEnabled, knowledgeLibrary.items],
  )
  const pinnedKnowledgeMentions = React.useMemo(
    () =>
      activeKnowledgeBases.map((item) => ({
        id: item.id,
        kind: "knowledge" as const,
        name: item.title,
      })),
    [activeKnowledgeBases],
  )

  React.useEffect(() => {
    if (!appSettings.loading && !knowledgeBaseBetaEnabled && route === "knowledge") {
      setRoute("chat")
    }
  }, [appSettings.loading, knowledgeBaseBetaEnabled, route])

  const {
    messages,
    pendingPermissions,
    pendingQuestions,
    status,
    activity,
    messagesLoaded,
    error,
    getSessionStatus,
    getSessionRunStartedAt,
    permissionMode,
    setPermissionMode: setChatPermissionMode,
    send,
    stop,
    answerPermission,
    answerQuestion,
    rejectQuestion,
    questionDrafts,
  } = useChat(activeChatSessionId)
  const hasUnreadSession = attention.hasUnreadSession

  React.useEffect(() => {
    const syncVisibleSession = (): void => {
      const visible = document.visibilityState === "visible" && document.hasFocus() && route === "chat"
      void attentionService
        .invoke("setVisibleSession", {
          ...(activeChatSessionId ? { sessionId: activeChatSessionId } : {}),
          visible,
        })
        .catch((error: unknown) => {
          reportRendererHandledError("attention", "sync visible session failed", error)
        })
    }
    syncVisibleSession()
    document.addEventListener("visibilitychange", syncVisibleSession)
    window.addEventListener("focus", syncVisibleSession)
    window.addEventListener("blur", syncVisibleSession)
    return () => {
      document.removeEventListener("visibilitychange", syncVisibleSession)
      window.removeEventListener("focus", syncVisibleSession)
      window.removeEventListener("blur", syncVisibleSession)
    }
  }, [activeChatSessionId, attentionService, route])

  React.useEffect(
    () =>
      attentionService.serverEvents.on("openSessionRequested", ({ sessionId }) => {
        const session = visibleSessions.find((candidate) => candidate.id === sessionId)
        if (session) {
          setSidebarSegment(session.projectId ? "projects" : "tasks")
        }
        setSelectedSessionId(sessionId)
        setIsDraftSession(false)
        setPendingChatTransition(null)
        setRoute("chat")
      }),
    [attentionService, visibleSessions],
  )
  const connectionSummaryMatchesWorkspace =
    Boolean(currentConnectionWorkspaceKey) && connections.summaryWorkspaceKey === currentConnectionWorkspaceKey
  const activeProvidersLoading =
    Boolean(currentConnectionWorkspaceKey) &&
    !connectionSummaryMatchesWorkspace &&
    !workspaceActivationHasFailed(workspaceActivationState)
  const activeProviders = connectionSummaryMatchesWorkspace
    ? (connections.summary?.providers ?? EMPTY_CONNECTION_PROVIDERS)
    : EMPTY_CONNECTION_PROVIDERS
  const {
    entryVisible: organizationSkillEntryVisible,
    pendingInstallCount: recommendedSkillPendingInstallCount,
    showcaseItems: organizationSkillShowcaseItems,
  } = useAppShellSkillRecommendations({
    activeProviders,
    inventory: skillInventory.data,
    organizationSkills,
    route,
  })
  const sharedConnectorCount = connectionSummaryMatchesWorkspace
    ? connections.summary?.connectedProviderCount
    : undefined
  const emptyStateConnectionSummary = connectionSummaryMatchesWorkspace
    ? connections.summary
      ? summarizeEmptyStateConnections(connections.summary.providers, connections.summary.connectedProviderCount)
      : null
    : activeProvidersLoading
      ? undefined
      : null
  const canManageWorkspaceConnections = organizationWorkspace.activeWorkspace.canManage
  const [selectedService, setSelectedService] = React.useState<string | null>(null)
  const [connectionCatalogFilter, setConnectionCatalogFilter] = React.useState<ConnectionCatalogFilter>({ kind: "all" })
  const [chatConnectionDrawers, setChatConnectionDrawers] = React.useState<Record<string, ChatConnectionDrawerState>>(
    {},
  )
  const composerDraftsByKey = React.useRef<Map<string, ComposerState>>(new Map())
  const lastChatProjectId = React.useRef<string | null>(null)
  const workspaceResetKeyRef = React.useRef(activeWorkspaceKey)
  const previousActiveChatSessionIdRef = React.useRef<string | null>(null)
  const {
    artifactSelection,
    artifactsPanelContentRef,
    artifactsPanelIsMaximized,
    artifactsPanelMaxWidthState,
    artifactsPanelOpen,
    artifactsPanelShellRef,
    artifactsPanelVisible,
    handleArtifactsAvailable,
    handleArtifactsOpen,
    handleArtifactsPanelResizeKeyDown,
    handleArtifactsPanelResizeStart,
    handleArtifactsReset,
    handleTurnOutputAvailable,
    handleTurnOutputOpen,
    hasPanelSelection,
    isArtifactsPanelResizing,
    latestArtifactSelection,
    setArtifactsPanelOpen,
    setArtifactsPanelMaximizedState,
    turnOutputSelection,
    visibleArtifactsPanelWidth,
  } = useArtifactsPanelState({
    activeSessionId: activeChatSessionId,
    appChromeRef,
    route,
    setIsSidebarRestoring,
    setSidebarCollapsed,
    sidebarCollapsed,
    sidebarWidth,
  })

  React.useEffect(() => {
    let cancelled = false

    const applyStatus = (status: AgentRuntimeStatus): void => {
      setAgentStatus(status)
      setReady(status.status === "ready")
    }

    const readStatus = async (): Promise<void> => {
      try {
        const status = await chatService.invoke("getAgentStatus")
        if (!cancelled) {
          applyStatus(status)
        }
      } catch {
        if (!cancelled) {
          applyStatus({ status: "starting" })
        }
      }
    }
    void readStatus()
    const off = chatService.serverEvents.on("agentStatusChanged", (event) => {
      applyStatus(event.status)
    })
    return () => {
      cancelled = true
      off()
    }
  }, [chatService])

  React.useEffect(() => {
    if (ready && sessionsEnabled) {
      void refreshSessions()
    }
  }, [ready, refreshSessions, sessionsEnabled])

  // dev/smoke：VITE_WANTA_SMOKE 设置时，就绪后自动发送一条消息用于可视化验证（生产无此 env，无害）。
  const smokeSent = React.useRef(false)
  React.useEffect(() => {
    const smoke = (import.meta.env as Record<string, string | undefined>)["VITE_WANTA_SMOKE"]
    if (ready && smoke && !smokeSent.current) {
      smokeSent.current = true
      void handleSend({ text: smoke })
    }
  }, [ready])

  React.useEffect(() => {
    if (!activeChatSessionId || !activeSession) {
      return
    }
    setChatPermissionMode(activeChatSessionId, activeSession.permissionMode ?? "default")
  }, [activeChatSessionId, activeSession?.permissionMode, setChatPermissionMode])

  const persistPermissionMode = React.useCallback(
    (sessionId: string, mode: AgentPermissionMode): void => {
      void setSessionPermissionMode(sessionId, mode).catch((cause: unknown) => {
        console.error("[wanta] persist session permission mode failed", cause)
        reportRendererHandledError("appShell.permissionMode", "Failed to persist session permission mode", cause)
        toast.error(userFacingErrorDescription(resolveUserFacingError(cause, { area: "session" }), t))
      })
    },
    [setSessionPermissionMode, t],
  )

  const setAndPersistPermissionMode = React.useCallback(
    (sessionId: string, mode: AgentPermissionMode): void => {
      setChatPermissionMode(sessionId, mode)
      persistPermissionMode(sessionId, mode)
    },
    [persistPermissionMode, setChatPermissionMode],
  )
  const persistKnowledgeBaseIds = React.useCallback(
    (sessionId: string, ids: string[]): void => {
      void setSessionKnowledgeBases(sessionId, ids).catch((cause: unknown) => {
        console.error("[wanta] persist session knowledge bases failed", cause)
        reportRendererHandledError("appShell.knowledgeBases", "Failed to persist session knowledge bases", cause)
        toast.error(userFacingErrorDescription(resolveUserFacingError(cause, { area: "session" }), t))
      })
    },
    [setSessionKnowledgeBases, t],
  )
  const {
    clearAutoFallbackTitle,
    getAutoFallbackTitle,
    isAutoRefreshable,
    refreshGeneratedTitle,
    rememberAutoFallbackTitle,
  } = useSessionTitleGeneration({
    generateTitle,
    rename,
    sessions: visibleSessions,
  })
  const titleGeneration = React.useMemo(
    () => ({ getAutoFallbackTitle, isAutoRefreshable, refreshGeneratedTitle, rememberAutoFallbackTitle }),
    [getAutoFallbackTitle, isAutoRefreshable, refreshGeneratedTitle, rememberAutoFallbackTitle],
  )
  const activeProjectId = React.useMemo(
    () => activeProjectIdForComposer({ activeSession, draftProjectId }),
    [activeSession, draftProjectId],
  )
  const activeProject = React.useMemo(() => {
    if (!activeProjectId) {
      return undefined
    }
    return visibleProjects.find((project) => project.id === activeProjectId)
  }, [activeProjectId, visibleProjects])
  const handleProjectUnavailable = React.useCallback(
    (projectId: string): void => {
      if (lastChatProjectId.current === projectId) {
        lastChatProjectId.current = null
      }
      if (activeProjectId !== projectId) {
        return
      }
      if (activeChatSessionId) {
        setSelectedSessionId(null)
      }
      setIsDraftSession(true)
      setDraftProjectId(NO_DRAFT_PROJECT_ID)
      setPendingChatTransition(null)
      setRoute("chat")
    },
    [activeChatSessionId, activeProjectId],
  )
  const projectActions = useProjectActions({
    archiveProject: archiveProjectAction,
    onProjectUnavailable: handleProjectUnavailable,
    pinProject: pinProjectAction,
    projects: visibleProjects,
    removeProject: removeProjectAction,
    renameProject: renameProjectAction,
  })
  const projectGit = useProjectGit(activeProject)
  const activeProjectContext = React.useMemo(
    () => projectContextFromProject(activeProject, projectGit.state),
    [activeProject, projectGit.state],
  )
  React.useEffect(() => {
    if (route === "chat") {
      lastChatProjectId.current = activeProjectId ?? null
    }
  }, [activeProjectId, route])
  const { collapsedProjectIds, handleProjectSidebarExpandedChange } = useProjectSidebarCollapseState({
    accountId: auth.state?.account?.id,
    projects: visibleProjects,
    sessionScope,
    sessionsLoaded: sessionsSettledForCurrentScope,
  })
  const newSessionDraftScopeKey = sessionScope ? currentScopeKey : activeWorkspaceKey
  const activeComposerDraftKey = activeChatSessionId
    ? existingSessionComposerDraftKey(currentScopeKey, activeChatSessionId)
    : newSessionComposerDraftKeyForScopeKey(newSessionDraftScopeKey, activeProjectId)
  const initialComposerState = composerDraftsByKey.current.get(activeComposerDraftKey)
  const activeChatConnectionDrawer = chatConnectionDrawers[activeComposerDraftKey] ?? null
  const chatConnectionAuthIntent = activeChatConnectionDrawer?.authIntent ?? null
  const chatConnectionSelectedService = activeChatConnectionDrawer?.selectedService ?? null
  const chatConnectionDrawerVisible =
    route === "chat" &&
    activeChatConnectionDrawer?.open === true &&
    Boolean(chatConnectionAuthIntent || chatConnectionSelectedService)
  const activePendingChatTransition = pendingChatTransition?.scopeKey === currentScopeKey ? pendingChatTransition : null
  const pendingCaughtUp = isPendingChatCaughtUp(activePendingChatTransition, activeChatSessionId, messages)
  const initialSendPending = Boolean(activePendingChatTransition && !pendingCaughtUp)
  const bridgeInitialSendPending = initialSendPending && messages.length === 0
  const displayedStatus: ChatStatus = initialSendPending ? "submitted" : status
  const activePendingQuestionCount = pendingQuestions.length
  const activeChatTurnState = React.useMemo(
    () =>
      resolveChatTurnState({
        initialSendPending,
        pendingPermissionCount: pendingPermissions.length,
        pendingQuestionCount: activePendingQuestionCount,
        status: displayedStatus,
      }),
    [activePendingQuestionCount, displayedStatus, initialSendPending, pendingPermissions.length],
  )
  const isSessionRunning = React.useCallback(
    (sessionId: string): boolean => {
      if (sessionId === activeChatSessionId) {
        return chatTurnQueuesNewMessage(activeChatTurnState)
      }
      const sessionStatus = getSessionStatus(sessionId)
      return sessionStatus === "submitted" || sessionStatus === "streaming"
    },
    [activeChatSessionId, activeChatTurnState, getSessionStatus],
  )
  const {
    pinnedProjectGroups: projectPinnedGroups,
    pinnedProjectSessions: projectPinnedSessions,
    projectGroups: projectSidebarGroups,
    regularProjectGroups: projectRegularGroups,
    selectableSessions: selectableSidebarSessions,
    taskGroups: sidebarSessionGroups,
  } = useAppShellSidebarSessions({
    getSessionRunStartedAt,
    isSessionRunning,
    projectSessions: visibleProjectSessions,
    projects: visibleProjects,
    selectedSessionId,
    sidebarSegment,
    taskSessions: visibleTaskSessions,
  })
  const displayedPermissionMode = activeChatSessionId ? permissionMode : draftPermissionMode
  const needsDefaultSessionSelection =
    sessionsSettledForCurrentScope && !isDraftSession && !selectedSessionId && selectableSidebarSessions.length > 0
  const startupError =
    agentStatus.status === "error" ? resolveUserFacingError(agentStatus.message, { area: "agent" }) : null
  const hasVisibleLoadedSession = Boolean(activeChatSessionId && messagesLoaded)
  const chatBootstrapping =
    !startupError &&
    ((!ready && !hasVisibleLoadedSession) ||
      !sessionsSettledForCurrentScope ||
      needsDefaultSessionSelection ||
      Boolean(activeChatSessionId && !messagesLoaded && !activePendingChatTransition))
  const showChatEmptyState =
    ready &&
    sessionsSettledForCurrentScope &&
    !activePendingChatTransition &&
    (!activeChatSessionId || (messagesLoaded && messages.length === 0))

  // 默认选中当前侧边栏里实际排在最前面的会话，避免内部数据顺序和 UI 顺序不一致。
  React.useLayoutEffect(() => {
    if (
      sessionsSettledForCurrentScope &&
      !isDraftSession &&
      !selectedSessionId &&
      selectableSidebarSessions.length > 0
    ) {
      setSelectedSessionId(selectableSidebarSessions[0].id)
    }
  }, [selectableSidebarSessions, sessionsSettledForCurrentScope, selectedSessionId, isDraftSession])

  React.useEffect(() => {
    if (!sessionsSettledForCurrentScope || isDraftSession || !selectedSessionId) {
      return
    }
    if (selectableSidebarSessions.some((session) => session.id === selectedSessionId)) {
      return
    }
    if (selectableSidebarSessions.length > 0) {
      setSelectedSessionId(selectableSidebarSessions[0].id)
      setDraftProjectId(null)
      setPendingChatTransition(null)
      return
    }
    if (visibleSessions.some((session) => session.id === selectedSessionId)) {
      return
    }
    setSelectedSessionId(null)
    setDraftProjectId(null)
    setPendingChatTransition(null)
  }, [isDraftSession, selectableSidebarSessions, selectedSessionId, sessionsSettledForCurrentScope, visibleSessions])

  React.useEffect(() => {
    if (!sessionsSettledForCurrentScope || !selectedSessionId) {
      return
    }
    if (visibleSessions.some((session) => session.id === selectedSessionId)) {
      return
    }
    setSelectedSessionId(null)
    setIsDraftSession(false)
    setPendingChatTransition(null)
  }, [selectedSessionId, sessionsSettledForCurrentScope, visibleSessions])

  const showComposerProjectContext = route === "chat"
  const chatEmptyTitle = activeProject ? t("project.chatEmptyTitle", { project: activeProject.name }) : undefined
  const titlebarTitle =
    route === "settings"
      ? t("settings.title")
      : route === "billing"
        ? t("billing.title")
        : route === "connections"
          ? t("connections.title")
          : route === "skills"
            ? t("skills.title")
            : route === "knowledge" && knowledgeBaseBetaEnabled
              ? t("knowledge.title")
              : route === "organizations"
                ? t("organizations.title")
                : route === "archived"
                  ? t("archived.title")
                  : (activeSession?.title ?? t("chat.newSession"))
  const titlebarEditable = route === "chat" && Boolean(activeSession)

  React.useEffect(() => {
    writeStoredSidebarSegment(globalThis.localStorage, sidebarSegment)
  }, [sidebarSegment])

  React.useEffect(() => {
    if (pendingCaughtUp) {
      setPendingChatTransition(null)
    }
  }, [pendingCaughtUp])

  React.useEffect(() => {
    if (
      draftProjectId &&
      draftProjectId !== NO_DRAFT_PROJECT_ID &&
      !visibleProjects.some((project) => project.id === draftProjectId)
    ) {
      setDraftProjectId(null)
    }
  }, [draftProjectId, visibleProjects])

  React.useEffect(() => {
    lastChatProjectId.current = null
  }, [sessionScope])

  React.useEffect(() => {
    if (activePendingChatTransition && status === "error") {
      setPendingChatTransition(null)
    }
  }, [activePendingChatTransition, status])

  const handleComposerStateChange = React.useCallback(
    (state: ComposerState): void => {
      const cached = toCachedComposerState(state)
      if (hasComposerDraftContent(cached)) {
        composerDraftsByKey.current.set(activeComposerDraftKey, cached)
      } else {
        composerDraftsByKey.current.delete(activeComposerDraftKey)
      }
    },
    [activeComposerDraftKey],
  )

  const clearComposerDraft = React.useCallback((draftKey: string): void => {
    composerDraftsByKey.current.delete(draftKey)
  }, [])
  const readLastProjectId = React.useCallback((): string | null => lastChatProjectId.current, [])
  const {
    handleNewSession,
    handleNewTaskSession,
    handleOpenProjectDraft,
    handleSelectComposerProject,
    handleSelectComposerProjectFolder,
    handleSelectProjectFolder,
    handleSelectSession,
    requestComposerFocus,
  } = useComposerNavigation({
    activeChatSessionId,
    activeSession,
    assignSessionProject,
    clearComposerDraft,
    createProject,
    draftProjectId,
    isDraftSession,
    lastProjectId: readLastProjectId,
    route,
    sessionScope,
    setComposerFocusRequest,
    setDraftPermissionMode,
    setDraftProjectId,
    setIsDraftSession,
    setPendingChatTransition,
    setRoute,
    setSearchOpen,
    setSelectedSessionId,
    setSidebarSegment,
    sidebarSegment,
  })
  const handleNewSessionWithKnowledgeReset = React.useCallback((): void => {
    setDraftKnowledgeBaseIds([])
    handleNewSession()
  }, [handleNewSession])
  const handleSessionArchived = React.useCallback(
    (session: SessionInfo): void => {
      clearComposerDraft(existingSessionComposerDraftKey(sessionRecordScopeKey(session.scope), session.id))
      if (activeChatSessionId !== session.id) {
        return
      }
      setSelectedSessionId(nextActiveSessionIdAfterArchive(selectableSidebarSessions, session.id))
      setIsDraftSession(false)
      setPendingChatTransition(null)
      setRoute("chat")
    },
    [activeChatSessionId, clearComposerDraft, selectableSidebarSessions],
  )
  const sessionActions = useSessionActions({
    archive,
    clearAutoFallbackTitle,
    isSessionRunning,
    onArchived: handleSessionArchived,
    pin,
    rename,
    sessions: visibleSessions,
  })

  const {
    isDraftSendInFlight,
    isSendInFlight,
    memory: {
      contextMentionsBySession: lastContextMentionsBySession,
      modeBySession: lastModeBySession,
      modelBySession: lastModelBySession,
      permissionModeBySession: lastPermissionModeBySession,
      reasoningLevelBySession: lastReasoningLevelBySession,
      retryOptionsBySession: turnRetryOptionsBySession,
    },
    sendNow,
  } = useComposerSubmission({
    activeChatSessionId,
    activeComposerDraftKey,
    activeProject,
    activeProjectContext,
    activeSession,
    createSession: create,
    currentScopeKey,
    displayedPermissionMode,
    messages,
    messagesLoaded,
    knowledgeBaseIds: activeKnowledgeBaseIds,
    organizationSkills: organizationSkills.chatContextSkills,
    persistKnowledgeBaseIds,
    persistPermissionMode,
    send,
    sessionScope,
    setIsDraftSession,
    setPendingChatTransition,
    setRoute,
    setSelectedSessionId,
    setSidebarSegment,
    titleGeneration,
  })

  const {
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
  } = useChatQueueState({
    activeSessionId: activeChatSessionId,
    dispatchBlocked: chatTurnQueuesNewMessage(activeChatTurnState),
    initialSendPending,
    isSendInFlight,
    sendQueuedMessage: sendNow,
    status,
  })

  const { cancelRetryForDrawer, clearRetries, prepareRetry } = useChatConnectionRetry({
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
  })

  const handleOpenConnections = React.useCallback(
    (filter: ConnectionCatalogFilter = { kind: "all" }): void => {
      cancelRetryForDrawer(activeComposerDraftKey)
      setChatConnectionDrawers((current) => {
        if (!Object.hasOwn(current, activeComposerDraftKey)) {
          return current
        }
        const next = { ...current }
        delete next[activeComposerDraftKey]
        return next
      })
      setSelectedService(null)
      setConnectionCatalogFilter(filter)
      setRoute("connections")
    },
    [activeComposerDraftKey, cancelRetryForDrawer],
  )

  const handleOpenChatConnectionProvider = React.useCallback(
    (service: string): void => {
      setRoute("chat")
      cancelRetryForDrawer(activeComposerDraftKey)
      setChatConnectionDrawers((current) => ({
        ...current,
        [activeComposerDraftKey]: {
          authIntent: null,
          open: true,
          selectedService: service,
        },
      }))
    },
    [activeComposerDraftKey, cancelRetryForDrawer],
  )

  const handleCloseChatConnectionDrawer = React.useCallback((): void => {
    cancelRetryForDrawer(activeComposerDraftKey)
    setChatConnectionDrawers((current) => {
      if (!Object.hasOwn(current, activeComposerDraftKey)) {
        return current
      }
      const next = { ...current }
      delete next[activeComposerDraftKey]
      return next
    })
  }, [activeComposerDraftKey, cancelRetryForDrawer])

  React.useEffect(() => {
    if (activeChatSessionId) {
      previousActiveChatSessionIdRef.current = activeChatSessionId
    }
  }, [activeChatSessionId])

  React.useLayoutEffect(() => {
    const previousWorkspaceKey = workspaceResetKeyRef.current
    if (previousWorkspaceKey === activeWorkspaceKey) {
      return
    }
    workspaceResetKeyRef.current = activeWorkspaceKey
    const previousSessionId = previousActiveChatSessionIdRef.current
    if (previousSessionId) {
      holdQueuedSessionIfQueued(previousSessionId)
    }
    previousActiveChatSessionIdRef.current = null
    clearRetries()
    setChatConnectionDrawers({})
    setSelectedService(null)
    setSelectedSessionId(null)
    setIsDraftSession(false)
    setDraftPermissionMode("default")
    setDraftKnowledgeBaseIds([])
    setDraftProjectId(null)
    setPendingChatTransition(null)
    sessionActions.resetDialogs()
    projectActions.resetDialogs()
    handleArtifactsReset()
    releaseTransientFocus()
  }, [
    activeWorkspaceKey,
    clearRetries,
    handleArtifactsReset,
    holdQueuedSessionIfQueued,
    projectActions.resetDialogs,
    sessionActions.resetDialogs,
  ])

  React.useEffect(() => {
    if (!sessionsSettledForCurrentScope || !activeChatSessionId) {
      return
    }
    if (visibleSessions.some((session) => session.id === activeChatSessionId)) {
      return
    }
    clearQueuedSession(activeChatSessionId)
  }, [activeChatSessionId, clearQueuedSession, sessionsSettledForCurrentScope, visibleSessions])

  const handleSend = React.useCallback(
    async (request: ChatSendRequest): Promise<ChatSendResult> => {
      const {
        afterOptimisticSubmit,
        attachments = [],
        contextMentions = [],
        mode,
        model,
        permissionMode,
        reasoningLevel,
        text,
      } = request
      const effectiveContextMentions = [
        ...contextMentions.filter((mention) => mention.kind !== "knowledge"),
        ...pinnedKnowledgeMentions,
      ]
      const draftKey = activeComposerDraftKey
      const clearSubmittedDraft = (): void => {
        clearComposerDraft(draftKey)
        afterOptimisticSubmit?.()
      }
      if (activeChatSessionId && (!chatTurnAllowsDirectSend(activeChatTurnState) || isDraftSendInFlight(draftKey))) {
        queueActiveMessage(
          text,
          attachments,
          effectiveContextMentions,
          model,
          reasoningLevel,
          mode,
          permissionMode,
          organizationSkills.chatContextSkills,
          activeProjectContext,
          sessionScope ?? undefined,
        )
        clearSubmittedDraft()
        return { delivery: "queued", status: "accepted" }
      }
      const result = await sendNow({
        afterOptimisticSubmit: clearSubmittedDraft,
        attachments,
        contextMentions: effectiveContextMentions,
        mode,
        model,
        permissionMode,
        reasoningLevel,
        text,
      })
      if (chatSendAccepted(result)) {
        releaseActiveQueue()
        clearComposerDraft(draftKey)
      }
      return result
    },
    [
      activeComposerDraftKey,
      activeChatSessionId,
      activeChatTurnState,
      activeProjectContext,
      clearComposerDraft,
      organizationSkills.chatContextSkills,
      pinnedKnowledgeMentions,
      queueActiveMessage,
      releaseActiveQueue,
      sendNow,
      sessionScope,
    ],
  )

  const handleAnswerQuestion = React.useCallback(
    (requestId: string, answers: string[][]): Promise<void> =>
      activeChatSessionId ? answerQuestion(activeChatSessionId, requestId, answers) : Promise.resolve(),
    [activeChatSessionId, answerQuestion],
  )

  const handleAnswerPermission = React.useCallback(
    (requestId: string, reply: ChatPermissionReply): Promise<void> =>
      activeChatSessionId ? answerPermission(activeChatSessionId, requestId, reply) : Promise.resolve(),
    [activeChatSessionId, answerPermission],
  )

  const handleRejectQuestion = React.useCallback(
    (requestId: string): Promise<void> =>
      activeChatSessionId ? rejectQuestion(activeChatSessionId, requestId) : Promise.resolve(),
    [activeChatSessionId, rejectQuestion],
  )

  const handleAuthorize = React.useCallback(
    (auth: AuthorizationInfo, source?: ChatTurnRetrySource): void => {
      // R5 闭环：打开聊天内连接抽屉并定位该 provider；记录原 action，待用户完成授权后自动重试。
      const createdAt = Date.now()
      const authIntent: ConnectionAuthIntent = {
        action: auth.action,
        createdAt,
        displayName: auth.displayName,
        errorCode: auth.errorCode,
        id: `${auth.service}:${auth.action ?? ""}:${createdAt}`,
        message: auth.message,
        service: auth.service,
        source: "chat",
      }
      setChatConnectionDrawers((current) => ({
        ...current,
        [activeComposerDraftKey]: {
          authIntent,
          open: true,
          selectedService: auth.service,
        },
      }))
      if (activeChatSessionId && sessionScope && source && (source.text || source.attachments.length > 0)) {
        const retryKey = chatTurnInputKey(source)
        const storedOptions = turnRetryOptionsBySession.current.get(activeChatSessionId)?.get(retryKey)
        prepareRetry({
          drawerKey: activeComposerDraftKey,
          sessionId: activeChatSessionId,
          service: auth.service,
          text: source.text,
          attachments: source.attachments,
          contextMentions:
            storedOptions?.contextMentions ?? lastContextMentionsBySession.current.get(activeChatSessionId),
          organizationSkills: storedOptions?.organizationSkills ?? organizationSkills.chatContextSkills,
          projectContext: storedOptions?.projectContext ?? activeProjectContext,
          model: storedOptions?.model ?? lastModelBySession.current.get(activeChatSessionId),
          reasoningLevel: storedOptions?.reasoningLevel ?? lastReasoningLevelBySession.current.get(activeChatSessionId),
          sessionScope: storedOptions?.sessionScope ?? sessionScope,
          mode: storedOptions?.mode ?? lastModeBySession.current.get(activeChatSessionId),
          permissionMode:
            storedOptions?.permissionMode ??
            lastPermissionModeBySession.current.get(activeChatSessionId) ??
            displayedPermissionMode,
        })
      }
    },
    [
      activeComposerDraftKey,
      activeProjectContext,
      activeChatSessionId,
      displayedPermissionMode,
      organizationSkills.chatContextSkills,
      prepareRetry,
      sessionScope,
    ],
  )
  const handleRetryFresh = React.useCallback(
    async (source: ChatTurnRetrySource): Promise<void> => {
      if (!activeChatSessionId || !sessionScope) {
        throw new Error("A current task and workspace are required for a clean-context retry")
      }
      const retryKey = chatTurnInputKey(source)
      const storedOptions = turnRetryOptionsBySession.current.get(activeChatSessionId)?.get(retryKey)
      const retryScope = storedOptions?.sessionScope ?? sessionScope
      const projectContext = storedOptions?.projectContext ?? activeProjectContext
      const model = storedOptions?.model ?? lastModelBySession.current.get(activeChatSessionId)
      const reasoningLevel =
        storedOptions?.reasoningLevel ?? lastReasoningLevelBySession.current.get(activeChatSessionId)
      const mode = storedOptions?.mode ?? lastModeBySession.current.get(activeChatSessionId)
      const permissionMode =
        storedOptions?.permissionMode ??
        lastPermissionModeBySession.current.get(activeChatSessionId) ??
        displayedPermissionMode
      const contextMentions =
        storedOptions?.contextMentions ?? lastContextMentionsBySession.current.get(activeChatSessionId) ?? []
      const retryOrganizationSkills = storedOptions?.organizationSkills ?? organizationSkills.chatContextSkills
      const titleInput = { ...buildSessionTitleInput([], source.text, source.attachments), model }
      const fallbackTitle = buildFallbackSessionTitle(titleInput)
      const session = await create(fallbackTitle, projectContext?.id ?? activeProject?.id)

      titleGeneration.rememberAutoFallbackTitle(session.id, fallbackTitle)
      persistPermissionMode(session.id, permissionMode)
      persistKnowledgeBaseIds(session.id, activeKnowledgeBaseIds)
      setSelectedSessionId(session.id)
      setIsDraftSession(false)
      setPendingChatTransition(null)
      setSidebarSegment(session.projectId ? "projects" : "tasks")
      setRoute("chat")
      await send(session.id, source.text, source.attachments, {
        contextMentions,
        mode,
        model,
        organizationSkills: retryOrganizationSkills,
        permissionMode,
        projectContext,
        reasoningLevel,
        sessionScope: retryScope,
      })
    },
    [
      activeChatSessionId,
      activeKnowledgeBaseIds,
      activeProject?.id,
      activeProjectContext,
      create,
      displayedPermissionMode,
      organizationSkills.chatContextSkills,
      persistKnowledgeBaseIds,
      persistPermissionMode,
      send,
      sessionScope,
      titleGeneration,
    ],
  )
  const handleOpenSearch = React.useCallback((): void => setSearchOpen(true), [])
  const handleChatStop = React.useCallback(async (): Promise<void> => {
    if (activeChatSessionId) {
      await stop(activeChatSessionId)
    }
  }, [activeChatSessionId, stop])
  const handleOpenConnectionsCommand = React.useCallback((): void => {
    handleOpenConnections()
    void connections.refresh({ forceRefresh: true })
  }, [connections.refresh, handleOpenConnections])
  const handleOpenSettingsCommand = React.useCallback((): void => {
    setSearchOpen(false)
    setRoute("settings")
  }, [])
  const handleStopGenerationCommand = React.useCallback((): void => {
    void handleChatStop()
  }, [handleChatStop])
  useAppShellCommands({
    appUpdate,
    onFocusComposer: requestComposerFocus,
    onNewChat: handleNewSessionWithKnowledgeReset,
    onOpenConnections: handleOpenConnectionsCommand,
    onOpenSearch: handleOpenSearch,
    onOpenSettings: handleOpenSettingsCommand,
    onStopGeneration: handleStopGenerationCommand,
    onToggleSidebar: handleToggleSidebar,
  })
  const handlePermissionModeChange = React.useCallback(
    (mode: AgentPermissionMode): void => {
      if (activeChatSessionId) {
        setAndPersistPermissionMode(activeChatSessionId, mode)
        return
      }
      setDraftPermissionMode(mode)
    },
    [activeChatSessionId, setAndPersistPermissionMode],
  )

  const handleViewBilling = React.useCallback((target?: BillingDetailsTarget) => {
    setBillingInitialTarget(target ?? null)
    setRoute("billing")
  }, [])
  const handleStartKnowledgeChat = React.useCallback(
    (item: KnowledgeBaseSummary): void => {
      handleNewTaskSession()
      setDraftKnowledgeBaseIds([item.id])
    },
    [handleNewTaskSession],
  )
  const handleToggleKnowledgeBaseReference = React.useCallback(
    (id: string): void => {
      const nextIds = activeKnowledgeBaseIds.includes(id)
        ? activeKnowledgeBaseIds.filter((item) => item !== id)
        : [...activeKnowledgeBaseIds, id]
      if (activeChatSessionId) persistKnowledgeBaseIds(activeChatSessionId, nextIds)
      else setDraftKnowledgeBaseIds(nextIds)
    },
    [activeChatSessionId, activeKnowledgeBaseIds, persistKnowledgeBaseIds],
  )
  const handleAddKnowledgeBaseReference = React.useCallback(
    (id: string): void => {
      if (activeKnowledgeBaseIds.includes(id)) return
      const nextIds = [...activeKnowledgeBaseIds, id]
      if (activeChatSessionId) persistKnowledgeBaseIds(activeChatSessionId, nextIds)
      else setDraftKnowledgeBaseIds(nextIds)
    },
    [activeChatSessionId, activeKnowledgeBaseIds, persistKnowledgeBaseIds],
  )
  const pinnedKnowledgeContextBar = React.useMemo(
    () =>
      activeKnowledgeBases.length > 0 ? (
        <KnowledgeContextBar
          activeItems={activeKnowledgeBases}
          items={knowledgeLibrary.items}
          queuedMessageCount={activeQueuedMessages.length}
          onOpenLibrary={() => setRoute("knowledge")}
          onToggle={handleToggleKnowledgeBaseReference}
        />
      ) : null,
    [activeKnowledgeBases, activeQueuedMessages.length, handleToggleKnowledgeBaseReference, knowledgeLibrary.items],
  )
  const handleOpenOrganizations = React.useCallback(() => setRoute("organizations"), [])
  const showArtifactsToggle = route === "chat" && hasPanelSelection && !artifactsPanelVisible
  const ArtifactsToggleIcon = artifactsPanelOpen ? PanelRightClose : PanelRightOpen
  const artifactsToggleLabel = artifactsPanelOpen ? t("artifacts.collapse") : t("artifacts.expand")
  const billingWorkspaceCacheScope = organizationWorkspace.activeWorkspace.organizationId
    ? `organization:${organizationWorkspace.activeWorkspace.organizationId}`
    : "workspace-loading"
  const billingCacheScope = `${auth.state?.account?.id ?? "authenticated"}:${billingWorkspaceCacheScope}`
  const billingRequestScope = React.useMemo(
    () => billingRequestScopeForWorkspace(organizationWorkspace.activeWorkspace),
    [organizationWorkspace.activeWorkspace],
  )
  const newChatShortcut = appCommandShortcutLabel(APP_COMMANDS.newChat)
  const newChatLabel = labelWithShortcut(
    sidebarSegment === "projects" && activeProject ? t("project.newTask") : t("sidebar.newSession"),
    newChatShortcut,
  )
  const composerProjectContext = React.useMemo(
    () =>
      showComposerProjectContext ? (
        <ProjectContextBar
          activeProject={activeProject}
          disabled={!ready || Boolean(activeChatSessionId && isSessionRunning(activeChatSessionId))}
          gitError={projectGit.error}
          gitLoading={projectGit.loading}
          gitState={projectGit.state}
          projects={visibleProjects}
          onCheckoutBranch={projectGit.checkoutBranch}
          onCreateAndCheckoutBranch={projectGit.createAndCheckoutBranch}
          onCreateProject={() => void handleSelectComposerProjectFolder()}
          onRefreshGit={projectGit.refresh}
          onSelectProject={handleSelectComposerProject}
        />
      ) : null,
    [
      activeChatSessionId,
      activeProject,
      handleSelectComposerProject,
      handleSelectComposerProjectFolder,
      isSessionRunning,
      projectGit.checkoutBranch,
      projectGit.createAndCheckoutBranch,
      projectGit.error,
      projectGit.loading,
      projectGit.refresh,
      projectGit.state,
      ready,
      showComposerProjectContext,
      visibleProjects,
    ],
  )

  if (route === "settings") {
    return (
      <React.Suspense fallback={<RouteLoadingFallback />}>
        <SettingsRoute
          update={appUpdate}
          titlebarActions={<AppUpdateTitlebarEntry update={appUpdate} />}
          onBack={() => setRoute("chat")}
        />
      </React.Suspense>
    )
  }

  if (route === "billing") {
    return (
      <React.Suspense fallback={<RouteLoadingFallback />}>
        <BillingRoute
          cacheScope={billingCacheScope}
          initialTarget={billingInitialTarget}
          sharedConnectorCount={sharedConnectorCount}
          titlebarActions={<AppUpdateTitlebarEntry update={appUpdate} />}
          workspace={organizationWorkspace.activeWorkspace}
          onBack={() => setRoute("chat")}
        />
      </React.Suspense>
    )
  }

  if (route === "archived") {
    return (
      <React.Suspense fallback={<RouteLoadingFallback />}>
        <ArchivedRoute
          listArchived={listArchived}
          onBack={() => setRoute("chat")}
          onOpenSession={(session) => {
            setSelectedSessionId(session.id)
            setIsDraftSession(false)
            setPendingChatTransition(null)
            setRoute("chat")
            setSidebarSegment(session.projectId ? "projects" : "tasks")
          }}
          refreshSessions={refreshSessions}
          removeSession={removeSession}
          ready={ready}
          titlebarActions={<AppUpdateTitlebarEntry update={appUpdate} />}
          unarchiveSession={unarchive}
        />
      </React.Suspense>
    )
  }

  return (
    <div
      ref={appChromeRef}
      className={cn(
        "oo-app-chrome grid h-full text-foreground",
        sidebarCollapsed && "oo-sidebar-collapsed",
        isSidebarRestoring && "oo-sidebar-restoring",
        isSidebarResizing && "oo-sidebar-resizing",
        isArtifactsPanelResizing && "oo-artifacts-panel-resizing",
      )}
      style={{ "--sidebar-width": `${sidebarWidth}px` } as React.CSSProperties}
    >
      <AppShellNavigationSidebar
        accountName={auth.state?.account?.name}
        activeRoute={route}
        selectedSessionId={selectedSessionId}
        avatarUrl={auth.state?.account?.avatarUrl}
        collapsed={sidebarCollapsed}
        collapsedProjectIds={collapsedProjectIds}
        hasUnreadSession={hasUnreadSession}
        isSessionRunning={isSessionRunning}
        loggingOut={auth.loggingOut}
        newChatLabel={newChatLabel}
        projectPinnedGroups={projectPinnedGroups}
        projectPinnedSessions={projectPinnedSessions}
        projectRegularGroups={projectRegularGroups}
        projectSessions={visibleProjectSessions}
        projectSidebarGroups={projectSidebarGroups}
        sessionsError={sessionsError}
        showKnowledge={knowledgeBaseBetaEnabled}
        sidebarSegment={sidebarSegment}
        sidebarSessionGroups={sidebarSessionGroups}
        taskSessions={visibleTaskSessions}
        width={sidebarWidth}
        workspace={organizationWorkspace}
        workspaceSwitching={workspaceNavigationSwitching}
        onArchiveProjectRequest={projectActions.requestArchive}
        onArchiveSessionRequest={sessionActions.requestArchive}
        onLogout={() => void auth.logout()}
        onNavigate={setRoute}
        onNewSession={handleNewSessionWithKnowledgeReset}
        onOpenConnections={() => handleOpenConnections()}
        onOpenSearch={handleOpenSearch}
        onPinProject={(project) => void projectActions.handlePin(project)}
        onPinSession={(session) => void sessionActions.handlePin(session)}
        onProjectExpandedChange={handleProjectSidebarExpandedChange}
        onRemoveProjectRequest={projectActions.requestRemove}
        onRenameProjectRequest={projectActions.requestRename}
        onWorkspaceSwitchStart={handleWorkspaceSwitchStart}
        onRenameSessionRequest={sessionActions.requestRename}
        onSelectProjectDraft={handleOpenProjectDraft}
        onSelectProjectFolder={() => void handleSelectProjectFolder()}
        onSelectSession={handleSelectSession}
        onSetSidebarSegment={setSidebarSegment}
        onShowProjectInFolder={projectActions.handleShowInFolder}
        onSidebarResizeKeyDown={handleSidebarResizeKeyDown}
        onSidebarResizeStart={handleSidebarResizeStart}
        onToggleSidebar={handleToggleSidebar}
      />

      {/* 右：主区（顶部工具条 + 内容） */}
      <div className="flex min-h-0 min-w-0 overflow-hidden">
        <div
          className={cn(
            "grid min-w-0 flex-1 grid-rows-[var(--app-titlebar-height)_minmax(0,1fr)] overflow-hidden",
            artifactsPanelIsMaximized && "hidden",
          )}
        >
          <AppShellMainTitlebar
            activeSession={activeSession ?? null}
            appUpdate={appUpdate}
            artifactsPanelOpen={artifactsPanelOpen}
            artifactsToggleIcon={ArtifactsToggleIcon}
            artifactsToggleLabel={artifactsToggleLabel}
            billingCacheScope={billingCacheScope}
            isSidebarRestoring={isSidebarRestoring}
            sharedConnectorCount={sharedConnectorCount}
            showArtifactsToggle={showArtifactsToggle}
            sidebarCollapsed={sidebarCollapsed}
            titlebarEditable={titlebarEditable}
            titlebarTitle={titlebarTitle}
            workspace={organizationWorkspace.activeWorkspace}
            onArtifactsToggle={() => setArtifactsPanelOpen((open) => !open)}
            onOpenSearch={handleOpenSearch}
            onRenameSession={sessionActions.handleRename}
            onToggleSidebar={handleToggleSidebar}
            onViewBilling={handleViewBilling}
          />

          <main className="oo-content-surface min-h-0 min-w-0 overflow-hidden">
            <React.Suspense fallback={<RouteLoadingFallback />}>
              {route === "connections" ? (
                <div className="h-full min-h-0 p-0">
                  <ConnectionsPanel
                    connections={connections}
                    requestedFilter={connectionCatalogFilter}
                    selectedService={selectedService}
                  />
                </div>
              ) : route === "skills" ? (
                <SkillsRoute
                  connectedProviders={activeProviders}
                  connectedProvidersLoading={activeProvidersLoading}
                  organizationSkills={organizationSkills}
                  workspace={organizationWorkspace}
                />
              ) : route === "knowledge" && knowledgeBaseBetaEnabled ? (
                <KnowledgeRoute knowledge={knowledgeLibrary} onStartChat={handleStartKnowledgeChat} />
              ) : route === "organizations" ? (
                <OrganizationManagementRoute
                  connectedProviders={activeProviders}
                  connectedProvidersLoading={activeProvidersLoading}
                  organizationSkills={organizationSkills}
                  workspace={organizationWorkspace}
                />
              ) : (
                <div className="flex h-full min-h-0 overflow-hidden">
                  <div className="min-w-0 flex-1 overflow-hidden">
                    <ChatArea
                      activeSessionId={activeChatSessionId}
                      billingCacheScope={billingCacheScope}
                      billingRequestScope={billingRequestScope}
                      composerDraftKey={activeComposerDraftKey}
                      messages={bridgeInitialSendPending ? [] : messages}
                      knowledgeBaseIds={activeKnowledgeBaseIds}
                      knowledgeEnabled={knowledgeBaseBetaEnabled}
                      knowledgeError={knowledgeLibrary.error}
                      knowledgeItems={knowledgeLibrary.items}
                      knowledgeLoading={knowledgeLibrary.loading}
                      permissionMode={displayedPermissionMode}
                      pendingPermissions={bridgeInitialSendPending ? [] : pendingPermissions}
                      pendingQuestions={bridgeInitialSendPending ? [] : pendingQuestions}
                      status={displayedStatus}
                      activity={bridgeInitialSendPending ? null : activity}
                      showEmptyState={showChatEmptyState}
                      bootstrapping={chatBootstrapping}
                      startupError={startupError}
                      error={error}
                      emptyTitle={chatEmptyTitle}
                      generatedArtifacts={latestArtifactSelection}
                      submitDisabled={!ready || chatBootstrapping || workspaceActivationBlocked || !sessionScope}
                      willQueueMessage={Boolean(
                        activeChatSessionId && (!chatTurnAllowsDirectSend(activeChatTurnState) || isSendInFlight()),
                      )}
                      initialComposerState={initialComposerState}
                      initialSendPending={initialSendPending}
                      composerFocusRequest={composerFocusRequest}
                      canManageWorkspaceConnections={canManageWorkspaceConnections}
                      emptyStateConnectionSummary={emptyStateConnectionSummary}
                      organizationSkillEntryVisible={organizationSkillEntryVisible}
                      organizationSkillShowcaseItems={organizationSkillShowcaseItems}
                      organizationSkillPendingInstallCount={recommendedSkillPendingInstallCount}
                      organizationSkills={organizationSkills.chatContextSkills}
                      providers={activeProviders}
                      queueHeld={activeQueueHeld}
                      queuedMessages={activeQueuedMessages}
                      contextBar={composerProjectContext}
                      pinnedContextBar={pinnedKnowledgeContextBar}
                      placeholder={
                        startupError
                          ? t("error.agent.title")
                          : ready
                            ? t("chat.inputPlaceholder")
                            : t("chat.agentStarting")
                      }
                      onComposerStateChange={handleComposerStateChange}
                      onSend={handleSend}
                      onAnswerQuestion={handleAnswerQuestion}
                      onAnswerPermission={handleAnswerPermission}
                      onPermissionModeChange={handlePermissionModeChange}
                      onRejectQuestion={handleRejectQuestion}
                      questionDrafts={questionDrafts}
                      onStop={handleChatStop}
                      onQueuedMessageMove={handleQueuedMessageMove}
                      onQueuedMessageRemove={handleQueuedMessageRemove}
                      onQueuedMessageResume={handleQueuedMessageResume}
                      onAuthorize={handleAuthorize}
                      onRetryFresh={handleRetryFresh}
                      onArtifactsOpen={handleArtifactsOpen}
                      onArtifactsAvailable={handleArtifactsAvailable}
                      onTurnOutputOpen={handleTurnOutputOpen}
                      onTurnOutputAvailable={handleTurnOutputAvailable}
                      onOpenConnections={handleOpenConnections}
                      onOpenConnectionProvider={handleOpenChatConnectionProvider}
                      onOpenKnowledgeLibrary={() => setRoute("knowledge")}
                      onOpenOrganizations={handleOpenOrganizations}
                      onSelectKnowledgeBase={handleAddKnowledgeBaseReference}
                      onViewBilling={handleViewBilling}
                    />
                  </div>
                  <AppShellConnectionDrawer
                    authIntent={chatConnectionAuthIntent}
                    connections={connections}
                    selectedService={chatConnectionSelectedService}
                    visible={chatConnectionDrawerVisible}
                    onClose={handleCloseChatConnectionDrawer}
                  />
                </div>
              )}
            </React.Suspense>
          </main>
        </div>

        <AppShellArtifactsPanel
          artifactSelection={artifactSelection}
          artifactsPanelContentRef={artifactsPanelContentRef}
          artifactsPanelIsMaximized={artifactsPanelIsMaximized}
          artifactsPanelMaxWidthState={artifactsPanelMaxWidthState}
          artifactsPanelShellRef={artifactsPanelShellRef}
          artifactsPanelVisible={artifactsPanelVisible}
          handleArtifactsPanelResizeKeyDown={handleArtifactsPanelResizeKeyDown}
          handleArtifactsPanelResizeStart={handleArtifactsPanelResizeStart}
          isArtifactsPanelResizing={isArtifactsPanelResizing}
          setArtifactsPanelMaximizedState={setArtifactsPanelMaximizedState}
          setArtifactsPanelOpen={setArtifactsPanelOpen}
          turnOutputSelection={turnOutputSelection}
          visibleArtifactsPanelWidth={visibleArtifactsPanelWidth}
        />
      </div>

      <AppShellSessionProjectDialogs
        archiveConfirming={sessionActions.archiveConfirming}
        archiveProjectConfirming={projectActions.archiveConfirming}
        archiveProjectTarget={projectActions.archiveTarget}
        archiveSession={sessionActions.archiveTarget}
        openSearch={searchOpen}
        removeProjectConfirming={projectActions.removeConfirming}
        removeProjectTarget={projectActions.removeTarget}
        renameProjectTarget={projectActions.renameTarget}
        renameSession={sessionActions.renameTarget}
        sessions={visibleSessions}
        onArchiveProject={(project) => void projectActions.handleArchive(project)}
        onArchiveSession={(session) => void sessionActions.handleArchive(session)}
        onCloseArchiveProject={projectActions.closeArchive}
        onCloseArchiveSession={sessionActions.closeArchive}
        onCloseRemoveProject={projectActions.closeRemove}
        onCloseRenameProject={projectActions.closeRename}
        onCloseRenameSession={sessionActions.closeRename}
        onCloseSearch={() => setSearchOpen(false)}
        onRemoveProject={(project) => void projectActions.handleRemove(project)}
        onRenameProject={(projectId, name) => void projectActions.handleRename(projectId, name)}
        onRenameSession={sessionActions.handleRename}
        onSearchSelect={(session) => {
          handleSelectSession(session)
          setPendingChatTransition(null)
          setSearchOpen(false)
        }}
      />
    </div>
  )
}
