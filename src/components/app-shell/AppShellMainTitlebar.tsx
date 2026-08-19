import type { SessionInfo } from "../../../electron/session/common.ts"
import type { BillingDetailsTarget } from "@/components/app-shell/BillingUsagePopover"
import type { UseAppUpdate } from "@/hooks/useAppUpdate"
import type { WorkspaceSelection } from "@/hooks/useTeamWorkspace"
import type { LucideIcon } from "lucide-react"

import { ChevronRight, Globe2, MoreHorizontal } from "lucide-react"
import * as React from "react"
import { EditableTitlebarTitle } from "./AppShellDialogs.tsx"
import { SidebarTitlebarActions } from "./AppShellSidebar.tsx"
import { BillingUsagePopover } from "@/components/app-shell/BillingUsagePopover"
import { AppUpdateTitlebarEntry } from "@/components/AppUpdateTitlebarEntry"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { cn } from "@/lib/utils"

interface TitlebarBreadcrumb {
  label: string
  path: string
}

function TitlebarBreadcrumbs({
  breadcrumbs,
  onNavigate,
}: {
  breadcrumbs: TitlebarBreadcrumb[]
  onNavigate: (path: string) => void
}) {
  const collapsed = breadcrumbs.length > 4 ? breadcrumbs.slice(1, -2) : []
  const visible = collapsed.length > 0 ? [breadcrumbs[0], ...breadcrumbs.slice(-2)] : breadcrumbs

  return (
    <nav
      aria-label={breadcrumbs.map((breadcrumb) => breadcrumb.label).join(" / ")}
      className="flex min-w-0 items-center"
    >
      {visible.map((breadcrumb, index) => {
        const originalIndex = collapsed.length > 0 && index > 0 ? breadcrumbs.length - (visible.length - index) : index
        const current = originalIndex === breadcrumbs.length - 1
        return (
          <React.Fragment key={breadcrumb.path || "__root__"}>
            {index > 0 ? <ChevronRight className="mx-1 size-3.5 shrink-0 text-muted-foreground/70" /> : null}
            {collapsed.length > 0 && index === 1 ? (
              <>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <button
                      type="button"
                      className="oo-toolbar-button mr-1 grid size-6 shrink-0 place-items-center rounded text-muted-foreground [-webkit-app-region:no-drag] hover:bg-accent hover:text-foreground"
                      aria-label={collapsed.map((item) => item.label).join(" / ")}
                    >
                      <MoreHorizontal className="size-4" />
                    </button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="start">
                    {collapsed.map((item) => (
                      <DropdownMenuItem key={item.path} onSelect={() => onNavigate(item.path)}>
                        {item.label}
                      </DropdownMenuItem>
                    ))}
                  </DropdownMenuContent>
                </DropdownMenu>
                <ChevronRight className="mx-1 size-3.5 shrink-0 text-muted-foreground/70" />
              </>
            ) : null}
            {current ? (
              <span className="max-w-56 truncate font-semibold text-foreground" title={breadcrumb.label}>
                {breadcrumb.label}
              </span>
            ) : (
              <button
                type="button"
                className="max-w-40 truncate rounded px-1 py-0.5 text-muted-foreground transition-colors [-webkit-app-region:no-drag] hover:bg-accent hover:text-foreground"
                title={breadcrumb.label}
                onClick={() => onNavigate(breadcrumb.path)}
              >
                {breadcrumb.label}
              </button>
            )}
          </React.Fragment>
        )
      })}
    </nav>
  )
}

