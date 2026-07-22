import type { AppShellRoute } from "./app-shell-types.ts"
import type { UseTeamWorkspace, WorkspaceSelection } from "@/hooks/useTeamWorkspace"

import {
  AlertTriangle,
  Archive,
  Building2,
  ChevronsUpDown,
  LoaderCircle,
  Laptop,
  LogIn,
  LogOut,
  Package,
  Plug,
  RefreshCw,
  Settings,
} from "lucide-react"
import * as React from "react"
import { workspaceSelectionSwitchKey } from "./app-shell-model.ts"
import { CachedAvatarImage } from "@/components/CachedAvatarImage"
import { ErrorNotice } from "@/components/ErrorNotice"
import { Badge } from "@/components/ui/badge"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { teamAvatarStyle, teamInitials } from "@/hooks/useTeamWorkspace"
import { useT } from "@/i18n/i18n"
import { cn } from "@/lib/utils"

function accountInitial(name?: string): string {
  const trimmed = name?.trim()
  return trimmed ? trimmed.charAt(0).toLocaleUpperCase() : "L"
}

function WorkspaceAvatar({ className = "size-7", workspace }: { className?: string; workspace: WorkspaceSelection }) {
  if (workspace.kind === "local") {
    return (
      <span className={cn("grid shrink-0 place-items-center rounded-full border bg-background", className)}>
        <Laptop className="size-3.5" aria-hidden="true" />
      </span>
    )
  }
  const avatarUrl = workspace.avatarPreviewUrl ?? workspace.team?.avatar
  const fallback = teamInitials(workspace.team?.name ?? workspace.teamId)
  const fallbackStyle = teamAvatarStyle(workspace.teamId)

  return (
    <span
      className={cn(
        "relative grid shrink-0 place-items-center overflow-hidden rounded-full border bg-background text-xs font-medium text-foreground",
        className,
      )}
      style={fallbackStyle}
    >
      <span aria-hidden="true" className="min-w-0">
        {fallback}
      </span>
      <CachedAvatarImage src={avatarUrl} alt="" className="absolute inset-0 size-full object-cover" />
    </span>
  )
}

