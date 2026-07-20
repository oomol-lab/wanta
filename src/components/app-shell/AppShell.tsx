import type {
  AgentPermissionMode,
  AgentRuntimeStatus,
  AuthorizationInfo,
  ChatPermissionReply,
} from "../../../electron/chat/common.ts"
import type { ChatErrorKind } from "../../../electron/chat/error.ts"
import type { KnowledgeBaseSummary } from "../../../electron/knowledge/common.ts"
import type { SessionInfo, SessionScope } from "../../../electron/session/common.ts"
import type { ChatSendRequest, ChatSendResult } from "./app-shell-model.ts"
import type { AppShellRoute as Route } from "./app-shell-types.ts"
import type { PendingChatTransition } from "./pending-chat.ts"
import type { SidebarSegment } from "./sidebar-persistence.ts"
import type { ChatConnectionDrawerState } from "./use-chat-connection-retry.ts"
import type { BillingDetailsTarget } from "@/components/app-shell/BillingUsagePopover"
import type { UseAuth } from "@/hooks/useAuth"
import type { KnowledgeBaseIdsUpdate } from "@/hooks/useSessions"
import type { ChatTurnRetrySource } from "@/routes/Chat/chat-turns"
import type { ComposerState } from "@/routes/Chat/composer-state"
import type { ConnectionAuthIntent } from "@/routes/Connections/connection-route-model.ts"
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
  resolveNotificationTeam,
  routeAvailableForRuntime,
  resolveTeamProviderOptionsAvailability,
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
import { isPendingChatCaughtUp, pendingChatTransitionForActiveSession } from "./pending-chat.ts"
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
import { AppUpdateReadyDialog } from "@/components/AppUpdateReadyDialog"
import { AppUpdateTitlebarEntry } from "@/components/AppUpdateTitlebarEntry"
import { useAppSettings } from "@/hooks/useAppSettings"
import { useAppUpdate } from "@/hooks/useAppUpdate"
import { useAttention } from "@/hooks/useAttention"
import { useChat } from "@/hooks/useChat"
import { useConnections } from "@/hooks/useConnections"
import { useKnowledgeBases } from "@/hooks/useKnowledgeBases"
import { useProjectGit } from "@/hooks/useProjectGit"
import { useRuntimeCapabilities } from "@/hooks/useRuntimeCapabilities"
import { useSessions } from "@/hooks/useSessions"
import { useTeamSkills } from "@/hooks/useTeamSkills"
import { useTeamWorkspace } from "@/hooks/useTeamWorkspace"
import { useT } from "@/i18n/i18n"
import { appCommandShortcutLabel, labelWithShortcut } from "@/lib/app-shortcuts"
import { billingRequestScopeForWorkspace } from "@/lib/billing-scope"
import { reportRendererHandledError } from "@/lib/renderer-diagnostics"
import { resolveUserFacingError, userFacingErrorDescription } from "@/lib/user-facing-error"
import { cn } from "@/lib/utils"
import { releaseAttachmentSnapshots } from "@/routes/Chat/chat-attachment-utils"
import {
  chatTurnAllowsDirectSend,
  chatTurnAllowsStop,
  chatTurnQueuesNewMessage,
  resolveChatTurnState,
} from "@/routes/Chat/chat-turn-state"
import { chatTurnInputKey } from "@/routes/Chat/chat-turns"
import { hasComposerDraftContent, toCachedComposerState } from "@/routes/Chat/composer-state"
import { summarizeEmptyStateConnections } from "@/routes/Chat/empty-state-connections"
import { normalizeConnectionCatalogFilter } from "@/routes/Connections/connection-route-model.ts"

