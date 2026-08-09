import type { AuthAccountSummary } from "../../../electron/auth/common.ts"
import type { SessionInfo, SessionProject } from "../../../electron/session/common.ts"
import type { AppShellRoute as Route } from "./app-shell-types.ts"
import type { ProjectSidebarGroup } from "./app-sidebar-model.ts"
import type { SidebarSegment, SidebarTaskSortMode } from "./sidebar-persistence.ts"
import type { SidebarSessionGroups } from "./sidebar-sessions.ts"
import type { UseTeamWorkspace } from "@/hooks/useTeamWorkspace"
import type { UserFacingError } from "@/lib/user-facing-error"

import {
  Archive,
  Building2,
  Check,
  Ellipsis,
  FolderPlus,
  LibraryBig,
  ListChecks,
  Package,
  Plug,
  SquarePen,
} from "lucide-react"
import * as React from "react"
import { APP_COMMANDS } from "../../../electron/app-command.ts"
import { SIDEBAR_MAX_WIDTH_PX, SIDEBAR_MIN_WIDTH_PX } from "./app-shell-model.ts"
import {
  ProjectSidebarEmptyState,
  ProjectSidebarGroupItem,
  SessionItem,
  SidebarEmptyState,
  SidebarSegmentControl,
  SidebarTitlebarActions,
} from "./AppShellSidebar.tsx"
import { limitSidebarSessionGroups, runningProjectIds } from "./sidebar-sessions.ts"
import { SidebarFooterControls } from "./SidebarAccountControls.tsx"
import { BrandIcon } from "@/components/BrandIcon"
import { ErrorNotice } from "@/components/ErrorNotice"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { useT } from "@/i18n/i18n"
import { appCommandAriaShortcut } from "@/lib/app-shortcuts"
import { cn } from "@/lib/utils"

const taskSessionPageSize = 50