function WorkspaceMenuContent({
  loading,
  onManageTeams,
  onRefresh,
  onSelectTeam,
  error,
  getTeamCanManage,
  getTeamRole,
  hasLoaded,
  teams,
  workspace,
}: {
  error: UseTeamWorkspace["error"]
  getTeamCanManage: UseTeamWorkspace["getTeamCanManage"]
  getTeamRole: UseTeamWorkspace["getTeamRole"]
  hasLoaded: boolean
  loading: boolean
  onManageTeams: () => void
  onRefresh: () => void
  onSelectTeam: (teamId: string) => void
  teams: UseTeamWorkspace["teams"]
  workspace: WorkspaceSelection
}) {
  const t = useT()
  const activeKey = workspaceSelectionSwitchKey(workspace)
  const showBlockingError = Boolean(error && !hasLoaded)
  const showRefreshWarning = Boolean(error && hasLoaded)
  const workspaceItemClassName =
    "my-1 grid w-full min-w-0 grid-cols-[2.5rem_minmax(0,1fr)_4.5rem] items-center gap-2 rounded-md px-2 py-2 text-left outline-none data-[active=true]:bg-accent data-[active=true]:text-accent-foreground focus:bg-accent focus:text-accent-foreground hover:bg-accent hover:text-accent-foreground"

  return (
    <DropdownMenuContent side="top" align="start" sideOffset={8} className="w-72">
      <div className="flex items-center justify-between gap-2 px-2 py-1.5">
        <div className="min-w-0 truncate text-sm font-medium">{t("teams.workspaceGroup")}</div>
        <DropdownMenuItem
          className="flex size-7 shrink-0 items-center justify-center rounded-sm text-muted-foreground outline-none hover:bg-accent hover:text-accent-foreground focus:bg-accent focus:text-accent-foreground disabled:cursor-not-allowed disabled:opacity-60"
          disabled={loading}
          title={error ? t("teams.retry") : t("teams.refreshWorkspaces")}
          aria-label={error ? t("teams.retry") : t("teams.refreshWorkspaces")}
          onSelect={(event) => {
            event.preventDefault()
            onRefresh()
          }}
        >
          <RefreshCw className={cn("size-4", loading && "animate-spin")} />
        </DropdownMenuItem>
      </div>
      {showBlockingError && error ? (
        <div className="px-2 py-1.5">
          <ErrorNotice error={error} compact />
        </div>
      ) : null}
      {showRefreshWarning ? (
        <div className="oo-text-caption-compact mx-2 my-1.5 flex min-w-0 items-start gap-2 rounded-md border border-[var(--oo-warning-border)] bg-[var(--oo-warning-surface)] px-2.5 py-2 text-muted-foreground">
          <AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-[var(--oo-warning-foreground)]" />
          <span className="min-w-0">{t("teams.refreshFailedDescription")}</span>
        </div>
      ) : null}
      {teams.map((team) => {
        const selected = activeKey === `team:${team.id}`
        const role = getTeamRole(team)
        const canManage = getTeamCanManage(team)
        return (
          <DropdownMenuItem
            key={team.id}
            className={workspaceItemClassName}
            onSelect={() => onSelectTeam(team.id)}
            data-active={selected}
            aria-current={selected ? "true" : undefined}
          >
            <WorkspaceAvatar workspace={{ canManage, team, teamId: team.id, role }} />
            <span className="min-w-0 flex-1 truncate">{team.name}</span>
            <Badge variant="outline" className="flex w-full justify-end px-0 text-right font-normal">
              {role === "creator" ? t("teams.roleCreator") : t("teams.roleMember")}
            </Badge>
          </DropdownMenuItem>
        )
      })}
      {!loading && teams.length === 0 && !showBlockingError ? (
        <div className="oo-text-caption oo-text-muted px-2 py-1.5">{t("teams.emptyTeams")}</div>
      ) : null}
      <DropdownMenuSeparator />
      <DropdownMenuItem onSelect={onManageTeams}>
        <Building2 className="size-4" />
        {t("teams.manageTeams")}
      </DropdownMenuItem>
    </DropdownMenuContent>
  )
}

function AccountMenuContent({
  authenticated,
  avatarUrl,
  cloudEnabled,
  displayName,
  loggingIn,
  loggingOut,
  onClose,
  onLogin,
  onLogout,
  onNavigate,
}: {
  authenticated: boolean
  avatarUrl?: string
  cloudEnabled: boolean
  displayName: string
  loggingIn: boolean
  loggingOut: boolean
  onClose: () => void
  onLogin: () => void
  onLogout: () => void
  onNavigate: (route: AppShellRoute) => void
}) {
  const t = useT()
  return (
    <DropdownMenuContent side="top" align="end" sideOffset={8} className="w-56">
      <DropdownMenuLabel>
        <div className="flex min-w-0 items-center gap-2">
          <AccountAvatar name={displayName} avatarUrl={avatarUrl} />
          <span className="truncate">{displayName}</span>
        </div>
      </DropdownMenuLabel>
      <DropdownMenuSeparator />
      {cloudEnabled ? (
        <DropdownMenuItem
          onSelect={() => {
            onClose()
            onNavigate("connections")
          }}
        >
          <Plug className="size-4" />
          {t("connections.title")}
        </DropdownMenuItem>
      ) : null}
      {cloudEnabled ? (
        <DropdownMenuItem
          onSelect={() => {
            onClose()
            onNavigate("skills")
          }}
        >
          <Package className="size-4" />
          {t("skills.title")}
        </DropdownMenuItem>
      ) : null}
      <DropdownMenuItem
        onSelect={() => {
          onClose()
          onNavigate("archived")
        }}
      >
        <Archive className="size-4" />
        {t("archived.navTitle")}
      </DropdownMenuItem>
      <DropdownMenuItem
        onSelect={() => {
          onClose()
          onNavigate("settings")
        }}
      >
        <Settings className="size-4" />
        {t("settings.title")}
      </DropdownMenuItem>
      <DropdownMenuSeparator />
      {authenticated ? (
        <DropdownMenuItem
          disabled={loggingOut}
          variant="destructive"
          onSelect={() => {
            onClose()
            onLogout()
          }}
        >
          <LogOut className="size-4" />
          {t("settings.logout")}
        </DropdownMenuItem>
      ) : (
        <DropdownMenuItem
          disabled={loggingIn}
          onSelect={() => {
            onClose()
            onLogin()
          }}
        >
          <LogIn className="size-4" />
          {loggingIn ? t("login.waiting") : t("login.button")}
        </DropdownMenuItem>
      )}
    </DropdownMenuContent>
  )
}

