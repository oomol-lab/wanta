import type { AppCommand } from "../../../electron/app-command.ts"
import type {
  AgentMode,
  AgentPermissionMode,
  AgentRuntimeStatus,
  AuthorizationInfo,
  ChatAttachment,
  ChatContextMention,
  ChatOrganizationSkillContext,
  ChatPermissionReply,
  ChatProjectContext,
  ChatQuestionRequest,
  ReasoningLevel,
} from "../../../electron/chat/common.ts"
import type { ModelChoice } from "../../../electron/models/common.ts"
import type { SessionInfo, SessionProject, SessionScope } from "../../../electron/session/common.ts"
import type { ConnectionAuthIntent } from "./app-shell-connection-drawer-model.ts"
import type { ChatSendRequest, TurnRetryOptions } from "./app-shell-model.ts"
import type { AppShellRoute as Route } from "./app-shell-types.ts"
import type { PendingChatTransition } from "./pending-chat.ts"
import type { SidebarSegment } from "./sidebar-persistence.ts"
import type { ChatTurnRetrySource } from "@/routes/Chat/chat-turns"
import type { ComposerState } from "@/routes/Chat/composer-state"
import type { ChatStatus } from "ai"

import { PanelRightClose, PanelRightOpen } from "lucide-react"
import * as React from "react"
import { toast } from "sonner"
import { APP_COMMANDS } from "../../../electron/app-command.ts"
import { buildFallbackSessionTitle } from "../../../electron/session/title.ts"
import {
  activeProjectIdForComposer,
  AUTH_RETRY_POLL_INTERVAL_MS,
  AUTH_RETRY_POLL_TIMEOUT_MS,
  buildSessionTitleInput,
  connectionWorkspaceSwitchKey,
  EMPTY_CONNECTION_PROVIDERS,
  existingSessionComposerDraftKey,
  getUnlinkedProviderSkillRecommendations,
  initialRoute,
  isWorkspaceSwitchPending,
  newSessionComposerDraftKey,
  newSessionComposerDraftKeyForScopeKey,
  NO_DRAFT_PROJECT_ID,
  projectContextFromProject,
  rememberTurnRetryOptions,
  resolveNewSessionTarget,
  sessionRecordScopeKey,
  sessionScopeFromWorkspace,
  sessionScopeKey,
  shouldClearWorkspaceSwitchTarget,
  shouldShowRecommendedSkillEntry,
  workspaceSelectionSwitchKey,
  WORKSPACE_SWITCH_TIMEOUT_MS,
} from "./app-shell-model.ts"
import { buildProjectSidebarGroups } from "./app-sidebar-model.ts"
import { AppShellArtifactsPanel } from "./AppShellArtifactsPanel.tsx"
import { AppShellConnectionDrawer } from "./AppShellConnectionDrawer.tsx"
import { AppShellMainTitlebar } from "./AppShellMainTitlebar.tsx"
import { AppShellNavigationSidebar } from "./AppShellNavigationSidebar.tsx"
import { AppShellSessionProjectDialogs } from "./AppShellSessionProjectDialogs.tsx"
import { isPendingChatCaughtUp } from "./pending-chat.ts"
import { readStoredSidebarSegment, writeStoredSidebarSegment } from "./sidebar-persistence.ts"
import { groupSidebarSessions, nextActiveSessionIdAfterArchive } from "./sidebar-sessions.ts"
import { useArtifactsPanelState } from "./use-artifacts-panel-state.ts"
import { useChatQueueState } from "./use-chat-queue-state.ts"
import { useProjectSidebarCollapseState } from "./use-project-sidebar-collapse-state.ts"
import { useSessionTitleGeneration } from "./use-session-title-generation.ts"
import { useSidebarChromeState } from "./use-sidebar-chrome-state.ts"
import { ProjectContextBar } from "@/components/app-shell/ProjectContextBar"
import { useChatService } from "@/components/AppContext"
import { useSkillInventoryResource } from "@/components/AppDataHooks"
import { useAppCommandEvents, useAppCommandShortcuts } from "@/hooks/useAppCommandShortcuts"
import { useAuth } from "@/hooks/useAuth"
import { useChat } from "@/hooks/useChat"
import { useConnections } from "@/hooks/useConnections"
import { useOrganizationSkills } from "@/hooks/useOrganizationSkills"
import { useOrganizationWorkspace } from "@/hooks/useOrganizationWorkspace"
import { useProjectGit } from "@/hooks/useProjectGit"
import { useProviderSkillRecommendations } from "@/hooks/useProviderSkillRecommendations"
import { useSessions } from "@/hooks/useSessions"
import { useT } from "@/i18n/i18n"
import { appCommandShortcutLabel, labelWithShortcut } from "@/lib/app-shortcuts"
import { reportRendererHandledError } from "@/lib/renderer-diagnostics"
import { resolveUserFacingError, userFacingErrorDescription } from "@/lib/user-facing-error"
import { cn } from "@/lib/utils"
import { chatTurnInputKey } from "@/routes/Chat/chat-turns"
import { hasComposerDraftContent, toCachedComposerState } from "@/routes/Chat/composer-state"
import { formatQuestionResumeMessage } from "@/routes/Chat/question-resume-message"
import { getInstallableOrganizationSkills } from "@/routes/Skills/skill-route-model"

type ProjectSelectionSource = "composer" | "sidebar"

interface ChatConnectionDrawerState {
  authIntent: ConnectionAuthIntent | null
  open: boolean
  selectedService: string | null
}

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

