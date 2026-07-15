import type { SessionInfo } from "../../../electron/session/common.ts"
import type { BillingDetailsTarget } from "@/components/app-shell/BillingUsagePopover"
import type { UseAppUpdate } from "@/hooks/useAppUpdate"
import type { WorkspaceSelection } from "@/hooks/useOrganizationWorkspace"
import type { LucideIcon } from "lucide-react"

import * as React from "react"
import { EditableTitlebarTitle } from "./AppShellDialogs.tsx"
import { AppUpdateTitlebarEntry, SidebarTitlebarActions } from "./AppShellSidebar.tsx"
import { BillingUsagePopover } from "@/components/app-shell/BillingUsagePopover"
import { cn } from "@/lib/utils"

export function AppShellMainTitlebar({
  activeSession,
  appUpdate,
  artifactsPanelOpen,
  artifactsToggleIcon: ArtifactsToggleIcon,
  artifactsToggleLabel,
  billingCacheScope,
  isSidebarRestoring,
  onArtifactsToggle,
  onOpenSearch,
  onRenameSession,
  onToggleSidebar,
  onViewBilling,
  showArtifactsToggle,
  sidebarCollapsed,
  titlebarEditable,
  titlebarTitle,
  workspace,
}: {
  activeSession: SessionInfo | null
  appUpdate: UseAppUpdate
  artifactsPanelOpen: boolean
  artifactsToggleIcon: LucideIcon
  artifactsToggleLabel: string
  billingCacheScope: string
  isSidebarRestoring: boolean
  onArtifactsToggle: () => void
  onOpenSearch: () => void
  onRenameSession: (sessionId: string, title: string) => void
  onToggleSidebar: () => void
  onViewBilling: (target?: BillingDetailsTarget) => void
  showArtifactsToggle: boolean
  sidebarCollapsed: boolean
  titlebarEditable: boolean
  titlebarTitle: string
  workspace: WorkspaceSelection
}) {
  return (
    <header className="oo-titlebar oo-toolbar oo-main-titlebar oo-border-divider flex h-[var(--app-titlebar-height)] items-center border-b [-webkit-app-region:drag]">
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
          "oo-main-titlebar-title flex w-full min-w-0 items-center gap-2",
          isSidebarRestoring && "is-restoring",
        )}
      >
        <EditableTitlebarTitle
          title={titlebarTitle}
          editable={titlebarEditable}
          onRename={(title) => {
            if (activeSession) {
              onRenameSession(activeSession.id, title)
            }
          }}
        />
      </div>
      <div className="ml-auto flex shrink-0 items-center gap-1 [-webkit-app-region:no-drag]">
        <AppUpdateTitlebarEntry update={appUpdate} />
        <BillingUsagePopover cacheScope={billingCacheScope} workspace={workspace} onViewDetails={onViewBilling} />
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
}