export function SidebarFooterControls({
  accountName,
  authenticated,
  avatarUrl,
  cloudEnabled,
  activeRoute,
  loggingOut,
  loggingIn,
  onNavigate,
  onLogout,
  onLogin,
  onWorkspaceSwitchStart,
  workspace,
  workspaceSwitching,
}: {
  accountName?: string
  authenticated: boolean
  avatarUrl?: string
  cloudEnabled: boolean
  activeRoute: AppShellRoute
  loggingOut: boolean
  loggingIn: boolean
  onNavigate: (route: AppShellRoute) => void
  onLogout: () => void
  onLogin: () => void
  onWorkspaceSwitchStart: (targetScopeKey: string) => void
  workspace: UseTeamWorkspace
  workspaceSwitching: boolean
}) {
  const t = useT()
  const [workspaceMenuOpen, setWorkspaceMenuOpen] = React.useState(false)
  const [accountMenuOpen, setAccountMenuOpen] = React.useState(false)
  const trimmedAccountName = accountName?.trim()
  const displayName = trimmedAccountName || t("workspace.local")
  const activeWorkspaceLabel =
    workspace.activeWorkspace.kind === "local"
      ? t("workspace.local")
      : (workspace.activeWorkspace.team?.name ?? t("teams.workspace"))
  const workspaceButtonTitle = workspaceSwitching ? t("sidebar.switchingAccount") : activeWorkspaceLabel

  React.useEffect(() => {
    if (workspaceSwitching) {
      setWorkspaceMenuOpen(false)
    }
  }, [workspaceSwitching])

  const closeMenus = React.useCallback(() => {
    setWorkspaceMenuOpen(false)
    setAccountMenuOpen(false)
  }, [])
  const handleWorkspaceMenuOpenChange = React.useCallback(
    (open: boolean) => {
      setWorkspaceMenuOpen(open)
      if (open && !workspace.loading) {
        void workspace.refresh()
      }
      if (open) {
        setAccountMenuOpen(false)
      }
    },
    [workspace],
  )
  const handleAccountMenuOpenChange = React.useCallback((open: boolean) => {
    setAccountMenuOpen(open)
    if (open) setWorkspaceMenuOpen(false)
  }, [])
  const accountMenuContent = (
    <AccountMenuContent
      authenticated={authenticated}
      avatarUrl={avatarUrl}
      cloudEnabled={cloudEnabled}
      displayName={displayName}
      loggingIn={loggingIn}
      loggingOut={loggingOut}
      onClose={closeMenus}
      onLogin={onLogin}
      onLogout={onLogout}
      onNavigate={onNavigate}
    />
  )

  return (
    <div className="oo-sidebar-account relative -mx-3 flex h-12 shrink-0 items-center gap-1 px-3 [-webkit-app-region:no-drag]">
      {cloudEnabled ? (
        <>
          <DropdownMenu open={workspaceMenuOpen} onOpenChange={handleWorkspaceMenuOpenChange}>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                className="oo-sidebar-nav-item oo-sidebar-workspace-trigger flex h-9 min-w-0 flex-1 items-center gap-2 rounded-md px-1.5 text-left disabled:cursor-default disabled:opacity-80"
                aria-busy={workspaceSwitching}
                aria-label={workspaceSwitching ? t("sidebar.switchingAccount") : t("teams.workspaceSwitcher")}
                aria-expanded={workspaceMenuOpen}
                disabled={workspaceSwitching}
                title={workspaceButtonTitle}
              >
                <WorkspaceAvatar className="size-7" workspace={workspace.activeWorkspace} />
                <div className="oo-sidebar-nav-label min-w-0 flex-1">
                  <div className="oo-text-body truncate text-sidebar-foreground" title={activeWorkspaceLabel}>
                    {activeWorkspaceLabel}
                  </div>
                </div>
                {workspaceSwitching ? (
                  <LoaderCircle className="oo-sidebar-nav-label size-4 shrink-0 animate-spin text-muted-foreground" />
                ) : (
                  <ChevronsUpDown className="oo-sidebar-nav-label size-4 shrink-0 text-muted-foreground" />
                )}
              </button>
            </DropdownMenuTrigger>
            <WorkspaceMenuContent
              error={workspace.error}
              getTeamCanManage={workspace.getTeamCanManage}
              getTeamRole={workspace.getTeamRole}
              hasLoaded={workspace.hasLoaded}
              loading={workspace.loading}
              teams={workspace.teams}
              workspace={workspace.activeWorkspace}
              onManageTeams={() => {
                closeMenus()
                onNavigate("teams")
              }}
              onRefresh={() => void workspace.refresh({ forceRefresh: true })}
              onSelectTeam={(teamId) => {
                closeMenus()
                onWorkspaceSwitchStart(`team:${teamId}`)
                workspace.selectTeam(teamId)
              }}
            />
          </DropdownMenu>

          <DropdownMenu open={accountMenuOpen} onOpenChange={handleAccountMenuOpenChange}>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                className={cn(
                  "oo-sidebar-account-trigger oo-sidebar-nav-item flex size-9 shrink-0 items-center justify-center rounded-md",
                  (accountMenuOpen || activeRoute === "settings" || activeRoute === "archived") &&
                    "bg-sidebar-accent text-sidebar-accent-foreground",
                )}
                data-active={activeRoute === "settings" || activeRoute === "archived" ? "true" : undefined}
                aria-label={t("sidebar.accountMenu")}
                title={t("settings.title")}
              >
                <Settings className="size-4" />
              </button>
            </DropdownMenuTrigger>
            {accountMenuContent}
          </DropdownMenu>
        </>
      ) : (
        <DropdownMenu open={accountMenuOpen} onOpenChange={handleAccountMenuOpenChange}>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              className="oo-sidebar-local-menu-trigger oo-sidebar-nav-item mx-1 mb-1 flex h-9 min-w-0 flex-1 items-center gap-2 rounded-md px-2 text-left"
              aria-label={t("sidebar.localWorkspaceMenu")}
              aria-expanded={accountMenuOpen}
              title={t("sidebar.localWorkspaceMenu")}
            >
              <WorkspaceAvatar className="size-7" workspace={workspace.activeWorkspace} />
              <span className="oo-sidebar-nav-label oo-text-body min-w-0 flex-1 truncate text-sidebar-foreground">
                {activeWorkspaceLabel}
              </span>
              <span className="oo-sidebar-local-menu-indicator oo-sidebar-nav-label grid size-7 shrink-0 place-items-center rounded-md text-muted-foreground">
                <Settings className="size-4" aria-hidden="true" />
              </span>
            </button>
          </DropdownMenuTrigger>
          {accountMenuContent}
        </DropdownMenu>
      )}
    </div>
  )
}

function AccountAvatar({ name, avatarUrl }: { name: string; avatarUrl?: string }) {
  return (
    <div className="relative flex size-7 shrink-0 items-center justify-center overflow-hidden rounded-full bg-muted text-xs font-medium text-foreground">
      <span aria-hidden="true">{accountInitial(name)}</span>
      <CachedAvatarImage src={avatarUrl} alt="" className="absolute inset-0 size-full object-cover" />
    </div>
  )
}