export function AppShell() {
  const t = useT()
  const chatService = useChatService()
  const auth = useAuth()
  const [ready, setReady] = React.useState(false)
  const [agentStatus, setAgentStatus] = React.useState<AgentRuntimeStatus>({ status: "starting" })
  const organizationWorkspace = useOrganizationWorkspace(auth.state?.account?.id)
  const organizationSkills = useOrganizationSkills(organizationWorkspace.activeWorkspace)
  const skillInventory = useSkillInventoryResource()
  const connections = useConnections(organizationWorkspace.connectionWorkspace)
  const organizationSkillGroupById = React.useMemo(
    () => new Map((skillInventory.data?.groups ?? []).map((group) => [group.id, group])),
    [skillInventory.data?.groups],
  )
  const enabledOrganizationSkills = React.useMemo(
    () => organizationSkills.skills.filter((skill) => skill.enabled),
    [organizationSkills.skills],
  )
  const installableOrganizationSkills = React.useMemo(() => {
    if (!organizationSkills.organizationId || !skillInventory.data) {
      return []
    }
    return getInstallableOrganizationSkills(organizationSkillGroupById, enabledOrganizationSkills)
  }, [enabledOrganizationSkills, organizationSkillGroupById, organizationSkills.organizationId, skillInventory.data])
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
  } = useSessions({ enabled: sessionsEnabled, scope: sessionScope ?? undefined })
  const [workspaceSwitchTargetKey, setWorkspaceSwitchTargetKey] = React.useState<string | null>(null)
  const workspaceSwitchStartedAt = React.useRef<number | null>(null)
  const currentScopeKey = sessionScopeKey(sessionScope)
  const currentConnectionWorkspaceKey = organizationWorkspace.connectionWorkspace
    ? connectionWorkspaceSwitchKey(organizationWorkspace.connectionWorkspace)
    : null
  const activeWorkspaceKey = workspaceSelectionSwitchKey(organizationWorkspace.activeWorkspace)
  const activeOrganizationId =
    organizationWorkspace.activeWorkspace.type === "organization"
      ? organizationWorkspace.activeWorkspace.organizationId
      : null
  const organizationSkillsSettled =
    !activeOrganizationId ||
    (organizationSkills.organizationId === activeOrganizationId &&
      !organizationSkills.loading &&
      (organizationSkills.hasLoaded || organizationSkills.error !== null))
  const workspaceSwitching = isWorkspaceSwitchPending({
    connectionSettledWorkspaceKey: connections.summaryWorkspaceKey,
    connectionWorkspaceKey: currentConnectionWorkspaceKey,
    connectionsRefreshing: connections.busy === "refresh",
    currentScopeKey,
    loadedSessionScopeKey: sessionsLoadedScopeKey,
    organizationSkillsSettled,
    targetScopeKey: workspaceSwitchTargetKey,
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
  const handleWorkspaceSwitchStart = React.useCallback(
    (targetScopeKey: string): void => {
      if (targetScopeKey === currentScopeKey && !workspaceSwitching) {
        return
      }
      workspaceSwitchStartedAt.current = Date.now()
      setWorkspaceSwitchTargetKey(targetScopeKey)
    },
    [currentScopeKey, workspaceSwitching],
  )
  React.useEffect(() => {
    if (!workspaceSwitchTargetKey) {
      workspaceSwitchStartedAt.current = null
      return
    }
    const shouldClearTarget = shouldClearWorkspaceSwitchTarget({
      activeWorkspaceKey,
      hasLoadedOrganizations: organizationWorkspace.hasLoaded,
      loadingOrganizations: organizationWorkspace.loading,
      organizationIds: organizationWorkspace.organizations.map((organization) => organization.id),
      targetScopeKey: workspaceSwitchTargetKey,
      workspaceSwitching,
    })
    if (shouldClearTarget) {
      setWorkspaceSwitchTargetKey(null)
    }
  }, [
    activeWorkspaceKey,
    organizationWorkspace.hasLoaded,
    organizationWorkspace.loading,
    organizationWorkspace.organizations,
    workspaceSwitchTargetKey,
    workspaceSwitching,
  ])
  React.useEffect(() => {
    if (!workspaceSwitchTargetKey) {
      return
    }
    const startedAt = workspaceSwitchStartedAt.current ?? Date.now()
    workspaceSwitchStartedAt.current = startedAt
    const remainingMs = WORKSPACE_SWITCH_TIMEOUT_MS - (Date.now() - startedAt)
    if (remainingMs <= 0) {
      setWorkspaceSwitchTargetKey(null)
      return
    }
    // 防止连接器或组织请求异常挂起时，侧边栏长期停留在禁用态。
    const timeoutId = window.setTimeout(() => {
      setWorkspaceSwitchTargetKey((current) => (current === workspaceSwitchTargetKey ? null : current))
    }, remainingMs)
    return () => window.clearTimeout(timeoutId)
  }, [workspaceSwitchTargetKey])
  const [route, setRoute] = React.useState<Route>(initialRoute)
  const [activeSessionId, setActiveSessionId] = React.useState<string | null>(null)
  const [isDraftSession, setIsDraftSession] = React.useState(false)
  const [draftPermissionMode, setDraftPermissionMode] = React.useState<AgentPermissionMode>("default")
  const [draftProjectId, setDraftProjectId] = React.useState<string | null>(null)
  const [sidebarSegment, setSidebarSegment] = React.useState<SidebarSegment>(() =>
    readStoredSidebarSegment(globalThis.localStorage),
  )
  const [pendingChatTransition, setPendingChatTransition] = React.useState<PendingChatTransition | null>(null)
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
  } = useSidebarChromeState()
  const [searchOpen, setSearchOpen] = React.useState(false)
  const [composerFocusRequest, setComposerFocusRequest] = React.useState(0)
  const [renameSessionId, setRenameSessionId] = React.useState<string | null>(null)
  const [archiveSessionId, setArchiveSessionId] = React.useState<string | null>(null)
  const [archiveConfirming, setArchiveConfirming] = React.useState(false)
  const [renameProjectId, setRenameProjectId] = React.useState<string | null>(null)
  const [archiveProjectId, setArchiveProjectId] = React.useState<string | null>(null)
  const [removeProjectId, setRemoveProjectId] = React.useState<string | null>(null)
  const [archiveProjectConfirming, setArchiveProjectConfirming] = React.useState(false)
  const [removeProjectConfirming, setRemoveProjectConfirming] = React.useState(false)
  const [relativeTimeNow, setRelativeTimeNow] = React.useState(() => Date.now())
  const selectedSession = activeSessionId
    ? (visibleSessions.find((session) => session.id === activeSessionId) ?? null)
    : null
  const selectedSessionMatchesScope =
    Boolean(selectedSession) && sessionRecordScopeKey(selectedSession?.scope) === currentScopeKey
  const activeChatSessionId = selectedSessionMatchesScope ? activeSessionId : null
  const activeSession = selectedSessionMatchesScope ? (selectedSession ?? undefined) : undefined

  const {
    messages,
    pendingPermissions,
    pendingQuestions,
    status,
    activity,
    messagesLoaded,
    error,
    getSessionStatus,
    hasUnreadSession,
    permissionMode,
    setPermissionMode: setChatPermissionMode,
    send,
    stop,
    answerPermission,
    answerQuestion,
    discardQuestion,
    rejectQuestion,
  } = useChat(activeChatSessionId, route === "chat" ? activeChatSessionId : null)
  const connectionSummaryMatchesWorkspace =
    Boolean(currentConnectionWorkspaceKey) && connections.summaryWorkspaceKey === currentConnectionWorkspaceKey
  const activeProvidersLoading = Boolean(currentConnectionWorkspaceKey) && !connectionSummaryMatchesWorkspace
  const activeProviders = connectionSummaryMatchesWorkspace
    ? (connections.summary?.providers ?? EMPTY_CONNECTION_PROVIDERS)
    : EMPTY_CONNECTION_PROVIDERS
  const providerSkillRecommendations = useProviderSkillRecommendations({
    groupById: organizationSkillGroupById,
    providers: organizationSkills.organizationId ? activeProviders : EMPTY_CONNECTION_PROVIDERS,
  })
  const installableProviderSkillRecommendations = React.useMemo(
    () => getUnlinkedProviderSkillRecommendations(enabledOrganizationSkills, providerSkillRecommendations.installable),
    [enabledOrganizationSkills, providerSkillRecommendations.installable],
  )
  const recommendedSkillPendingInstallCount = skillInventory.data
    ? installableOrganizationSkills.length + installableProviderSkillRecommendations.length
    : undefined
  const organizationSkillEntryVisible = shouldShowRecommendedSkillEntry({
    organizationId: organizationSkills.organizationId,
    organizationSkillCount: enabledOrganizationSkills.length,
    providerRecommendationCount: installableProviderSkillRecommendations.length,
  })
  const organizationSkillShowcaseItems = React.useMemo<ChatOrganizationSkillContext[]>(() => {
    const organizationShowcaseSkills =
      installableOrganizationSkills.length > 0 ? installableOrganizationSkills : enabledOrganizationSkills
    const organizationItems = organizationShowcaseSkills.map((skill) => ({
      ...(skill.description ? { description: skill.description } : {}),
      ...(skill.icon ? { icon: skill.icon } : {}),
      id: skill.id,
      name: skill.displayName || skill.skillName,
      packageName: skill.packageName,
      skillName: skill.skillName,
      version: skill.version,
    }))
    const providerItems = installableProviderSkillRecommendations.map((recommendation) => {
      const recommendedSkill = recommendation.package.skills.find((skill) => skill.name === recommendation.skillId)
      return {
        ...(recommendation.package.description ? { description: recommendation.package.description } : {}),
        ...(recommendation.providerIconUrl ? { icon: recommendation.providerIconUrl } : {}),
        id: `provider:${recommendation.service}:${recommendation.packageName}:${recommendation.skillId}`,
        name: recommendation.package.displayName || recommendedSkill?.title || recommendation.skillId,
        packageName: recommendation.packageName,
        skillName: recommendation.skillId,
        version: recommendation.package.version,
      }
    })
    return [...organizationItems, ...providerItems]
  }, [enabledOrganizationSkills, installableOrganizationSkills, installableProviderSkillRecommendations])
  const sharedConnectorCount =
    organizationWorkspace.activeWorkspace.type === "organization" && connectionSummaryMatchesWorkspace
      ? connections.summary?.connectedProviderCount
      : undefined
  const [selectedService, setSelectedService] = React.useState<string | null>(null)
  const [chatConnectionDrawers, setChatConnectionDrawers] = React.useState<Record<string, ChatConnectionDrawerState>>(
    {},
  )
  // 聊天内"去授权"后待重试的原 action：provider 连上后自动重发。
  const pendingRetry = React.useRef<{
    drawerKey: string
    sessionId: string
    service: string
    text: string
    attachments: ChatAttachment[]
    contextMentions?: ChatContextMention[]
    organizationSkills?: ChatOrganizationSkillContext[]
    projectContext?: ChatProjectContext
    model?: ModelChoice
    reasoningLevel?: ReasoningLevel
    mode?: AgentMode
    permissionMode?: AgentPermissionMode
    sessionScope: SessionScope
  } | null>(null)
  const [pendingRetryWatch, setPendingRetryWatch] = React.useState<{
    drawerKey: string
    service: string
    sessionId: string
    startedAt: number
  } | null>(null)
  const appChromeRef = React.useRef<HTMLDivElement | null>(null)
  const lastModelBySession = React.useRef<Map<string, ModelChoice | undefined>>(new Map())
  const lastReasoningLevelBySession = React.useRef<Map<string, ReasoningLevel | undefined>>(new Map())
  const lastModeBySession = React.useRef<Map<string, AgentMode | undefined>>(new Map())
  const lastPermissionModeBySession = React.useRef<Map<string, AgentPermissionMode | undefined>>(new Map())
  const lastContextMentionsBySession = React.useRef<Map<string, ChatContextMention[]>>(new Map())
  const turnRetryOptionsBySession = React.useRef<Map<string, Map<string, TurnRetryOptions>>>(new Map())
  const composerDraftsByKey = React.useRef<Map<string, ComposerState>>(new Map())
  const draftProjectFallbacksById = React.useRef<Map<string, SessionProject>>(new Map())
  const lastChatProjectId = React.useRef<string | null>(null)
  const sendInFlightKeysRef = React.useRef(new Set<string>())
  const workspaceResetKeyRef = React.useRef(activeWorkspaceKey)
  const previousActiveChatSessionIdRef = React.useRef<string | null>(null)
  const activeSidebarSessions = React.useMemo(
    () => (sidebarSegment === "projects" ? visibleProjectSessions : visibleTaskSessions),
    [visibleProjectSessions, sidebarSegment, visibleTaskSessions],
  )
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

  React.useEffect(() => {
    const id = window.setInterval(() => setRelativeTimeNow(Date.now()), 60_000)
    return () => window.clearInterval(id)
  }, [])

  // dev/smoke：VITE_WANTA_SMOKE 设置时，就绪后自动发送一条消息用于可视化验证（生产无此 env，无害）。
  const smokeSent = React.useRef(false)
  React.useEffect(() => {
    const smoke = (import.meta.env as Record<string, string | undefined>)["VITE_WANTA_SMOKE"]
    if (ready && smoke && !smokeSent.current) {
      smokeSent.current = true
      void handleSend({ text: smoke })
    }
  }, [ready])

  // 默认选中最近的会话。用 layout effect 避免 sessions 加载完成后的中间帧先绘制空聊天态。
  React.useLayoutEffect(() => {
    if (sessionsSettledForCurrentScope && !isDraftSession && !activeChatSessionId && activeSidebarSessions.length > 0) {
      setActiveSessionId(activeSidebarSessions[0].id)
    }
  }, [activeSidebarSessions, sessionsSettledForCurrentScope, activeChatSessionId, isDraftSession])

  React.useEffect(() => {
    if (!sessionsSettledForCurrentScope || isDraftSession || !activeSessionId) {
      return
    }
    if (activeSidebarSessions.some((session) => session.id === activeSessionId)) {
      return
    }
    if (visibleSessions.some((session) => session.id === activeSessionId)) {
      return
    }
    setActiveSessionId(activeSidebarSessions[0]?.id ?? null)
    setDraftProjectId(null)
    setPendingChatTransition(null)
  }, [activeSessionId, activeSidebarSessions, isDraftSession, sessionsSettledForCurrentScope, visibleSessions])

  React.useEffect(() => {
    if (!sessionsSettledForCurrentScope || !activeSessionId) {
      return
    }
    if (visibleSessions.some((session) => session.id === activeSessionId)) {
      return
    }
    setActiveSessionId(null)
    setIsDraftSession(false)
    setPendingChatTransition(null)
  }, [activeSessionId, sessionsSettledForCurrentScope, visibleSessions])

  // R5 闭环：待重试的 provider 一旦连上，刷新已授权清单后自动重发原 action。
  React.useEffect(() => {
    if (!pendingRetryWatch) {
      return
    }

    let cancelled = false
    const refreshUntilConnected = async (): Promise<void> => {
      if (Date.now() - pendingRetryWatch.startedAt >= AUTH_RETRY_POLL_TIMEOUT_MS) {
        if (
          !cancelled &&
          pendingRetry.current?.sessionId === pendingRetryWatch.sessionId &&
          pendingRetry.current.service === pendingRetryWatch.service
        ) {
          pendingRetry.current = null
        }
        setChatConnectionDrawers((current) => {
          if (!Object.hasOwn(current, pendingRetryWatch.drawerKey)) {
            return current
          }
          const next = { ...current }
          delete next[pendingRetryWatch.drawerKey]
          return next
        })
        setPendingRetryWatch(null)
        return
      }
      await connections.refresh({ forceRefresh: true })
    }

    void refreshUntilConnected()
    const id = window.setInterval(() => {
      void refreshUntilConnected()
    }, AUTH_RETRY_POLL_INTERVAL_MS)
    return () => {
      cancelled = true
      window.clearInterval(id)
    }
  }, [connections.refresh, pendingRetryWatch])

  React.useEffect(() => {
    const pending = pendingRetry.current
    if (!pending) {
      return
    }
    if (sessionScopeKey(sessionScope) !== sessionScopeKey(pending.sessionScope)) {
      return
    }
    const connected = connections.summary?.providers.some(
      (p) => p.service === pending.service && p.status === "connected" && p.appStatus === "active",
    )
    if (connected) {
      pendingRetry.current = null
      setPendingRetryWatch(null)
      setChatConnectionDrawers((current) => {
        if (!Object.hasOwn(current, pending.drawerKey)) {
          return current
        }
        const next = { ...current }
        delete next[pending.drawerKey]
        return next
      })
      setRoute("chat")
      void send(pending.sessionId, pending.text, pending.attachments, {
        contextMentions: pending.contextMentions ?? [],
        organizationSkills: pending.organizationSkills ?? [],
        projectContext: pending.projectContext,
        model: pending.model,
        reasoningLevel: pending.reasoningLevel,
        sessionScope: pending.sessionScope,
        mode: pending.mode,
        permissionMode: pending.permissionMode,
      })
    }
  }, [connections.summary, send, sessionScope])

  React.useEffect(() => {
    if (!activeChatSessionId || !activeSession) {
      return
    }
    setChatPermissionMode(activeChatSessionId, activeSession.permissionMode ?? "default")
  }, [activeChatSessionId, activeSession, setChatPermissionMode])

  const setAndPersistPermissionMode = React.useCallback(
    (sessionId: string, mode: AgentPermissionMode): void => {
      setChatPermissionMode(sessionId, mode)
      void setSessionPermissionMode(sessionId, mode).catch((cause: unknown) => {
        console.error("[wanta] persist session permission mode failed", cause)
        reportRendererHandledError("appShell.permissionMode", "Failed to persist session permission mode", cause)
        toast.error(userFacingErrorDescription(resolveUserFacingError(cause, { area: "session" }), t))
      })
    },
    [setChatPermissionMode, setSessionPermissionMode, t],
  )
  const {
    clearAutoFallbackTitle,
    getAutoFallbackTitle,
    isAutoRefreshable,
    refreshGeneratedTitle,
    rememberAutoFallbackTitle,
  } = useSessionTitleGeneration({
    activeSession,
    generateTitle,
    messages,
    messagesLoaded,
    rename,
    sessions: visibleSessions,
  })
  const activeProjectId = React.useMemo(
    () => activeProjectIdForComposer({ activeSession, draftProjectId }),
    [activeSession, draftProjectId],
  )
  const activeProject = React.useMemo(() => {
    if (!activeProjectId) {
      return undefined
    }
    return (
      visibleProjects.find((project) => project.id === activeProjectId) ??
      draftProjectFallbacksById.current.get(activeProjectId)
    )
  }, [activeProjectId, visibleProjects])
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
  const sidebarSessionGroups = React.useMemo(() => groupSidebarSessions(visibleTaskSessions), [visibleTaskSessions])
  const projectPinnedSessions = React.useMemo(() => {
    const pinnedProjectIds = new Set(visibleProjects.filter((project) => project.pinnedAt).map((project) => project.id))
    return visibleProjectSessions
      .filter(
        (session) =>
          session.projectId && !pinnedProjectIds.has(session.projectId) && session.pinnedAt && !session.archivedAt,
      )
      .sort((a, b) => (b.pinnedAt ?? 0) - (a.pinnedAt ?? 0))
  }, [visibleProjectSessions, visibleProjects])
  const projectSidebarGroups = React.useMemo(
    () => buildProjectSidebarGroups(visibleProjects, visibleProjectSessions),
    [visibleProjectSessions, visibleProjects],
  )
  const projectPinnedGroups = React.useMemo(
    () => projectSidebarGroups.filter((group) => group.project.pinnedAt),
    [projectSidebarGroups],
  )
  const projectRegularGroups = React.useMemo(
    () => projectSidebarGroups.filter((group) => !group.project.pinnedAt),
    [projectSidebarGroups],
  )
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
  const activeComposerDraftKeyRef = React.useRef(activeComposerDraftKey)
  activeComposerDraftKeyRef.current = activeComposerDraftKey
  const currentScopeKeyRef = React.useRef(currentScopeKey)
  currentScopeKeyRef.current = currentScopeKey
  const initialComposerState = composerDraftsByKey.current.get(activeComposerDraftKey)
  const renameSession = visibleSessions.find((s) => s.id === renameSessionId) ?? null
  const renameProjectTarget = visibleProjects.find((project) => project.id === renameProjectId) ?? null
  const archiveProjectTarget = visibleProjects.find((project) => project.id === archiveProjectId) ?? null
  const removeProjectTarget = visibleProjects.find((project) => project.id === removeProjectId) ?? null
  const archiveSession = visibleSessions.find((s) => s.id === archiveSessionId) ?? null
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
  const displayedPermissionMode = activeChatSessionId ? permissionMode : draftPermissionMode
  const needsDefaultSessionSelection =
    sessionsSettledForCurrentScope && !isDraftSession && !activeChatSessionId && activeSidebarSessions.length > 0
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
  const showComposerProjectContext = route === "chat"
  const chatEmptyTitle = activeProject ? t("project.chatEmptyTitle", { project: activeProject.name }) : undefined
  const isSessionRunning = React.useCallback(
    (sessionId: string): boolean => {
      const sessionStatus = getSessionStatus(sessionId)
      return (
        sessionStatus === "submitted" ||
        sessionStatus === "streaming" ||
        (sessionId === activeChatSessionId && activePendingChatTransition?.sessionId === sessionId && !pendingCaughtUp)
      )
    },
    [activeChatSessionId, activePendingChatTransition, getSessionStatus, pendingCaughtUp],
  )
  const titlebarTitle =
    route === "settings"
      ? t("settings.title")
      : route === "billing"
        ? t("billing.title")
        : route === "connections"
          ? t("connections.title")
          : route === "skills"
            ? t("skills.title")
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
    if (renameSessionId && !renameSession) {
      setRenameSessionId(null)
    }
  }, [renameSession, renameSessionId])

  React.useEffect(() => {
    if (renameProjectId && !renameProjectTarget) {
      setRenameProjectId(null)
    }
  }, [renameProjectId, renameProjectTarget])

  React.useEffect(() => {
    if (archiveSessionId && !archiveSession) {
      setArchiveSessionId(null)
    }
  }, [archiveSession, archiveSessionId])

  React.useEffect(() => {
    if (archiveProjectId && !archiveProjectTarget) {
      setArchiveProjectId(null)
    }
  }, [archiveProjectId, archiveProjectTarget])

  React.useEffect(() => {
    if (removeProjectId && !removeProjectTarget) {
      setRemoveProjectId(null)
    }
  }, [removeProjectId, removeProjectTarget])

  React.useEffect(() => {
    if (
      draftProjectId &&
      draftProjectId !== NO_DRAFT_PROJECT_ID &&
      !visibleProjects.some((project) => project.id === draftProjectId) &&
      !draftProjectFallbacksById.current.has(draftProjectId)
    ) {
      setDraftProjectId(null)
    }
  }, [draftProjectId, visibleProjects])

  React.useEffect(() => {
    if (!draftProjectId || draftProjectId === NO_DRAFT_PROJECT_ID) {
      return
    }
    if (visibleProjects.some((project) => project.id === draftProjectId)) {
      draftProjectFallbacksById.current.delete(draftProjectId)
    }
  }, [draftProjectId, visibleProjects])

  React.useEffect(() => {
    draftProjectFallbacksById.current.clear()
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

  const requestComposerFocus = React.useCallback((): void => {
    setRoute("chat")
    setSearchOpen(false)
    setComposerFocusRequest((request) => request + 1)
  }, [])

  const handleOpenConnections = React.useCallback((): void => {
    setChatConnectionDrawers((current) => {
      if (!Object.hasOwn(current, activeComposerDraftKey)) {
        return current
      }
      const next = { ...current }
      delete next[activeComposerDraftKey]
      return next
    })
    setSelectedService(null)
    setRoute("connections")
  }, [activeComposerDraftKey])
  const handleOpenChatConnectionProvider = React.useCallback(
    (service: string): void => {
      setRoute("chat")
      setChatConnectionDrawers((current) => ({
        ...current,
        [activeComposerDraftKey]: {
          authIntent: null,
          open: true,
          selectedService: service,
        },
      }))
    },
    [activeComposerDraftKey],
  )
  const handleCloseChatConnectionDrawer = React.useCallback((): void => {
    setChatConnectionDrawers((current) => {
      if (!Object.hasOwn(current, activeComposerDraftKey)) {
        return current
      }
      const next = { ...current }
      delete next[activeComposerDraftKey]
      return next
    })
  }, [activeComposerDraftKey])

  const handleReturnToConnections = React.useCallback((): void => {
    setSearchOpen(false)
    setRoute("connections")
  }, [])

  const startNewSessionDraft = React.useCallback(
    (target: ReturnType<typeof resolveNewSessionTarget>): void => {
      const targetDraftKey = newSessionComposerDraftKey(sessionScope, target.projectId)
      clearComposerDraft(targetDraftKey)
      setActiveSessionId(null)
      setIsDraftSession(true)
      setDraftPermissionMode("default")
      setDraftProjectId(target.projectId ?? NO_DRAFT_PROJECT_ID)
      setPendingChatTransition(null)
      setRoute("chat")
      setSidebarSegment(target.sidebarSegment)
      setSearchOpen(false)
      setComposerFocusRequest((request) => request + 1)
    },
    [clearComposerDraft, sessionScope],
  )

  const handleNewSession = React.useCallback((): void => {
    startNewSessionDraft(
      resolveNewSessionTarget({
        activeSession,
        draftProjectId,
        lastProjectId: lastChatProjectId.current,
        preferLastProject: route !== "chat",
      }),
    )
  }, [activeSession, draftProjectId, route, startNewSessionDraft])

  const handleOpenProjectDraft = React.useCallback(
    (project: SessionProject): void => {
      draftProjectFallbacksById.current.set(project.id, project)
      startNewSessionDraft(resolveNewSessionTarget({ draftProjectId, explicitProjectId: project.id }))
    },
    [draftProjectId, startNewSessionDraft],
  )

  const handleSelectComposerProject = React.useCallback(
    async (projectId: string | undefined): Promise<void> => {
      if (activeChatSessionId && !isDraftSession) {
        try {
          await assignSessionProject(activeChatSessionId, projectId)
          await refreshSessions()
          setSidebarSegment(projectId ? "projects" : "tasks")
        } catch (cause) {
          const notice = resolveUserFacingError(cause, { area: "session" })
          toast.error(userFacingErrorDescription(notice, t))
        }
        return
      }
      const currentDraft = composerDraftsByKey.current.get(activeComposerDraftKey)
      const nextDraftKey = newSessionComposerDraftKey(sessionScope, projectId)
      if (currentDraft && nextDraftKey !== activeComposerDraftKey) {
        composerDraftsByKey.current.set(nextDraftKey, currentDraft)
        clearComposerDraft(activeComposerDraftKey)
      }
      setDraftProjectId(projectId ?? NO_DRAFT_PROJECT_ID)
      setIsDraftSession(true)
      setRoute("chat")
      setSidebarSegment(projectId ? "projects" : "tasks")
    },
    [
      activeComposerDraftKey,
      activeChatSessionId,
      assignSessionProject,
      clearComposerDraft,
      isDraftSession,
      refreshSessions,
      sessionScope,
      t,
    ],
  )

  const handleCreatedProject = React.useCallback(
    async (project: SessionProject, source: ProjectSelectionSource): Promise<void> => {
      draftProjectFallbacksById.current.set(project.id, project)
      if (source === "composer") {
        await handleSelectComposerProject(project.id)
        return
      }
      handleOpenProjectDraft(project)
    },
    [handleOpenProjectDraft, handleSelectComposerProject],
  )

  const handleSelectProjectDirectory = React.useCallback(
    async (source: ProjectSelectionSource): Promise<void> => {
      releaseTransientFocus()
      const picker = globalThis.wanta?.selectProjectDirectory
      if (!picker) {
        toast.error(t("project.folderPickerUnavailable"))
        return
      }
      try {
        const directory = await picker()
        if (!directory) {
          return
        }
        const project = await createProject({ name: directory.name, path: directory.path })
        await handleCreatedProject(project, source)
      } catch (cause) {
        const notice = resolveUserFacingError(cause, { area: "session" })
        toast.error(userFacingErrorDescription(notice, t))
      } finally {
        releaseTransientFocus()
      }
    },
    [createProject, handleCreatedProject, t],
  )

  const handleSelectProjectFolder = React.useCallback(async (): Promise<void> => {
    await handleSelectProjectDirectory("sidebar")
  }, [handleSelectProjectDirectory])

  const handleSelectComposerProjectFolder = React.useCallback(async (): Promise<void> => {
    await handleSelectProjectDirectory("composer")
  }, [handleSelectProjectDirectory])

  const handleSelectSession = React.useCallback((session: SessionInfo): void => {
    setActiveSessionId(session.id)
    setIsDraftSession(false)
    setDraftProjectId(null)
    setRoute("chat")
    setSidebarSegment(session.projectId ? "projects" : "tasks")
  }, [])

  const sendNow = React.useCallback(
    async (request: ChatSendRequest): Promise<boolean> => {
      const {
        afterOptimisticSubmit,
        attachments = [],
        contextMentions = [],
        mode,
        model,
        permissionMode: permissionModeArg,
        reasoningLevel,
        text,
      } = request
      const sendKey = activeComposerDraftKey
      const sendScopeKey = currentScopeKey
      const isCurrentSendTarget = (): boolean =>
        activeComposerDraftKeyRef.current === sendKey && currentScopeKeyRef.current === sendScopeKey
      if (sendInFlightKeysRef.current.has(sendKey)) {
        return false
      }
      if (!sessionScope) {
        return false
      }
      sendInFlightKeysRef.current.add(sendKey)
      try {
        setRoute("chat")
        let sessionId = activeChatSessionId
        const titleInput = buildSessionTitleInput(messages, text, attachments)
        const fallbackTitle = buildFallbackSessionTitle(titleInput)
        const autoFallbackTitle = sessionId ? getAutoFallbackTitle(sessionId) : undefined
        const allowPlaceholderTitle =
          !sessionId || (activeSession ? isAutoRefreshable(activeSession, true, fallbackTitle) : false)
        const shouldRefreshTitle =
          !sessionId || (activeSession ? isAutoRefreshable(activeSession, allowPlaceholderTitle, fallbackTitle) : false)
        const bridgeEmptySend = messagesLoaded && messages.length === 0
        const createdAt = Date.now()
        const selectedPermissionMode = permissionModeArg ?? displayedPermissionMode
        if (bridgeEmptySend && isCurrentSendTarget()) {
          setPendingChatTransition({
            sessionId,
            scopeKey: sendScopeKey,
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
            info = await create(fallbackTitle, activeProject?.id)
          } catch (error) {
            if (bridgeEmptySend && isCurrentSendTarget()) {
              setPendingChatTransition(null)
            }
            throw error
          }
          sessionId = info.id
          rememberAutoFallbackTitle(sessionId, fallbackTitle)
          if (isCurrentSendTarget()) {
            setActiveSessionId(sessionId)
            setIsDraftSession(false)
            setSidebarSegment(info.projectId ? "projects" : "tasks")
            setPendingChatTransition((pending) =>
              pending?.createdAt === createdAt && pending.scopeKey === sendScopeKey
                ? { ...pending, sessionId: info.id }
                : pending,
            )
          }
        }
        setAndPersistPermissionMode(sessionId, selectedPermissionMode)
        if (shouldRefreshTitle) {
          void refreshGeneratedTitle(
            sessionId,
            titleInput,
            allowPlaceholderTitle,
            !activeChatSessionId ? fallbackTitle : autoFallbackTitle,
          )
        }
        lastModelBySession.current.set(sessionId, model)
        lastReasoningLevelBySession.current.set(sessionId, reasoningLevel)
        lastModeBySession.current.set(sessionId, mode)
        lastPermissionModeBySession.current.set(sessionId, selectedPermissionMode)
        lastContextMentionsBySession.current.set(sessionId, contextMentions)
        rememberTurnRetryOptions(
          turnRetryOptionsBySession.current,
          sessionId,
          chatTurnInputKey({ text, attachments }),
          {
            contextMentions,
            organizationSkills: organizationSkills.chatContextSkills,
            projectContext: activeProjectContext,
            model,
            reasoningLevel,
            mode,
            permissionMode: selectedPermissionMode,
            sessionScope,
          },
        )
        try {
          const sendPromise = send(sessionId, text, attachments, {
            contextMentions,
            model,
            organizationSkills: organizationSkills.chatContextSkills,
            projectContext: activeProjectContext,
            reasoningLevel,
            sessionScope,
            mode,
            permissionMode: selectedPermissionMode,
          })
          afterOptimisticSubmit?.()
          await sendPromise
        } catch (error) {
          if (bridgeEmptySend && isCurrentSendTarget()) {
            setPendingChatTransition(null)
          }
          throw error
        }
        return true
      } finally {
        sendInFlightKeysRef.current.delete(sendKey)
      }
    },
    [
      activeSession,
      activeChatSessionId,
      activeComposerDraftKey,
      activeProject?.id,
      activeProjectContext,
      create,
      currentScopeKey,
      displayedPermissionMode,
      getAutoFallbackTitle,
      isAutoRefreshable,
      messages,
      messagesLoaded,
      organizationSkills.chatContextSkills,
      refreshGeneratedTitle,
      rememberAutoFallbackTitle,
      send,
      sessionScope,
      setAndPersistPermissionMode,
    ],
  )

  const isSendInFlight = React.useCallback(
    (): boolean => sendInFlightKeysRef.current.has(activeComposerDraftKey),
    [activeComposerDraftKey],
  )
  const {
    activeQueueHeld,
    activeQueuedMessages,
    clearQueuedSession,
    handleQueuedMessageMove,
    handleQueuedMessageRemove,
    handleQueuedMessageResume,
    holdQueuedSessionIfQueued,
    queueActiveMessage,
    releaseActiveQueue,
  } = useChatQueueState({
    activeSessionId: activeChatSessionId,
    initialSendPending,
    isSendInFlight,
    sendQueuedMessage: sendNow,
    status,
  })

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
    pendingRetry.current = null
    setPendingRetryWatch(null)
    setChatConnectionDrawers({})
    setSelectedService(null)
    setActiveSessionId(null)
    setIsDraftSession(false)
    setDraftPermissionMode("default")
    setDraftProjectId(null)
    setPendingChatTransition(null)
    setRenameSessionId(null)
    setArchiveSessionId(null)
    setRenameProjectId(null)
    setArchiveProjectId(null)
    setRemoveProjectId(null)
    draftProjectFallbacksById.current.clear()
    handleArtifactsReset()
    releaseTransientFocus()
  }, [activeWorkspaceKey, handleArtifactsReset, holdQueuedSessionIfQueued])

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
    async (request: ChatSendRequest): Promise<boolean> => {
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
      const draftKey = activeComposerDraftKey
      const clearSubmittedDraft = (): void => {
        clearComposerDraft(draftKey)
        afterOptimisticSubmit?.()
      }
      if (activeChatSessionId && (isSessionRunning(activeChatSessionId) || sendInFlightKeysRef.current.has(draftKey))) {
        queueActiveMessage(text, attachments, contextMentions, model, reasoningLevel, mode, permissionMode)
        clearSubmittedDraft()
        return true
      }
      const accepted = await sendNow({
        afterOptimisticSubmit: clearSubmittedDraft,
        attachments,
        contextMentions,
        mode,
        model,
        permissionMode,
        reasoningLevel,
        text,
      })
      if (accepted) {
        releaseActiveQueue()
        clearComposerDraft(draftKey)
      }
      return accepted
    },
    [
      activeComposerDraftKey,
      activeChatSessionId,
      clearComposerDraft,
      isSessionRunning,
      queueActiveMessage,
      releaseActiveQueue,
      sendNow,
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

  const handleContinueQuestion = React.useCallback(
    async (request: ChatQuestionRequest, answers: string[][]): Promise<void> => {
      const sessionId = activeChatSessionId
      if (!sessionId) {
        return
      }
      const accepted = await handleSend({ text: formatQuestionResumeMessage(t, request, answers) })
      if (accepted) {
        discardQuestion(sessionId, request.id)
      }
    },
    [activeChatSessionId, discardQuestion, handleSend, t],
  )

  const handleDiscardQuestion = React.useCallback(
    (requestId: string): void => {
      if (activeChatSessionId) {
        discardQuestion(activeChatSessionId, requestId)
      }
    },
    [activeChatSessionId, discardQuestion],
  )

  const handleRejectQuestion = React.useCallback(
    (requestId: string): Promise<void> =>
      activeChatSessionId ? rejectQuestion(activeChatSessionId, requestId) : Promise.resolve(),
    [activeChatSessionId, rejectQuestion],
  )

  const handlePinSession = async (session: SessionInfo): Promise<void> => {
    try {
      await pin(session.id, !session.pinnedAt)
    } catch (cause) {
      const notice = resolveUserFacingError(cause, { area: "session" })
      toast.error(userFacingErrorDescription(notice, t))
    }
  }

  const handleArchiveSessionRequest = (session: SessionInfo): void => {
    if (isSessionRunning(session.id)) {
      return
    }
    setArchiveSessionId(session.id)
  }

  const handleArchiveSession = async (session: SessionInfo): Promise<void> => {
    if (isSessionRunning(session.id)) {
      return
    }
    setArchiveConfirming(true)
    try {
      await archive(session.id)
      clearComposerDraft(existingSessionComposerDraftKey(sessionRecordScopeKey(session.scope), session.id))
    } catch (cause) {
      const notice = resolveUserFacingError(cause, { area: "session" })
      toast.error(userFacingErrorDescription(notice, t))
      return
    } finally {
      setArchiveConfirming(false)
    }
    if (activeChatSessionId === session.id) {
      setActiveSessionId(nextActiveSessionIdAfterArchive(activeSidebarSessions, session.id))
      setIsDraftSession(false)
      setPendingChatTransition(null)
      setRoute("chat")
    }
    setArchiveSessionId(null)
  }

  const handlePinProject = async (project: SessionProject): Promise<void> => {
    try {
      await pinProjectAction(project.id, !project.pinnedAt)
    } catch (cause) {
      const notice = resolveUserFacingError(cause, { area: "session" })
      toast.error(userFacingErrorDescription(notice, t))
    }
  }

  const handleRenameProject = async (projectId: string, name: string): Promise<void> => {
    try {
      await renameProjectAction(projectId, name)
    } catch (cause) {
      const notice = resolveUserFacingError(cause, { area: "session" })
      toast.error(userFacingErrorDescription(notice, t))
    }
  }

  const handleShowProjectInFolder = (project: SessionProject): void => {
    void chatService.invoke("showLocalPathInFolder", { path: project.path }).catch((cause: unknown) => {
      reportRendererHandledError("appShell.showProjectInFolder", "Failed to reveal project folder", cause)
      const notice = resolveUserFacingError(cause, { area: "artifact" })
      toast.error(userFacingErrorDescription(notice, t))
    })
  }

  const clearActiveProjectIfNeeded = React.useCallback(
    (projectId: string): void => {
      if (lastChatProjectId.current === projectId) {
        lastChatProjectId.current = null
      }
      if (activeProjectId !== projectId) {
        return
      }
      if (activeChatSessionId) {
        setActiveSessionId(null)
      }
      setIsDraftSession(true)
      setDraftProjectId(NO_DRAFT_PROJECT_ID)
      setPendingChatTransition(null)
      setRoute("chat")
    },
    [activeProjectId, activeChatSessionId],
  )

  const handleArchiveProject = async (project: SessionProject): Promise<void> => {
    setArchiveProjectConfirming(true)
    try {
      await archiveProjectAction(project.id)
      clearActiveProjectIfNeeded(project.id)
    } catch (cause) {
      const notice = resolveUserFacingError(cause, { area: "session" })
      toast.error(userFacingErrorDescription(notice, t))
      return
    } finally {
      setArchiveProjectConfirming(false)
    }
    setArchiveProjectId(null)
  }

  const handleRemoveProject = async (project: SessionProject): Promise<void> => {
    setRemoveProjectConfirming(true)
    try {
      await removeProjectAction(project.id)
      clearActiveProjectIfNeeded(project.id)
    } catch (cause) {
      const notice = resolveUserFacingError(cause, { area: "session" })
      toast.error(userFacingErrorDescription(notice, t))
      return
    } finally {
      setRemoveProjectConfirming(false)
    }
    setRemoveProjectId(null)
  }

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
        pendingRetry.current = {
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
        }
        setPendingRetryWatch({
          drawerKey: activeComposerDraftKey,
          service: auth.service,
          sessionId: activeChatSessionId,
          startedAt: Date.now(),
        })
        void connections.refresh({ forceRefresh: true })
      }
    },
    [
      activeComposerDraftKey,
      activeProjectContext,
      activeChatSessionId,
      connections.refresh,
      displayedPermissionMode,
      organizationSkills.chatContextSkills,
      sessionScope,
    ],
  )
  const handleOpenSearch = React.useCallback((): void => setSearchOpen(true), [])
  const handleRenameSession = (sessionId: string, title: string): void => {
    clearAutoFallbackTitle(sessionId)
    void rename(sessionId, title).catch((cause: unknown) => {
      console.error("[wanta] rename session failed", cause)
      reportRendererHandledError("appShell.renameSession", "Failed to rename session", cause)
      toast.error(t("session.renameFailed"))
    })
  }
  const handleChatStop = React.useCallback(async (): Promise<void> => {
    if (activeChatSessionId) {
      await stop(activeChatSessionId)
    }
  }, [activeChatSessionId, stop])
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
  const runAppCommand = React.useCallback(
    (command: AppCommand): void => {
      switch (command) {
        case APP_COMMANDS.openConnections:
          handleReturnToConnections()
          void connections.refresh({ forceRefresh: true })
          return
        case APP_COMMANDS.focusComposer:
          requestComposerFocus()
          return
        case APP_COMMANDS.newChat:
          handleNewSession()
          return
        case APP_COMMANDS.openSearch:
          handleOpenSearch()
          return
        case APP_COMMANDS.openSettings:
          setSearchOpen(false)
          setRoute("settings")
          return
        case APP_COMMANDS.stopGeneration:
          void handleChatStop()
          return
        case APP_COMMANDS.toggleSidebar:
          handleToggleSidebar()
          return
      }
    },
    [
      connections.refresh,
      handleChatStop,
      handleNewSession,
      handleOpenSearch,
      handleReturnToConnections,
      handleToggleSidebar,
      requestComposerFocus,
    ],
  )
  useAppCommandEvents(runAppCommand)
  useAppCommandShortcuts(runAppCommand)

  const handleViewBilling = React.useCallback(() => {
    setRoute("billing")
  }, [])
  const showArtifactsToggle = route === "chat" && hasPanelSelection && !artifactsPanelVisible
  const ArtifactsToggleIcon = artifactsPanelOpen ? PanelRightClose : PanelRightOpen
  const artifactsToggleLabel = artifactsPanelOpen ? t("artifacts.collapse") : t("artifacts.expand")
  const billingCacheScope = auth.state?.account?.id ?? "authenticated"
  const newChatShortcut = appCommandShortcutLabel(APP_COMMANDS.newChat)
  const newChatLabel = labelWithShortcut(
    activeProject ? t("project.newTask") : t("sidebar.newSession"),
    newChatShortcut,
  )

  if (route === "settings") {
    return (
      <React.Suspense fallback={<RouteLoadingFallback />}>
        <SettingsRoute onBack={() => setRoute("chat")} />
      </React.Suspense>
    )
  }

  if (route === "billing") {
    return (
      <React.Suspense fallback={<RouteLoadingFallback />}>
        <BillingRoute
          cacheScope={billingCacheScope}
          sharedConnectorCount={sharedConnectorCount}
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
            setActiveSessionId(session.id)
            setIsDraftSession(false)
            setPendingChatTransition(null)
            setRoute("chat")
            setSidebarSegment(session.projectId ? "projects" : "tasks")
          }}
          refreshSessions={refreshSessions}
          removeSession={removeSession}
          ready={ready}
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
        activeSessionId={activeChatSessionId}
        avatarUrl={auth.state?.account?.avatarUrl}
        collapsed={sidebarCollapsed}
        collapsedProjectIds={collapsedProjectIds}
        hasUnreadSession={hasUnreadSession}
        isSessionRunning={isSessionRunning}
        loggingOut={auth.loggingOut}
        newChatLabel={newChatLabel}
        now={relativeTimeNow}
        projectPinnedGroups={projectPinnedGroups}
        projectPinnedSessions={projectPinnedSessions}
        projectRegularGroups={projectRegularGroups}
        projectSessions={visibleProjectSessions}
        projectSidebarGroups={projectSidebarGroups}
        sessionsError={sessionsError}
        sidebarSegment={sidebarSegment}
        sidebarSessionGroups={sidebarSessionGroups}
        taskSessions={visibleTaskSessions}
        width={sidebarWidth}
        workspace={organizationWorkspace}
        workspaceSwitching={workspaceSwitching}
        onArchiveProjectRequest={(project) => setArchiveProjectId(project.id)}
        onArchiveSessionRequest={handleArchiveSessionRequest}
        onLogout={() => void auth.logout()}
        onNavigate={setRoute}
        onNewSession={handleNewSession}
        onOpenConnections={handleOpenConnections}
        onOpenSearch={handleOpenSearch}
        onPinProject={(project) => void handlePinProject(project)}
        onPinSession={(session) => void handlePinSession(session)}
        onProjectExpandedChange={handleProjectSidebarExpandedChange}
        onRemoveProjectRequest={(project) => setRemoveProjectId(project.id)}
        onRenameProjectRequest={(project) => setRenameProjectId(project.id)}
        onWorkspaceSwitchStart={handleWorkspaceSwitchStart}
        onRenameSessionRequest={(session) => setRenameSessionId(session.id)}
        onSelectProjectDraft={handleOpenProjectDraft}
        onSelectProjectFolder={() => void handleSelectProjectFolder()}
        onSelectSession={handleSelectSession}
        onSetSidebarSegment={setSidebarSegment}
        onShowProjectInFolder={handleShowProjectInFolder}
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
            onRenameSession={handleRenameSession}
            onToggleSidebar={handleToggleSidebar}
            onViewBilling={() => setRoute("billing")}
          />

          <main className="oo-content-surface min-h-0 min-w-0 overflow-hidden">
            <React.Suspense fallback={<RouteLoadingFallback />}>
              {route === "connections" ? (
                <div className="h-full min-h-0 p-0">
                  <ConnectionsPanel connections={connections} selectedService={selectedService} />
                </div>
              ) : route === "skills" ? (
                <SkillsRoute
                  connectedProviders={activeProviders}
                  connectedProvidersLoading={activeProvidersLoading}
                  organizationSkills={organizationSkills}
                  workspace={organizationWorkspace}
                />
              ) : route === "organizations" ? (
                <OrganizationManagementRoute
                  connectedProviders={activeProviders}
                  connectedProvidersLoading={activeProvidersLoading}
                  organizationSkills={organizationSkills}
                  workspace={organizationWorkspace}
                />
              ) : (
                <div className="flex h-full min-h-0 overflow-hidden">
                  <div className="min-w-0 flex-1">
                    <ChatArea
                      activeSessionId={activeChatSessionId}
                      billingCacheScope={billingCacheScope}
                      composerDraftKey={activeComposerDraftKey}
                      messages={bridgeInitialSendPending ? [] : messages}
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
                      generatedArtifacts={artifactSelection}
                      submitDisabled={!ready || chatBootstrapping || workspaceSwitching || !sessionScope}
                      willQueueMessage={Boolean(
                        activeChatSessionId && (isSessionRunning(activeChatSessionId) || isSendInFlight()),
                      )}
                      initialComposerState={initialComposerState}
                      initialSendPending={initialSendPending}
                      composerFocusRequest={composerFocusRequest}
                      sharedConnectorCount={sharedConnectorCount}
                      organizationSkillEntryVisible={organizationSkillEntryVisible}
                      organizationSkillShowcaseItems={organizationSkillShowcaseItems}
                      organizationSkillPendingInstallCount={recommendedSkillPendingInstallCount}
                      organizationSkills={organizationSkills.chatContextSkills}
                      providers={activeProviders}
                      queueHeld={activeQueueHeld}
                      queuedMessages={activeQueuedMessages}
                      contextBar={
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
                        ) : null
                      }
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
                      onContinueQuestion={handleContinueQuestion}
                      onDiscardQuestion={handleDiscardQuestion}
                      onRejectQuestion={handleRejectQuestion}
                      onSetDefaultConnection={connections.setDefaultAccount}
                      onStop={handleChatStop}
                      onQueuedMessageMove={handleQueuedMessageMove}
                      onQueuedMessageRemove={handleQueuedMessageRemove}
                      onQueuedMessageResume={handleQueuedMessageResume}
                      onAuthorize={handleAuthorize}
                      onArtifactsReset={handleArtifactsReset}
                      onArtifactsOpen={handleArtifactsOpen}
                      onArtifactsAvailable={handleArtifactsAvailable}
                      onTurnOutputOpen={handleTurnOutputOpen}
                      onTurnOutputAvailable={handleTurnOutputAvailable}
                      onOpenConnections={handleOpenConnections}
                      onOpenConnectionProvider={handleOpenChatConnectionProvider}
                      onOpenOrganizations={() => setRoute("organizations")}
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
        archiveConfirming={archiveConfirming}
        archiveProjectConfirming={archiveProjectConfirming}
        archiveProjectTarget={archiveProjectTarget}
        archiveSession={archiveSession}
        openSearch={searchOpen}
        removeProjectConfirming={removeProjectConfirming}
        removeProjectTarget={removeProjectTarget}
        renameProjectTarget={renameProjectTarget}
        renameSession={renameSession}
        sessions={visibleSessions}
        onArchiveProject={(project) => void handleArchiveProject(project)}
        onArchiveSession={(session) => void handleArchiveSession(session)}
        onCloseArchiveProject={() => setArchiveProjectId(null)}
        onCloseArchiveSession={() => setArchiveSessionId(null)}
        onCloseRemoveProject={() => setRemoveProjectId(null)}
        onCloseRenameProject={() => setRenameProjectId(null)}
        onCloseRenameSession={() => setRenameSessionId(null)}
        onCloseSearch={() => setSearchOpen(false)}
        onRemoveProject={(project) => void handleRemoveProject(project)}
        onRenameProject={(projectId, name) => void handleRenameProject(projectId, name)}
        onRenameSession={handleRenameSession}
        onSearchSelect={(session) => {
          handleSelectSession(session)
          setPendingChatTransition(null)
          setSearchOpen(false)
        }}
      />
    </div>
  )
}
