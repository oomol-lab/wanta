import type { AppShellRoute } from "./app-shell-types.ts"
import type { UseOrganizationWorkspace, WorkspaceSelection } from "@/hooks/useOrganizationWorkspace"

import {
  AlertTriangle,
  Archive,
  Building2,
  ChevronsUpDown,
  LoaderCircle,
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
import { organizationAvatarStyle, organizationInitials } from "@/hooks/useOrganizationWorkspace"
import { useT } from "@/i18n/i18n"
import { cn } from "@/lib/utils"

function accountInitial(name?: string): string {
  const trimmed = name?.trim()
  return trimmed ? trimmed.charAt(0).toLocaleUpperCase() : "L"
}

function WorkspaceAvatar({ className = "size-7", workspace }: { className?: string; workspace: WorkspaceSelection }) {
  const avatarUrl = workspace.avatarPreviewUrl ?? workspace.organization?.avatar
  const fallback = organizationInitials(workspace.organization?.name ?? workspace.organizationId)
  const fallbackStyle = organizationAvatarStyle(workspace.organizationId)

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
  onManageOrganizations,
  onRefresh,
  onSelectOrganization,
  error,
  getOrganizationCanManage,
  getOrganizationRole,
  hasLoaded,
  organizations,
  workspace,
}: {
  error: UseOrganizationWorkspace["error"]
  getOrganizationCanManage: UseOrganizationWorkspace["getOrganizationCanManage"]
  getOrganizationRole: UseOrganizationWorkspace["getOrganizationRole"]
  hasLoaded: boolean
  loading: boolean
  onManageOrganizations: () => void
  onRefresh: () => void
  onSelectOrganization: (organizationId: string) => void
  organizations: UseOrganizationWorkspace["organizations"]
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
        <div className="min-w-0 truncate text-sm font-medium">{t("organizations.workspaceGroup")}</div>
        <DropdownMenuItem
          className="flex size-7 shrink-0 items-center justify-center rounded-sm text-muted-foreground outline-none hover:bg-accent hover:text-accent-foreground focus:bg-accent focus:text-accent-foreground disabled:cursor-not-allowed disabled:opacity-60"
          disabled={loading}
          title={error ? t("organizations.retry") : t("organizations.refreshWorkspaces")}
          aria-label={error ? t("organizations.retry") : t("organizations.refreshWorkspaces")}
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
          <span className="min-w-0">{t("organizations.refreshFailedDescription")}</span>
        </div>
      ) : null}
      {organizations.map((organization) => {
        const selected = activeKey === `organization:${organization.id}`
        const role = getOrganizationRole(organization)
        const canManage = getOrganizationCanManage(organization)
        return (
          <DropdownMenuItem
            key={organization.id}
            className={workspaceItemClassName}
            onSelect={() => onSelectOrganization(organization.id)}
            data-active={selected}
            aria-current={selected ? "true" : undefined}
          >
            <WorkspaceAvatar workspace={{ canManage, organization, organizationId: organization.id, role }} />
            <span className="min-w-0 flex-1 truncate">{organization.name}</span>
            <Badge variant="outline" className="flex w-full justify-end px-0 text-right font-normal">
              {role === "creator" ? t("organizations.roleCreator") : t("organizations.roleMember")}
            </Badge>
          </DropdownMenuItem>
        )
      })}
      {!loading && organizations.length === 0 && !showBlockingError ? (
        <div className="oo-text-caption oo-text-muted px-2 py-1.5">{t("organizations.emptyOrganizations")}</div>
      ) : null}
      <DropdownMenuSeparator />
      <DropdownMenuItem onSelect={onManageOrganizations}>
        <Building2 className="size-4" />
        {t("organizations.manageOrganizations")}
      </DropdownMenuItem>
    </DropdownMenuContent>
  )
}