export const AppShellMainTitlebar = React.memo(function AppShellMainTitlebar({
  activeSession,
  appUpdate,
  artifactsPanelOpen,
  artifactsToggleIcon: ArtifactsToggleIcon,
  artifactsToggleLabel,
  billingCacheScope,
  browserPanelOpen,
  browserToggleLabel,
  isSidebarRestoring,
  sharedConnectorCount,
  onArtifactsToggle,
  onBrowserToggle,
  onOpenSearch,
  onRenameSession,
  onTitlebarBreadcrumbNavigate,
  onToggleSidebar,
  onViewBilling,
  showArtifactsToggle,
  showBrowserToggle,
  sidebarCollapsed,
  titlebarEditable,
  titlebarBreadcrumbs,
  titlebarTitle,
  windowControlsOnRight,
  workspace,
}: {
  activeSession: SessionInfo | null
  appUpdate: UseAppUpdate
  artifactsPanelOpen: boolean
  artifactsToggleIcon: LucideIcon
  artifactsToggleLabel: string
  billingCacheScope: string
  browserPanelOpen: boolean
  browserToggleLabel: string
  isSidebarRestoring: boolean
  sharedConnectorCount?: number
  onArtifactsToggle: () => void
  onBrowserToggle: () => void
  onOpenSearch: () => void
  onRenameSession: (sessionId: string, title: string) => void
  onTitlebarBreadcrumbNavigate?: (path: string) => void
  onToggleSidebar: () => void
  onViewBilling?: (target?: BillingDetailsTarget) => void
  showArtifactsToggle: boolean
  showBrowserToggle: boolean
  sidebarCollapsed: boolean
  titlebarEditable: boolean
  titlebarBreadcrumbs?: TitlebarBreadcrumb[]
  titlebarTitle: string
  windowControlsOnRight: boolean
  workspace: WorkspaceSelection
}) {
  return (
    <header
      className={cn(
        "oo-titlebar oo-toolbar oo-main-titlebar oo-border-divider flex h-[var(--app-titlebar-height)] min-w-0 items-center overflow-hidden border-b [-webkit-app-region:drag]",
        windowControlsOnRight && "oo-titlebar-window-controls",
      )}
    >
      <div className="oo-titlebar-collapsed-controls shrink-0 items-center gap-3">
        <div className="oo-titlebar-control-spacer shrink-0" />
        <SidebarTitlebarActions
          collapsed={sidebarCollapsed}
          onToggleCollapsed={onToggleSidebar}
          onSearch={onOpenSearch}
        />
      </div>
      <div
        className={cn(
          "oo-main-titlebar-title flex min-w-0 flex-1 items-center gap-2 overflow-hidden",
          isSidebarRestoring && "is-restoring",
        )}
      >
        {titlebarBreadcrumbs && onTitlebarBreadcrumbNavigate ? (
          <TitlebarBreadcrumbs breadcrumbs={titlebarBreadcrumbs} onNavigate={onTitlebarBreadcrumbNavigate} />
        ) : (
          <EditableTitlebarTitle
            title={titlebarTitle}
            editable={titlebarEditable}
            onRename={(title) => {
              if (activeSession) {
                onRenameSession(activeSession.id, title)
              }
            }}
          />
        )}
      </div>
      <div className="ml-auto flex shrink-0 items-center gap-1 [-webkit-app-region:no-drag]">
        <AppUpdateTitlebarEntry update={appUpdate} />
        {onViewBilling ? (
          <BillingUsagePopover
            cacheScope={billingCacheScope}
            sharedConnectorCount={sharedConnectorCount}
            workspace={workspace}
            onViewDetails={onViewBilling}
          />
        ) : null}
        {showBrowserToggle ? (
          <button
            type="button"
            title={browserToggleLabel}
            aria-label={browserToggleLabel}
            aria-pressed={browserPanelOpen}
            className={cn(
              "oo-toolbar-button flex size-8 items-center justify-center rounded-md hover:bg-accent hover:text-foreground focus-visible:bg-accent focus-visible:text-foreground",
              browserPanelOpen && "bg-accent text-foreground",
            )}
            onClick={onBrowserToggle}
          >
            <Globe2 className="size-4" />
          </button>
        ) : null}
        {showArtifactsToggle ? (
          <button
            type="button"
            title={artifactsToggleLabel}
            aria-label={artifactsToggleLabel}
            aria-pressed={artifactsPanelOpen}
            className={cn(
              "oo-toolbar-button flex size-8 items-center justify-center rounded-md hover:bg-accent hover:text-foreground focus-visible:bg-accent focus-visible:text-foreground",
              artifactsPanelOpen && "bg-accent text-foreground",
            )}
            onClick={onArtifactsToggle}
          >
            <ArtifactsToggleIcon className="size-4" />
          </button>
        ) : null}
      </div>
    </header>
  )
})