const ArchivedRoute = React.lazy(() =>
  import("@/routes/Archived").then((module) => ({ default: module.ArchivedRoute })),
)
const BillingRoute = React.lazy(() => import("@/routes/Billing").then((module) => ({ default: module.BillingRoute })))
const ChatArea = React.lazy(() => import("@/routes/Chat").then((module) => ({ default: module.ChatArea })))
const ConnectionsPanel = React.lazy(() =>
  import("@/routes/Connections").then((module) => ({ default: module.ConnectionsPanel })),
)
const TeamManagementRoute = React.lazy(() =>
  import("@/routes/Skills/TeamManagement").then((module) => ({ default: module.TeamManagementRoute })),
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
  const runtimeCapabilities = useRuntimeCapabilities().capabilities
  const authenticated = auth.state?.status === "authenticated"
  const cloudEnabled = authenticated && runtimeCapabilities?.mode === "oomol"
  React.useEffect(() => {
    if (auth.error?.kind === "auth_required") {
      toast.info(userFacingErrorDescription(auth.error, t), { id: "auth-session-expired" })
    }
  }, [auth.error, t])
  const [ready, setReady] = React.useState(false)
  const [billingInitialTarget, setBillingInitialTarget] = React.useState<BillingDetailsTarget | null>(null)
  const [agentStatus, setAgentStatus] = React.useState<AgentRuntimeStatus>({ status: "starting" })
  const accountId = cloudEnabled ? auth.state?.account?.id : undefined
  const teamWorkspace = useTeamWorkspace(accountId)
  const teamSkills = useTeamSkills(teamWorkspace.activeWorkspace, accountId)
  const skillInventory = useSkillInventoryResource()
  const knowledgeBaseBetaEnabled = appSettings.settings.knowledgeBaseBetaEnabled
  const knowledgeLibrary = useKnowledgeBases(knowledgeBaseBetaEnabled)
  const connections = useConnections(cloudEnabled ? teamWorkspace.connectionWorkspace : null)
  const sessionScope = React.useMemo(
    () => sessionScopeFromWorkspace(teamWorkspace.activeWorkspace),
    [teamWorkspace.activeWorkspace],
  )
  const sessionsEnabled = sessionScope !== null
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
  const currentConnectionWorkspaceKey = teamWorkspace.connectionWorkspace
    ? connectionWorkspaceSwitchKey(teamWorkspace.connectionWorkspace)
    : null
  const activeWorkspaceKey = workspaceSelectionSwitchKey(teamWorkspace.activeWorkspace)
  const activeTeamId = teamWorkspace.activeWorkspace.teamId || null
  const activeTeamSkillsMatched = teamSkills.teamId === activeTeamId
  const teamSkillsSettled =
    !activeTeamId ||
    (activeTeamSkillsMatched && !teamSkills.loading && (teamSkills.hasLoaded || Boolean(teamSkills.error)))
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
      cloudWorkspaceRequired: cloudEnabled,
      currentScopeKey,
      loadedSessionScopeKey: sessionsLoadedScopeKey,
      teamSkillsSettled,
      workspaceMetadataError: teamWorkspace.error,
    },
    activeWorkspaceKey,
    hasLoadedTeams: teamWorkspace.hasLoaded,
    loadingTeams: teamWorkspace.loading,
    teamIds: teamWorkspace.teams.map((team) => team.id),
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
  React.useEffect(() => {
    if (!routeAvailableForRuntime(route, cloudEnabled)) {
      setRoute("chat")
    }
  }, [cloudEnabled, route])
  const [selectedSessionId, setSelectedSessionId] = React.useState<string | null>(null)
  const [pendingAttentionSession, setPendingAttentionSession] = React.useState<{
    teamRefreshAttempted: boolean
    teamId?: string
    sessionRefreshAttempted: boolean
    sessionId: string
  } | null>(null)
  const pendingAttentionRefreshesRef = React.useRef(new Set<string>())
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
  React.useEffect(() => {
    if (!knowledgeBaseBetaEnabled || knowledgeLibrary.loading || knowledgeLibrary.error) return
    const availableIds = new Set(knowledgeLibrary.items.map((item) => item.id))
    setDraftKnowledgeBaseIds((current) => {
      const next = current.filter((id) => availableIds.has(id))
      return next.length === current.length ? current : next
    })
  }, [knowledgeBaseBetaEnabled, knowledgeLibrary.error, knowledgeLibrary.items, knowledgeLibrary.loading])
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
    sessionSnapshotError,
    error,
    forgetSession: forgetChatSession,
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
    resetSessionCache: resetChatSessionCache,
    retrySessionSnapshot,
  } = useChat(activeChatSessionId, activeWorkspaceKey)
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
      attentionService.serverEvents.on("openSessionRequested", ({ teamId, sessionId }) => {
        setPendingAttentionSession({
          teamRefreshAttempted: false,
          sessionRefreshAttempted: false,
          sessionId,
          ...(teamId ? { teamId } : {}),
        })
        setRoute("chat")
      }),
    [attentionService],
  )

  React.useEffect(() => {
    const teamId = pendingAttentionSession?.teamId
    if (!pendingAttentionSession || !teamId || teamId === activeTeamId) {
      return
    }

    const resolution = resolveNotificationTeam({
      activeTeamId,
      hasLoaded: teamWorkspace.hasLoaded,
      loading: teamWorkspace.loading,
      teamIds: teamWorkspace.teams.map((team) => team.id),
      refreshAttempted: pendingAttentionSession.teamRefreshAttempted,
      targetTeamId: teamId,
    })

    if (resolution === "select") {
      handleWorkspaceSwitchStart(`team:${teamId}`)
      teamWorkspace.selectTeam(teamId)
      return
    }
    if (resolution === "wait" || resolution === "ready") {
      return
    }
    if (resolution === "refresh") {
      setPendingAttentionSession((current) =>
        current?.sessionId === pendingAttentionSession.sessionId ? { ...current, teamRefreshAttempted: true } : current,
      )
      void teamWorkspace.refresh({ forceRefresh: true }).catch((error: unknown) => {
        reportRendererHandledError("attention", "refresh notification team failed", error)
      })
      return
    }

    setPendingAttentionSession(null)
    toast.error(t("sidebar.notificationTeamUnavailable"))
    void attentionService.invoke("markSessionViewed", pendingAttentionSession.sessionId).catch((error: unknown) => {
      reportRendererHandledError("attention", "clear inaccessible notification session failed", error)
    })
  }, [
    activeTeamId,
    attentionService,
    handleWorkspaceSwitchStart,
    teamWorkspace.hasLoaded,
    teamWorkspace.loading,
    teamWorkspace.teams,
    teamWorkspace.refresh,
    teamWorkspace.selectTeam,
    pendingAttentionSession,
    t,
  ])

  React.useEffect(() => {
    if (
      !pendingAttentionSession ||
      (pendingAttentionSession.teamId && pendingAttentionSession.teamId !== activeTeamId) ||
      !sessionsSettledForCurrentScope
    ) {
      return
    }
    const session = visibleSessions.find((candidate) => candidate.id === pendingAttentionSession.sessionId)
    if (!session) {
      if (!pendingAttentionSession.sessionRefreshAttempted) {
        if (pendingAttentionRefreshesRef.current.has(pendingAttentionSession.sessionId)) {
          return
        }
        pendingAttentionRefreshesRef.current.add(pendingAttentionSession.sessionId)
        void refreshSessions()
          .catch((error: unknown) => {
            reportRendererHandledError("attention", "refresh notification session failed", error)
          })
          .finally(() => {
            pendingAttentionRefreshesRef.current.delete(pendingAttentionSession.sessionId)
            setPendingAttentionSession((current) =>
              current?.sessionId === pendingAttentionSession.sessionId
                ? { ...current, sessionRefreshAttempted: true }
                : current,
            )
          })
        return
      }
      setPendingAttentionSession(null)
      void attentionService.invoke("markSessionViewed", pendingAttentionSession.sessionId).catch((error: unknown) => {
        reportRendererHandledError("attention", "clear unavailable notification session failed", error)
      })
      return
    }
    setSidebarSegment(session.projectId ? "projects" : "tasks")
    setSelectedSessionId(session.id)
    setIsDraftSession(false)
    setPendingChatTransition(null)
    setPendingAttentionSession(null)
    void attentionService.invoke("markSessionViewed", session.id).catch((error: unknown) => {
      reportRendererHandledError("attention", "mark routed notification session viewed failed", error)
    })
  }, [
    activeTeamId,
    attentionService,
    pendingAttentionSession,
    refreshSessions,
    sessionsSettledForCurrentScope,
    visibleSessions,
  ])
  const connectionSummaryMatchesWorkspace =
    Boolean(currentConnectionWorkspaceKey) && connections.summaryWorkspaceKey === currentConnectionWorkspaceKey
  const activeProvidersLoading =
    Boolean(currentConnectionWorkspaceKey) &&
    !connectionSummaryMatchesWorkspace &&
    !workspaceActivationHasFailed(workspaceActivationState)
  const activeProviders = connectionSummaryMatchesWorkspace
    ? (connections.summary?.providers ?? EMPTY_CONNECTION_PROVIDERS)
    : EMPTY_CONNECTION_PROVIDERS
  const teamProviderOptionsAvailability = resolveTeamProviderOptionsAvailability({
    appsStatus: connections.summary?.appsStatus,
    summaryMatchesWorkspace: connectionSummaryMatchesWorkspace,
    workspaceActivationFailed: workspaceActivationHasFailed(workspaceActivationState),
  })
  const activeTeamProviderOptions = React.useMemo(
    () =>
      teamProviderOptionsAvailability === "ready"
        ? activeProviders
            .filter((provider) => provider.apps.some((app) => app.status !== "disconnected"))
            .map((provider) => ({ label: provider.displayName, service: provider.service }))
            .sort((left, right) => left.label.localeCompare(right.label))
        : teamProviderOptionsAvailability === "pending"
          ? undefined
          : null,
    [activeProviders, teamProviderOptionsAvailability],
  )
  const {
    entryVisible: teamSkillEntryVisible,
    pendingInstallCount: recommendedSkillPendingInstallCount,
    providerRecommendations: providerSkillRecommendations,
    showcaseItems: teamSkillShowcaseItems,
  } = useAppShellSkillRecommendations({
    activeProviders,
    inventory: skillInventory.data,
    teamSkills,
    route,
  })
  const connectionAppsReady = connectionSummaryMatchesWorkspace && connections.summary?.appsStatus === "ready"
  const sharedConnectorCount = connectionAppsReady ? connections.summary?.connectedProviderCount : undefined
  const emptyStateConnectionSummary = connectionAppsReady
    ? connections.summary
      ? summarizeEmptyStateConnections(connections.summary.providers, connections.summary.connectedProviderCount)
      : null
    : activeProvidersLoading
      ? undefined
      : null
  const canManageWorkspaceConnections = teamWorkspace.activeWorkspace.canManage
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
    void setChatPermissionMode(activeChatSessionId, activeSession.permissionMode ?? "default").catch(
      (cause: unknown) => {
        console.error("[wanta] sync chat permission mode failed", cause)
        reportRendererHandledError("appShell.permissionMode", "Failed to sync session permission mode", cause)
      },
    )
  }, [activeChatSessionId, activeSession?.permissionMode, setChatPermissionMode])

  const persistPermissionMode = React.useCallback(
    async (sessionId: string, mode: AgentPermissionMode): Promise<void> => {
      try {
        await setChatPermissionMode(sessionId, mode)
      } catch (cause) {
        toast.error(userFacingErrorDescription(resolveUserFacingError(cause, { area: "session" }), t))
        throw cause
      }
    },
    [setChatPermissionMode, t],
  )
  const persistKnowledgeBaseIds = React.useCallback(
    (sessionId: string, update: KnowledgeBaseIdsUpdate): void => {
      void setSessionKnowledgeBases(sessionId, update).catch((cause: unknown) => {
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
  const activePendingChatTransition = pendingChatTransitionForActiveSession(
    pendingChatTransition,
    currentScopeKey,
    activeChatSessionId,
  )
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
  const hasRunningSession = visibleSessions.some((session) => isSessionRunning(session.id))
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
  const agentStartupError =
    agentStatus.status === "error" ? resolveUserFacingError(agentStatus.message, { area: "agent" }) : null
  const modelRequired = agentStatus.status === "model_required"
  const workspaceStartupError = workspaceActivationState.status === "failed" ? workspaceActivationState.error : null
  const startupError = agentStartupError ?? workspaceStartupError ?? sessionSnapshotError
  const retryWorkspaceActivation = React.useCallback(() => {
    if (workspaceActivationState.status !== "failed") {
      return
    }
    if (workspaceActivationState.reason === "agent_scope") {
      connections.retryScopeSync()
      return
    }
    void teamWorkspace.refresh({ forceRefresh: true })
  }, [connections.retryScopeSync, teamWorkspace.refresh, workspaceActivationState])
  const hasVisibleLoadedSession = Boolean(activeChatSessionId && messagesLoaded)
  const chatBootstrapping =
    !startupError &&
    !modelRequired &&
    ((!ready && !hasVisibleLoadedSession) ||
      !sessionsSettledForCurrentScope ||
      needsDefaultSessionSelection ||
      Boolean(activeChatSessionId && !messagesLoaded && !activePendingChatTransition))
  const showChatEmptyState =
    (ready || modelRequired) &&
    sessionsSettledForCurrentScope &&
    !activePendingChatTransition &&
    (!activeChatSessionId || (messagesLoaded && messages.length === 0))

  // 统一修复默认选中和失效选中，避免多个 effect 在同一轮分别写入首项与 null。
  React.useLayoutEffect(() => {
    if (!sessionsSettledForCurrentScope || isDraftSession) {
      return
    }
    if (selectedSessionId && selectableSidebarSessions.some((session) => session.id === selectedSessionId)) {
      return
    }
    const fallbackSession = selectableSidebarSessions[0]
    if (fallbackSession) {
      setSelectedSessionId(fallbackSession.id)
      if (selectedSessionId) {
        setDraftProjectId(null)
        setPendingChatTransition(null)
      }
      return
    }
    if (!selectedSessionId || visibleSessions.some((session) => session.id === selectedSessionId)) {
      return
    }
    setSelectedSessionId(null)
    setIsDraftSession(false)
    setDraftProjectId(null)
    setPendingChatTransition(null)
  }, [isDraftSession, selectableSidebarSessions, selectedSessionId, sessionsSettledForCurrentScope, visibleSessions])

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
              : route === "teams"
                ? t("teams.title")
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
    const draft = composerDraftsByKey.current.get(draftKey)
    if (draft) {
      releaseAttachmentSnapshots(draft.attachments)
    }
    composerDraftsByKey.current.delete(draftKey)
  }, [])
  const commitComposerDraft = React.useCallback((draftKey: string): void => {
    composerDraftsByKey.current.delete(draftKey)
  }, [])
  const clearAllComposerDrafts = React.useCallback((): void => {
    for (const draft of composerDraftsByKey.current.values()) {
      releaseAttachmentSnapshots(draft.attachments)
    }
    composerDraftsByKey.current.clear()
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
    releaseTransientFocus,
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
  const {
    forgetSession: forgetComposerSubmissionSession,
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
    resetMemory: resetComposerSubmissionMemory,
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
    teamSkills: teamSkills.chatContextSkills,
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
  const previousQueuedSessionIdRef = React.useRef(activeChatSessionId)
  React.useEffect(() => {
    const previousSessionId = previousQueuedSessionIdRef.current
    if (previousSessionId && previousSessionId !== activeChatSessionId) {
      holdQueuedSessionIfQueued(previousSessionId)
    }
    previousQueuedSessionIdRef.current = activeChatSessionId
  }, [activeChatSessionId, holdQueuedSessionIfQueued])

  const isRetrySessionAvailable = React.useCallback(
    (sessionId: string, scope: SessionScope): boolean =>
      !sessionsSettledForCurrentScope ||
      visibleSessions.some(
        (session) => session.id === sessionId && sessionRecordScopeKey(session.scope) === sessionRecordScopeKey(scope),
      ),
    [sessionsSettledForCurrentScope, visibleSessions],
  )
  const {
    cancelRetryForDrawer,
    clearRetries,
    completeMatchingRetries,
    completeRetryForDrawer,
    forgetSession: forgetConnectionRetrySession,
    prepareRetry,
  } = useChatConnectionRetry({
    isSessionAvailable: isRetrySessionAvailable,
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

  const forgetSessionRuntime = React.useCallback(
    (sessionId: string, draftKey?: string): void => {
      forgetChatSession(sessionId)
      clearQueuedSession(sessionId)
      forgetConnectionRetrySession(sessionId)
      forgetComposerSubmissionSession(sessionId)
      if (draftKey) {
        clearComposerDraft(draftKey)
        setChatConnectionDrawers((current) => {
          if (!Object.hasOwn(current, draftKey)) {
            return current
          }
          const next = { ...current }
          delete next[draftKey]
          return next
        })
      }
      setPendingChatTransition((pending) => (pending?.sessionId === sessionId ? null : pending))
    },
    [
      clearComposerDraft,
      clearQueuedSession,
      forgetChatSession,
      forgetComposerSubmissionSession,
      forgetConnectionRetrySession,
    ],
  )
  const handleSessionArchived = React.useCallback(
    (session: SessionInfo): void => {
      forgetSessionRuntime(
        session.id,
        existingSessionComposerDraftKey(sessionRecordScopeKey(session.scope), session.id),
      )
      if (activeChatSessionId !== session.id) {
        return
      }
      setSelectedSessionId(nextActiveSessionIdAfterArchive(selectableSidebarSessions, session.id))
      setIsDraftSession(false)
      setRoute("chat")
    },
    [activeChatSessionId, forgetSessionRuntime, selectableSidebarSessions],
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
  const archiveProjectWithRuntimeCleanup = React.useCallback(
    async (projectId: string): Promise<void> => {
      const projectSessions = visibleSessions.filter((session) => session.projectId === projectId)
      if (projectSessions.some((session) => isSessionRunning(session.id))) {
        throw resolveUserFacingError(new Error(t("project.archiveRunning")), {
          area: "session",
          preserveMessage: true,
        })
      }
      await archiveProjectAction(projectId)
      for (const session of projectSessions) {
        forgetSessionRuntime(
          session.id,
          existingSessionComposerDraftKey(sessionRecordScopeKey(session.scope), session.id),
        )
      }
    },
    [archiveProjectAction, forgetSessionRuntime, isSessionRunning, t, visibleSessions],
  )
  const projectActions = useProjectActions({
    archiveProject: archiveProjectWithRuntimeCleanup,
    onProjectUnavailable: handleProjectUnavailable,
    pinProject: pinProjectAction,
    projects: visibleProjects,
    removeProject: removeProjectAction,
    renameProject: renameProjectAction,
  })
  const removeSessionWithRuntimeCleanup = React.useCallback(
    async (sessionId: string): Promise<void> => {
      await removeSession(sessionId)
      forgetSessionRuntime(sessionId, existingSessionComposerDraftKey(currentScopeKey, sessionId))
    },
    [currentScopeKey, forgetSessionRuntime, removeSession],
  )
  const handledConnectionReadyEventIdRef = React.useRef<number | null>(null)

  React.useEffect(() => {
    const event = connections.connectionReadyEvent
    if (!event || handledConnectionReadyEventIdRef.current === event.id) {
      return
    }
    handledConnectionReadyEventIdRef.current = event.id
    if (event.workspaceKey !== connections.summaryWorkspaceKey) {
      return
    }
    completeMatchingRetries(event)
  }, [completeMatchingRetries, connections.connectionReadyEvent, connections.summaryWorkspaceKey])

  const handleOpenConnections = React.useCallback(
    (filter?: ConnectionCatalogFilter): void => {
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
      setConnectionCatalogFilter(normalizeConnectionCatalogFilter(filter))
      setRoute("connections")
      void connections.refresh({}, { silent: true })
    },
    [activeComposerDraftKey, cancelRetryForDrawer, connections.refresh],
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
    resetChatSessionCache()
    resetComposerSubmissionMemory()
    clearAllComposerDrafts()
    clearRetries()
    setChatConnectionDrawers({})
    setSelectedService(null)
    setConnectionCatalogFilter({ kind: "all" })
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
    clearAllComposerDrafts,
    clearRetries,
    handleArtifactsReset,
    holdQueuedSessionIfQueued,
    projectActions.resetDialogs,
    resetChatSessionCache,
    resetComposerSubmissionMemory,
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
        commitComposerDraft(draftKey)
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
          teamSkills.chatContextSkills,
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
        commitComposerDraft(draftKey)
      }
      return result
    },
    [
      activeComposerDraftKey,
      activeChatSessionId,
      activeChatTurnState,
      activeProjectContext,
      commitComposerDraft,
      teamSkills.chatContextSkills,
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
        connectionName: auth.connectionName,
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
          connectionName: auth.connectionName,
          text: source.text,
          attachments: source.attachments,
          contextMentions:
            storedOptions?.contextMentions ?? lastContextMentionsBySession.current.get(activeChatSessionId),
          teamSkills: storedOptions?.teamSkills ?? teamSkills.chatContextSkills,
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
      teamSkills.chatContextSkills,
      prepareRetry,
      sessionScope,
    ],
  )
  const handleChatConnectionReady = React.useCallback(
    (target: { service: string; connectionName?: string }): void => {
      completeRetryForDrawer(activeComposerDraftKey, target)
    },
    [activeComposerDraftKey, completeRetryForDrawer],
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
      const retryTeamSkills = storedOptions?.teamSkills ?? teamSkills.chatContextSkills
      const titleInput = { ...buildSessionTitleInput([], source.text, source.attachments), model }
      const fallbackTitle = buildFallbackSessionTitle(titleInput)
      const session = await create(fallbackTitle, projectContext?.id ?? activeProject?.id)

      titleGeneration.rememberAutoFallbackTitle(session.id, fallbackTitle)
      await persistPermissionMode(session.id, permissionMode)
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
        teamSkills: retryTeamSkills,
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
      teamSkills.chatContextSkills,
      persistKnowledgeBaseIds,
      persistPermissionMode,
      send,
      sessionScope,
      titleGeneration,
    ],
  )
  const handleChatErrorRecovery = React.useCallback(
    async (kind: ChatErrorKind, source: ChatTurnRetrySource): Promise<void> => {
      if (kind === "auth_required" || kind === "permission_denied") {
        await auth.login()
        return
      }
      if (!activeChatSessionId || !sessionScope) {
        throw new Error("A current task and workspace are required to retry")
      }
      const retryKey = chatTurnInputKey(source)
      const storedOptions = turnRetryOptionsBySession.current.get(activeChatSessionId)?.get(retryKey)
      await send(activeChatSessionId, source.text, source.attachments, {
        contextMentions:
          storedOptions?.contextMentions ?? lastContextMentionsBySession.current.get(activeChatSessionId) ?? [],
        mode: storedOptions?.mode ?? lastModeBySession.current.get(activeChatSessionId),
        model: storedOptions?.model ?? lastModelBySession.current.get(activeChatSessionId),
        teamSkills: storedOptions?.teamSkills ?? teamSkills.chatContextSkills,
        permissionMode:
          storedOptions?.permissionMode ??
          lastPermissionModeBySession.current.get(activeChatSessionId) ??
          displayedPermissionMode,
        projectContext: storedOptions?.projectContext ?? activeProjectContext,
        reasoningLevel: storedOptions?.reasoningLevel ?? lastReasoningLevelBySession.current.get(activeChatSessionId),
        sessionScope: storedOptions?.sessionScope ?? sessionScope,
      })
    },
    [
      activeChatSessionId,
      activeProjectContext,
      auth,
      displayedPermissionMode,
      teamSkills.chatContextSkills,
      send,
      sessionScope,
    ],
  )
  const handleOpenSearch = React.useCallback((): void => setSearchOpen(true), [])
  const handleChatStop = React.useCallback(async (): Promise<void> => {
    if (activeChatSessionId) {
      await stop(activeChatSessionId)
    }
  }, [activeChatSessionId, stop])
  const handleOpenConnectionsCommand = React.useCallback((): void => {
    if (cloudEnabled) {
      handleOpenConnections()
      return
    }
    void auth.login()
  }, [auth, cloudEnabled, handleOpenConnections])
  const handleOpenSettingsCommand = React.useCallback((): void => {
    setSearchOpen(false)
    setRoute("settings")
  }, [])
  const handleArtifactsToggle = React.useCallback((): void => {
    setArtifactsPanelOpen((open) => !open)
  }, [setArtifactsPanelOpen])
  const handleOpenKnowledgeLibrary = React.useCallback((): void => {
    setRoute("knowledge")
  }, [])
  const handleStopGenerationCommand = React.useCallback((): void => {
    if (chatTurnAllowsStop(activeChatTurnState)) {
      void handleChatStop().catch(() => undefined)
    }
  }, [activeChatTurnState, handleChatStop])
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
        void persistPermissionMode(activeChatSessionId, mode).catch(() => undefined)
        return
      }
      setDraftPermissionMode(mode)
    },
    [activeChatSessionId, persistPermissionMode],
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
      const toggle = (current: string[]): string[] =>
        current.includes(id) ? current.filter((item) => item !== id) : [...current, id]
      if (activeChatSessionId) persistKnowledgeBaseIds(activeChatSessionId, toggle)
      else setDraftKnowledgeBaseIds(toggle)
    },
    [activeChatSessionId, persistKnowledgeBaseIds],
  )
  const handleAddKnowledgeBaseReference = React.useCallback(
    (id: string): void => {
      const add = (current: string[]): string[] => (current.includes(id) ? current : [...current, id])
      if (activeChatSessionId) persistKnowledgeBaseIds(activeChatSessionId, add)
      else setDraftKnowledgeBaseIds(add)
    },
    [activeChatSessionId, persistKnowledgeBaseIds],
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
  const handleOpenTeams = React.useCallback(() => setRoute("teams"), [])
  const showArtifactsToggle = route === "chat" && hasPanelSelection && !artifactsPanelVisible
  const ArtifactsToggleIcon = artifactsPanelOpen ? PanelRightClose : PanelRightOpen
  const artifactsToggleLabel = artifactsPanelOpen ? t("artifacts.collapse") : t("artifacts.expand")
  const billingWorkspaceCacheScope = teamWorkspace.activeWorkspace.teamId
    ? `team:${teamWorkspace.activeWorkspace.teamId}`
    : "workspace-loading"
  const billingCacheScope = `${accountId ?? "local"}:${billingWorkspaceCacheScope}`
  const billingRequestScope = React.useMemo(
    () => billingRequestScopeForWorkspace(teamWorkspace.activeWorkspace),
    [teamWorkspace.activeWorkspace],
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
  const handleArchiveProjectDialog = React.useCallback(
    (project: Parameters<typeof projectActions.handleArchive>[0]): void => {
      void projectActions.handleArchive(project)
    },
    [projectActions.handleArchive],
  )
  const handleArchiveSessionDialog = React.useCallback(
    (session: Parameters<typeof sessionActions.handleArchive>[0]): void => {
      void sessionActions.handleArchive(session)
    },
    [sessionActions.handleArchive],
  )
  const handleCloseSearch = React.useCallback((): void => setSearchOpen(false), [])
  const handleRemoveProjectDialog = React.useCallback(
    (project: Parameters<typeof projectActions.handleRemove>[0]): void => {
      void projectActions.handleRemove(project)
    },
    [projectActions.handleRemove],
  )
  const handleRenameProjectDialog = React.useCallback(
    (projectId: string, name: string): void => {
      void projectActions.handleRename(projectId, name)
    },
    [projectActions.handleRename],
  )
  const handleSearchSelect = React.useCallback(
    (session: SessionInfo): void => {
      handleSelectSession(session)
      setPendingChatTransition(null)
      setSearchOpen(false)
    },
    [handleSelectSession],
  )

  if (route === "settings") {
    return (
      <>
        <React.Suspense fallback={<RouteLoadingFallback />}>
          <SettingsRoute
            update={appUpdate}
            titlebarActions={<AppUpdateTitlebarEntry update={appUpdate} />}
            onBack={() => setRoute("chat")}
          />
        </React.Suspense>
        <AppUpdateReadyDialog busy={hasRunningSession} update={appUpdate} />
      </>
    )
  }

  if (route === "billing" && cloudEnabled) {
    return (
      <>
        <React.Suspense fallback={<RouteLoadingFallback />}>
          <BillingRoute
            cacheScope={billingCacheScope}
            initialTarget={billingInitialTarget}
            sharedConnectorCount={sharedConnectorCount}
            titlebarActions={<AppUpdateTitlebarEntry update={appUpdate} />}
            workspace={teamWorkspace.activeWorkspace}
            onBack={() => setRoute("chat")}
          />
        </React.Suspense>
        <AppUpdateReadyDialog busy={hasRunningSession} update={appUpdate} />
      </>
    )
  }

  if (route === "archived") {
    return (
      <>
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
            removeSession={removeSessionWithRuntimeCleanup}
            ready={ready}
            titlebarActions={<AppUpdateTitlebarEntry update={appUpdate} />}
            unarchiveSession={unarchive}
          />
        </React.Suspense>
        <AppUpdateReadyDialog busy={hasRunningSession} update={appUpdate} />
      </>
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
        authenticated={authenticated}
        activeRoute={route}
        selectedSessionId={selectedSessionId}
        avatarUrl={auth.state?.account?.avatarUrl}
        cloudEnabled={cloudEnabled}
        collapsed={sidebarCollapsed}
        collapsedProjectIds={collapsedProjectIds}
        hasUnreadSession={hasUnreadSession}
        isSessionRunning={isSessionRunning}
        loggingOut={auth.loggingOut}
        loggingIn={auth.loggingIn}
        newChatLabel={newChatLabel}
        projectPinnedGroups={projectPinnedGroups}
        projectPinnedSessions={projectPinnedSessions}
        projectRegularGroups={projectRegularGroups}
        projectSessions={visibleProjectSessions}
        projectSidebarGroups={projectSidebarGroups}
        restoring={isSidebarRestoring}
        sessionsError={sessionsError}
        showKnowledge={knowledgeBaseBetaEnabled}
        sidebarSegment={sidebarSegment}
        sidebarSessionGroups={sidebarSessionGroups}
        taskSessions={visibleTaskSessions}
        width={sidebarWidth}
        workspace={teamWorkspace}
        workspaceSwitching={workspaceNavigationSwitching}
        onArchiveProjectRequest={projectActions.requestArchive}
        onArchiveSessionRequest={sessionActions.requestArchive}
        onLogout={auth.logout}
        onLogin={() => void auth.login()}
        onNavigate={setRoute}
        onNewSession={handleNewSessionWithKnowledgeReset}
        onOpenConnections={handleOpenConnectionsCommand}
        onOpenSearch={handleOpenSearch}
        onPinProject={projectActions.handlePin}
        onPinSession={sessionActions.handlePin}
        onProjectExpandedChange={handleProjectSidebarExpandedChange}
        onRemoveProjectRequest={projectActions.requestRemove}
        onRenameProjectRequest={projectActions.requestRename}
        onWorkspaceSwitchStart={handleWorkspaceSwitchStart}
        onRenameSessionRequest={sessionActions.requestRename}
        onSelectProjectDraft={handleOpenProjectDraft}
        onSelectProjectFolder={handleSelectProjectFolder}
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
            workspace={teamWorkspace.activeWorkspace}
            onArtifactsToggle={handleArtifactsToggle}
            onOpenSearch={handleOpenSearch}
            onRenameSession={sessionActions.handleRename}
            onToggleSidebar={handleToggleSidebar}
            onViewBilling={cloudEnabled ? handleViewBilling : undefined}
          />

          <main className="oo-content-surface min-h-0 min-w-0 overflow-hidden">
            <React.Suspense fallback={<RouteLoadingFallback />}>
              {route === "connections" && cloudEnabled ? (
                <div className="h-full min-h-0 p-0">
                  <ConnectionsPanel
                    canManageConnections={canManageWorkspaceConnections}
                    connections={connections}
                    requestedFilter={connectionCatalogFilter}
                    selectedService={selectedService}
                  />
                </div>
              ) : route === "skills" && cloudEnabled ? (
                <SkillsRoute
                  connectedProvidersLoading={activeProvidersLoading}
                  teamSkills={teamSkills}
                  providerSkillRecommendationsState={providerSkillRecommendations}
                  workspace={teamWorkspace}
                />
              ) : route === "knowledge" && knowledgeBaseBetaEnabled ? (
                <KnowledgeRoute knowledge={knowledgeLibrary} onStartChat={handleStartKnowledgeChat} />
              ) : route === "teams" && cloudEnabled ? (
                <TeamManagementRoute
                  connectedProvidersLoading={activeProvidersLoading}
                  teamSkills={teamSkills}
                  providerOptions={activeTeamProviderOptions}
                  providerSkillRecommendationsState={providerSkillRecommendations}
                  workspace={teamWorkspace}
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
                      knowledgeError={
                        knowledgeLibrary.error ? userFacingErrorDescription(knowledgeLibrary.error, t) : null
                      }
                      knowledgeItems={knowledgeLibrary.items}
                      knowledgeLoading={knowledgeLibrary.loading}
                      modelRequired={modelRequired}
                      permissionMode={displayedPermissionMode}
                      pendingPermissions={bridgeInitialSendPending ? [] : pendingPermissions}
                      pendingQuestions={bridgeInitialSendPending ? [] : pendingQuestions}
                      status={displayedStatus}
                      activity={bridgeInitialSendPending ? null : activity}
                      showEmptyState={showChatEmptyState}
                      bootstrapping={chatBootstrapping}
                      startupError={startupError}
                      onStartupRetry={
                        workspaceStartupError
                          ? retryWorkspaceActivation
                          : sessionSnapshotError
                            ? retrySessionSnapshot
                            : undefined
                      }
                      error={error}
                      emptyTitle={chatEmptyTitle}
                      generatedArtifacts={latestArtifactSelection}
                      historyScope={billingCacheScope}
                      submitDisabled={!ready || chatBootstrapping || workspaceActivationBlocked || !sessionScope}
                      willQueueMessage={Boolean(
                        activeChatSessionId && (!chatTurnAllowsDirectSend(activeChatTurnState) || isSendInFlight()),
                      )}
                      voiceEnabled={runtimeCapabilities?.voice === true}
                      initialComposerState={initialComposerState}
                      initialSendPending={initialSendPending}
                      composerFocusRequest={composerFocusRequest}
                      cloudModelsEnabled={runtimeCapabilities?.oomolCloudModels === true}
                      canManageWorkspaceConnections={cloudEnabled && canManageWorkspaceConnections}
                      emptyStateConnectionSummary={cloudEnabled ? emptyStateConnectionSummary : null}
                      teamSkillEntryVisible={cloudEnabled && teamSkillEntryVisible}
                      teamSkillShowcaseItems={teamSkillShowcaseItems}
                      teamSkillPendingInstallCount={recommendedSkillPendingInstallCount}
                      teamSkills={cloudEnabled ? teamSkills.chatContextSkills : []}
                      providers={cloudEnabled ? activeProviders : []}
                      queueHeld={activeQueueHeld}
                      queuedMessages={activeQueuedMessages}
                      contextBar={composerProjectContext}
                      pinnedContextBar={pinnedKnowledgeContextBar}
                      placeholder={
                        startupError
                          ? t("error.agent.title")
                          : modelRequired
                            ? t("chat.modelRequiredPlaceholder")
                            : ready
                              ? t(cloudEnabled ? "chat.inputPlaceholder" : "chat.inputPlaceholderLocal")
                              : t("chat.agentStarting")
                      }
                      onComposerStateChange={handleComposerStateChange}
                      onLogin={!authenticated ? () => void auth.login() : undefined}
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
                      onRecover={handleChatErrorRecovery}
                      onRetryFresh={handleRetryFresh}
                      onArtifactsOpen={handleArtifactsOpen}
                      onArtifactsAvailable={handleArtifactsAvailable}
                      onTurnOutputOpen={handleTurnOutputOpen}
                      onTurnOutputAvailable={handleTurnOutputAvailable}
                      onOpenConnections={cloudEnabled ? handleOpenConnections : undefined}
                      onOpenConnectionProvider={cloudEnabled ? handleOpenChatConnectionProvider : undefined}
                      onOpenKnowledgeLibrary={handleOpenKnowledgeLibrary}
                      onOpenTeams={cloudEnabled ? handleOpenTeams : undefined}
                      onSelectKnowledgeBase={handleAddKnowledgeBaseReference}
                      onViewBilling={cloudEnabled ? handleViewBilling : undefined}
                    />
                  </div>
                  <AppShellConnectionDrawer
                    authIntent={chatConnectionAuthIntent}
                    canManageConnections={cloudEnabled && canManageWorkspaceConnections}
                    connections={connections}
                    onConnectionReady={handleChatConnectionReady}
                    selectedService={chatConnectionSelectedService}
                    visible={cloudEnabled && chatConnectionDrawerVisible}
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
        onArchiveProject={handleArchiveProjectDialog}
        onArchiveSession={handleArchiveSessionDialog}
        onCloseArchiveProject={projectActions.closeArchive}
        onCloseArchiveSession={sessionActions.closeArchive}
        onCloseRemoveProject={projectActions.closeRemove}
        onCloseRenameProject={projectActions.closeRename}
        onCloseRenameSession={sessionActions.closeRename}
        onCloseSearch={handleCloseSearch}
        onRemoveProject={handleRemoveProjectDialog}
        onRenameProject={handleRenameProjectDialog}
        onRenameSession={sessionActions.handleRename}
        onSearchSelect={handleSearchSelect}
      />
      <AppUpdateReadyDialog busy={hasRunningSession} update={appUpdate} />
    </div>
  )
}