export const AppShellNavigationSidebar = React.memo(function AppShellNavigationSidebar({
  account,
  activeRoute,
  authenticated,
  cloudEnabled,
  collapsed,
  collapsedProjectIds,
  hasUnreadSession,
  hasUnreadTeam,
  hasUnreadTeams,
  isSessionRunning,
  loggingOut,
  loggingIn,
  newChatLabel,
  onArchiveProjectRequest,
  onArchiveSessionRequest,
  onLogout,
  onLogin,
  onManageTasks,
  onNavigate,
  onNewSession,
  onOpenConnections,
  onOpenSearch,
  onPinProject,
  onPinSession,
  onProjectExpandedChange,
  onRemoveProjectRequest,
  onRenameProjectRequest,
  onRenameSessionRequest,
  onSelectProjectDraft,
  onSelectProjectFolder,
  onSelectSession,
  onSetSidebarSegment,
  onSetTaskSortMode,
  onShowProjectInFolder,
  onSidebarResizeKeyDown,
  onSidebarResizeStart,
  onToggleSidebar,
  onWorkspaceSwitchStart,
  projectPinnedGroups,
  projectPinnedSessions,
  projectRegularGroups,
  projectSessions,
  projectSidebarGroups,
  restoring,
  selectedSessionId,
  sessionsError,
  showKnowledge,
  sidebarSegment,
  sidebarSessionGroups,
  taskSessions,
  taskSortMode,
  width,
  workspace,
  workspaceSwitching,
}: {
  account?: AuthAccountSummary
  activeRoute: Route
  authenticated: boolean
  cloudEnabled: boolean
  collapsed: boolean
  collapsedProjectIds: ReadonlySet<string>
  hasUnreadSession: (sessionId: string) => boolean
  hasUnreadTeam: (teamId: string) => boolean
  hasUnreadTeams: boolean
  isSessionRunning: (sessionId: string) => boolean
  loggingOut: boolean
  loggingIn: boolean
  newChatLabel: string
  onArchiveProjectRequest: (project: SessionProject) => void
  onArchiveSessionRequest: (session: SessionInfo) => void
  onLogout: () => void
  onLogin: () => void
  onManageTasks: () => void
  onNavigate: (route: Route) => void
  onNewSession: () => void
  onOpenConnections: () => void
  onOpenSearch: () => void
  onPinProject: (project: SessionProject) => void
  onPinSession: (session: SessionInfo) => void
  onProjectExpandedChange: (projectId: string, expanded: boolean) => void
  onRemoveProjectRequest: (project: SessionProject) => void
  onRenameProjectRequest: (project: SessionProject) => void
  onRenameSessionRequest: (session: SessionInfo) => void
  onSelectProjectDraft: (project: SessionProject) => void
  onSelectProjectFolder: () => void
  onSelectSession: (session: SessionInfo) => void
  onSetSidebarSegment: (segment: SidebarSegment) => void
  onSetTaskSortMode: (mode: SidebarTaskSortMode) => void
  onShowProjectInFolder: (project: SessionProject) => void
  onSidebarResizeKeyDown: (event: React.KeyboardEvent<HTMLDivElement>) => void
  onSidebarResizeStart: (event: React.PointerEvent<HTMLDivElement>) => void
  onToggleSidebar: () => void
  onWorkspaceSwitchStart: (targetScopeKey: string) => void
  projectPinnedGroups: ProjectSidebarGroup[]
  projectPinnedSessions: SessionInfo[]
  projectRegularGroups: ProjectSidebarGroup[]
  projectSessions: SessionInfo[]
  projectSidebarGroups: ProjectSidebarGroup[]
  restoring: boolean
  selectedSessionId: string | null
  sessionsError: UserFacingError | null
  showKnowledge: boolean
  sidebarSegment: SidebarSegment
  sidebarSessionGroups: SidebarSessionGroups
  taskSessions: SessionInfo[]
  taskSortMode: SidebarTaskSortMode
  width: number
  workspace: UseTeamWorkspace
  workspaceSwitching: boolean
}) {
  const t = useT()
  const sidebarHidden = collapsed || restoring
  const [now, setNow] = React.useState(() => Date.now())
  const [taskSessionLimit, setTaskSessionLimit] = React.useState(taskSessionPageSize)
  React.useEffect(() => {
    setTaskSessionLimit(taskSessionPageSize)
  }, [workspace.activeWorkspace.teamId])
  React.useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 60_000)
    return () => window.clearInterval(id)
  }, [])
  const projectsWithRunningSessions = React.useMemo(
    () => runningProjectIds(projectSessions, isSessionRunning),
    [isSessionRunning, projectSessions],
  )
  const visibleTaskSessionGroups = React.useMemo(
    () => limitSidebarSessionGroups(sidebarSessionGroups, taskSessionLimit, selectedSessionId),
    [selectedSessionId, sidebarSessionGroups, taskSessionLimit],
  )
  const renderProjectGroup = (group: ProjectSidebarGroup) => (
    <ProjectSidebarGroupItem
      key={group.project.id}
      group={group}
      selectedSessionId={activeRoute === "chat" ? selectedSessionId : null}
      expanded={!collapsedProjectIds.has(group.project.id)}
      hasUnreadSession={hasUnreadSession}
      isSessionRunning={isSessionRunning}
      now={now}
      running={projectsWithRunningSessions.has(group.project.id)}
      onExpandedChange={(expanded) => onProjectExpandedChange(group.project.id, expanded)}
      onNewSession={onSelectProjectDraft}
      onPinProject={onPinProject}
      onShowProjectInFolder={onShowProjectInFolder}
      onRenameProject={onRenameProjectRequest}
      onArchiveProject={onArchiveProjectRequest}
      onRemoveProject={onRemoveProjectRequest}
      onSelectSession={onSelectSession}
      onRenameSession={onRenameSessionRequest}
      onPinSession={onPinSession}
      onArchiveSession={onArchiveSessionRequest}
    />
  )
  const renderSession = (session: SessionInfo) => (
    <SessionItem
      key={session.id}
      session={session}
      selected={activeRoute === "chat" && selectedSessionId === session.id}
      running={isSessionRunning(session.id)}
      unread={hasUnreadSession(session.id)}
      now={now}
      onSelect={() => onSelectSession(session)}
      onRenameRequest={() => onRenameSessionRequest(session)}
      onPinToggle={() => onPinSession(session)}
      onArchive={() => onArchiveSessionRequest(session)}
    />
  )
  const renderTaskSectionHeader = () => (
    <div className="group mb-2 flex h-7 items-center justify-between px-3">
      <div className="oo-sidebar-section-heading oo-text-caption">{t("sidebar.tasks")}</div>
      <div className="pointer-events-none -mr-1 flex items-center gap-0.5 text-sidebar-foreground/45 opacity-0 transition-opacity group-hover:pointer-events-auto group-hover:opacity-100 focus-within:pointer-events-auto focus-within:opacity-100 has-[[data-state=open]]:pointer-events-auto has-[[data-state=open]]:opacity-100">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              title={t("tasks.moreActions")}
              aria-label={t("tasks.moreActions")}
              className="flex size-6 items-center justify-center rounded hover:bg-sidebar-accent/60 hover:text-sidebar-foreground/75"
            >
              <Ellipsis className="size-3.5" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="min-w-48">
            <DropdownMenuItem onSelect={onManageTasks}>
              <ListChecks className="size-4" />
              {t("tasks.organize")}
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => onNavigate("archived")}>
              <Archive className="size-4" />
              {t("tasks.viewArchived")}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuLabel>{t("tasks.sortLabel")}</DropdownMenuLabel>
            {(
              [
                ["updatedAt", t("tasks.sortUpdated")],
                ["createdAt", t("tasks.sortCreated")],
                ["title", t("tasks.sortTitle")],
              ] satisfies Array<[SidebarTaskSortMode, string]>
            ).map(([value, label]) => (
              <DropdownMenuItem key={value} onSelect={() => onSetTaskSortMode(value)}>
                <span>{label}</span>
                {taskSortMode === value ? <Check className="ml-auto size-4" /> : null}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
        <button
          type="button"
          title={newChatLabel}
          aria-label={newChatLabel}
          aria-keyshortcuts={appCommandAriaShortcut(APP_COMMANDS.newChat)}
          onClick={onNewSession}
          className="flex size-6 items-center justify-center rounded hover:bg-sidebar-accent/60 hover:text-sidebar-foreground/75"
        >
          <SquarePen className="size-3.5" />
        </button>
      </div>
    </div>
  )

  return (
    <aside
      aria-hidden={sidebarHidden}
      inert={sidebarHidden}
      className="oo-sidebar oo-border-divider relative z-[80] flex min-h-0 flex-col overflow-visible border-r"
    >
      <header
        data-slot="sidebar-chrome-header"
        className="oo-sidebar-chrome-header relative flex h-[var(--app-titlebar-height)] items-center justify-between gap-3 [-webkit-app-region:drag]"
      >
        <div className="oo-sidebar-chrome-brand min-w-0 items-center gap-2">
          <BrandIcon className="size-6" />
        </div>
        <div className="oo-sidebar-titlebar-actions-expanded ml-auto">
          <SidebarTitlebarActions collapsed={collapsed} onToggleCollapsed={onToggleSidebar} onSearch={onOpenSearch} />
        </div>
      </header>

      <div className="oo-sidebar-content flex min-h-0 flex-1 flex-col">
        <nav aria-label="primary" className="grid gap-1 px-3 pt-0 pb-3 [-webkit-app-region:no-drag]">
          <button
            type="button"
            onClick={onNewSession}
            title={newChatLabel}
            aria-label={newChatLabel}
            aria-keyshortcuts={appCommandAriaShortcut(APP_COMMANDS.newChat)}
            className="oo-sidebar-nav-item oo-text-body flex h-[var(--sidebar-item-height)] items-center gap-2 rounded-md px-2"
          >
            <SquarePen className="size-4 shrink-0" />
            <span className="oo-sidebar-nav-label truncate">{t("sidebar.newSession")}</span>
          </button>
          <button
            type="button"
            onClick={onOpenConnections}
            className={cn(
              "oo-sidebar-nav-item oo-text-body flex h-[var(--sidebar-item-height)] items-center gap-2 rounded-md px-2",
              activeRoute === "connections" && "bg-sidebar-accent text-sidebar-accent-foreground",
            )}
          >
            <Plug className="size-4 shrink-0" />
            <span className="oo-sidebar-nav-label truncate">{t("connections.title")}</span>
          </button>
          <button
            type="button"
            onClick={() => onNavigate("skills")}
            className={cn(
              "oo-sidebar-nav-item oo-text-body flex h-[var(--sidebar-item-height)] items-center gap-2 rounded-md px-2",
              activeRoute === "skills" && "bg-sidebar-accent text-sidebar-accent-foreground",
            )}
          >
            <Package className="size-4 shrink-0" />
            <span className="oo-sidebar-nav-label truncate">{t("skills.title")}</span>
          </button>
          {showKnowledge ? (
            <button
              type="button"
              onClick={() => onNavigate("knowledge")}
              className={cn(
                "oo-sidebar-nav-item oo-text-body flex h-[var(--sidebar-item-height)] items-center gap-2 rounded-md px-2",
                activeRoute === "knowledge" && "bg-sidebar-accent text-sidebar-accent-foreground",
              )}
            >
              <LibraryBig className="size-4 shrink-0" />
              <span className="oo-sidebar-nav-label truncate">{t("knowledge.title")}</span>
            </button>
          ) : null}
          {cloudEnabled ? (
            <button
              type="button"
              onClick={() => onNavigate("teams")}
              className={cn(
                "oo-sidebar-nav-item oo-text-body flex h-[var(--sidebar-item-height)] items-center gap-2 rounded-md px-2",
                activeRoute === "teams" && "bg-sidebar-accent text-sidebar-accent-foreground",
              )}
            >
              <Building2 className="size-4 shrink-0" />
              <span className="oo-sidebar-nav-label truncate">{t("teams.title")}</span>
            </button>
          ) : null}
        </nav>

        <nav className="flex min-h-0 flex-1 flex-col px-3 [-webkit-app-region:no-drag]">
          <div className="pb-2">
            <SidebarSegmentControl value={sidebarSegment} onChange={onSetSidebarSegment} />
          </div>
          <div className="oo-sidebar-session-scroll -mx-3 flex min-h-0 flex-1 flex-col overflow-y-auto px-3 pb-2">
            {sessionsError ? (
              <>
                {sidebarSegment === "tasks" ? renderTaskSectionHeader() : null}
                <ErrorNotice error={sessionsError} compact className="mx-0" />
              </>
            ) : sidebarSegment === "projects" ? (
              projectSidebarGroups.length > 0 ? (
                <div className="grid gap-2">
                  {projectPinnedGroups.length > 0 || projectPinnedSessions.length > 0 ? (
                    <div className="grid gap-1">
                      <div className="oo-sidebar-section-heading oo-text-caption px-3 pt-1 pb-1">
                        {t("sidebar.pinned")}
                      </div>
                      {projectPinnedSessions.map(renderSession)}
                      {projectPinnedGroups.map(renderProjectGroup)}
                    </div>
                  ) : null}
                  {projectRegularGroups.length > 0 ? (
                    <div className="grid gap-1">
                      <div className="group flex items-center justify-between px-3 pt-1">
                        <div className="oo-sidebar-section-heading oo-text-caption">{t("sidebar.projects")}</div>
                        <button
                          type="button"
                          title={t("project.selectFolder")}
                          aria-label={t("project.selectFolder")}
                          className="pointer-events-none flex size-5 items-center justify-center rounded opacity-0 group-focus-within:pointer-events-auto group-focus-within:opacity-100 group-hover:pointer-events-auto group-hover:opacity-100 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground focus-visible:pointer-events-auto focus-visible:bg-sidebar-accent focus-visible:text-sidebar-accent-foreground focus-visible:opacity-100"
                          onClick={(event) => {
                            event.currentTarget.blur()
                            onSelectProjectFolder()
                          }}
                        >
                          <FolderPlus className="size-3.5" />
                        </button>
                      </div>
                      {projectRegularGroups.map(renderProjectGroup)}
                    </div>
                  ) : null}
                </div>
              ) : (
                <ProjectSidebarEmptyState onSelectFolder={onSelectProjectFolder} />
              )
            ) : taskSessions.length > 0 ? (
              <div className="grid gap-3">
                {visibleTaskSessionGroups.pinned.length > 0 ? (
                  <div className="grid gap-0.5">
                    <div className="oo-sidebar-section-heading oo-text-caption px-3 pt-1 pb-2">
                      {t("sidebar.pinned")}
                    </div>
                    {visibleTaskSessionGroups.pinned.map(renderSession)}
                  </div>
                ) : null}
                <div className="grid gap-0.5">
                  {renderTaskSectionHeader()}
                  {visibleTaskSessionGroups.regular.map(renderSession)}
                </div>
                {visibleTaskSessionGroups.hiddenCount > 0 ? (
                  <button
                    type="button"
                    className="oo-text-control mx-3 h-8 rounded-md px-3 text-left text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
                    onClick={() => setTaskSessionLimit((current) => current + taskSessionPageSize)}
                  >
                    {t("sidebar.showMoreTasks", {
                      count: Math.min(taskSessionPageSize, visibleTaskSessionGroups.hiddenCount),
                    })}
                  </button>
                ) : null}
              </div>
            ) : (
              <>
                {renderTaskSectionHeader()}
                <SidebarEmptyState />
              </>
            )}
          </div>

          <SidebarFooterControls
            account={account}
            authenticated={authenticated}
            cloudEnabled={cloudEnabled}
            hasUnreadTeam={hasUnreadTeam}
            hasUnreadTeams={hasUnreadTeams}
            activeRoute={activeRoute}
            loggingOut={loggingOut}
            loggingIn={loggingIn}
            workspace={workspace}
            workspaceSwitching={workspaceSwitching}
            onNavigate={onNavigate}
            onLogout={onLogout}
            onLogin={onLogin}
            onWorkspaceSwitchStart={onWorkspaceSwitchStart}
          />
        </nav>
      </div>
      <div
        role="separator"
        aria-orientation="vertical"
        aria-label={t("aria.resizeSidebar")}
        aria-valuemin={SIDEBAR_MIN_WIDTH_PX}
        aria-valuemax={SIDEBAR_MAX_WIDTH_PX}
        aria-valuenow={width}
        title={t("aria.resizeSidebar")}
        tabIndex={collapsed ? -1 : 0}
        className="oo-sidebar-resize-handle"
        onPointerDown={onSidebarResizeStart}
        onKeyDown={onSidebarResizeKeyDown}
      />
    </aside>
  )
})