export function SidebarFooterControls({
  accountName,
  avatarUrl,
  activeRoute,
  loggingOut,
  onNavigate,
  onLogout,
  onWorkspaceSwitchStart,
  workspace,
  workspaceSwitching,
}: {
  accountName?: string
  avatarUrl?: string
  activeRoute: AppShellRoute
  loggingOut: boolean
  onNavigate: (route: AppShellRoute) => void
  onLogout: () => void
  onWorkspaceSwitchStart: (targetScopeKey: string) => void
  workspace: UseOrganizationWorkspace
  workspaceSwitching: boolean
}) {
  const t = useT()
  const [workspaceMenuOpen, setWorkspaceMenuOpen] = React.useState(false)
  const [accountMenuOpen, setAccountMenuOpen] = React.useState(false)
  const trimmedAccountName = accountName?.trim()
  const displayName = trimmedAccountName || t("settings.account")
  const activeWorkspaceLabel = workspace.activeWorkspace.organization?.name ?? t("organizations.workspace")
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

  return (
    <div className="oo-sidebar-account relative -mx-3 flex h-12 shrink-0 items-center gap-1 px-3 [-webkit-app-region:no-drag]">
      <DropdownMenu open={workspaceMenuOpen} onOpenChange={handleWorkspaceMenuOpenChange}>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            className="oo-sidebar-nav-item oo-sidebar-workspace-trigger flex h-10 min-w-0 flex-1 items-center gap-2 rounded-md px-1.5 text-left disabled:cursor-default disabled:opacity-80"
            aria-busy={workspaceSwitching}
            aria-label={workspaceSwitching ? t("sidebar.switchingAccount") : t("organizations.workspaceSwitcher")}
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
          getOrganizationCanManage={workspace.getOrganizationCanManage}
          getOrganizationRole={workspace.getOrganizationRole}
          hasLoaded={workspace.hasLoaded}
          loading={workspace.loading}
          organizations={workspace.organizations}
          workspace={workspace.activeWorkspace}
          onManageOrganizations={() => {
            closeMenus()
            onNavigate("organizations")
          }}
          onRefresh={() => void workspace.refresh({ forceRefresh: true })}
          onSelectOrganization={(organizationId) => {
            closeMenus()
            onWorkspaceSwitchStart(`organization:${organizationId}`)
            workspace.selectOrganization(organizationId)
          }}
        />
      </DropdownMenu>

      <DropdownMenu
        open={accountMenuOpen}
        onOpenChange={(open) => {
          setAccountMenuOpen(open)
          if (open) setWorkspaceMenuOpen(false)
        }}
      >
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            className={cn(
              "oo-sidebar-nav-item flex size-10 shrink-0 items-center justify-center rounded-md",
              (activeRoute === "settings" || activeRoute === "archived") &&
                "bg-sidebar-accent text-sidebar-accent-foreground",
            )}
            aria-label={t("sidebar.accountMenu")}
            title={t("settings.title")}
          >
            <Settings className="size-4" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent side="top" align="end" sideOffset={8} className="w-56">
          <DropdownMenuLabel>
            <div className="flex min-w-0 items-center gap-2">
              <AccountAvatar name={displayName} avatarUrl={avatarUrl} />
              <span className="truncate">{displayName}</span>
            </div>
          </DropdownMenuLabel>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            onSelect={() => {
              closeMenus()
              onNavigate("connections")
            }}
          >
            <Plug className="size-4" />
            {t("connections.title")}
          </DropdownMenuItem>
          <DropdownMenuItem
            onSelect={() => {
              closeMenus()
              onNavigate("skills")
            }}
          >
            <Package className="size-4" />
            {t("skills.title")}
          </DropdownMenuItem>
          <DropdownMenuItem
            onSelect={() => {
              closeMenus()
              onNavigate("archived")
            }}
          >
            <Archive className="size-4" />
            {t("archived.navTitle")}
          </DropdownMenuItem>
          <DropdownMenuItem
            onSelect={() => {
              closeMenus()
              onNavigate("settings")
            }}
          >
            <Settings className="size-4" />
            {t("settings.title")}
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            disabled={loggingOut}
            variant="destructive"
            onSelect={() => {
              closeMenus()
              onLogout()
            }}
          >
            <LogOut className="size-4" />
            {t("settings.logout")}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
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
