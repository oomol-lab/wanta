import type { SessionInfo, SessionProject } from "../../../electron/session/common.ts"
import type { ProjectSidebarGroup } from "./app-sidebar-model.ts"
import type { SidebarSegment } from "./sidebar-persistence.ts"

import {
  Archive,
  ChevronDown,
  ChevronRight,
  Ellipsis,
  Folder,
  FolderOpen,
  FolderPlus,
  LoaderCircle,
  MessageSquarePlus,
  PanelLeftClose,
  PanelLeftOpen,
  Pencil,
  Pin,
  PinOff,
  Search,
  SquarePen,
  Trash2,
} from "lucide-react"
import * as React from "react"
import { APP_COMMANDS } from "../../../electron/app-command.ts"
import { formatSessionAbsoluteTime, formatSessionRelativeTime } from "@/components/app-shell/session-time"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { useI18n, useT } from "@/i18n/i18n"
import { appCommandAriaShortcut, appCommandShortcutLabel, labelWithShortcut } from "@/lib/app-shortcuts"
import { cn } from "@/lib/utils"

export function SessionItem({
  session,
  selected,
  running,
  unread,
  now,
  onSelect,
  onRenameRequest,
  onPinToggle,
  onArchive,
  leadingSlot,
}: {
  session: SessionInfo
  selected: boolean
  running: boolean
  unread: boolean
  now: number
  onSelect: () => void
  onRenameRequest: () => void
  onPinToggle: () => void
  onArchive: () => void
  leadingSlot?: React.ReactNode
}) {
  const t = useT()
  const { locale } = useI18n()
  const relativeTime = formatSessionRelativeTime(session.updatedAt, now, locale)
  const absoluteTime = formatSessionAbsoluteTime(session.updatedAt, locale)
  const pinned = Boolean(session.pinnedAt)
  const handleRenameKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>): void => {
    if (event.key === "F2") {
      event.preventDefault()
      onRenameRequest()
    }
  }
  const handleRowClick = (event: React.MouseEvent<HTMLDivElement>): void => {
    if (event.target === event.currentTarget) {
      onSelect()
    }
  }

  return (
    <div
      onClick={handleRowClick}
      className={cn(
        "oo-sidebar-nav-item group oo-text-body relative flex h-8 items-center rounded-md px-3",
        selected && "bg-sidebar-accent text-sidebar-accent-foreground",
      )}
    >
      <button
        type="button"
        onClick={onSelect}
        onDoubleClick={onRenameRequest}
        onKeyDown={handleRenameKeyDown}
        aria-current={selected ? "page" : undefined}
        title={session.title}
        className="flex h-full w-full min-w-0 items-center gap-2 text-left"
      >
        {leadingSlot}
        <span className="oo-sidebar-nav-label min-w-0 flex-1 truncate">{session.title}</span>
        {running ? (
          <span
            title={t("aria.sessionRunning")}
            aria-label={t("aria.sessionRunning")}
            className="oo-sidebar-session-activity ml-auto flex size-5 shrink-0 items-center justify-center group-hover:hidden"
          >
            <LoaderCircle className="size-3.5 animate-spin" aria-hidden="true" />
          </span>
        ) : unread ? (
          <span
            title={t("aria.unreadSession")}
            aria-label={t("aria.unreadSession")}
            className="ml-auto flex size-5 shrink-0 items-center justify-center group-hover:hidden"
          >
            <span className="oo-unread-dot size-2 rounded-full" aria-hidden="true" />
          </span>
        ) : relativeTime ? (
          <span
            title={absoluteTime}
            className="oo-sidebar-session-time ml-auto shrink-0 text-right whitespace-nowrap tabular-nums group-hover:hidden"
          >
            {relativeTime}
          </span>
        ) : null}
      </button>
      <div className="pointer-events-none absolute right-3 flex items-center gap-0.5 bg-sidebar pl-1 opacity-0 transition-opacity group-hover:pointer-events-auto group-hover:bg-sidebar-accent group-hover:opacity-100 focus-within:pointer-events-auto focus-within:bg-sidebar-accent focus-within:opacity-100">
        <button
          type="button"
          aria-label={pinned ? t("aria.unpinSession") : t("aria.pinSession")}
          title={pinned ? t("aria.unpinSession") : t("aria.pinSession")}
          onClick={(event) => {
            event.stopPropagation()
            onPinToggle()
          }}
          className={cn(
            "flex size-5 shrink-0 items-center justify-center rounded hover:bg-sidebar-accent hover:text-sidebar-accent-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
            pinned && "text-sidebar-accent-foreground",
          )}
        >
          {pinned ? <PinOff className="size-3.5" /> : <Pin className="size-3.5" />}
        </button>
        <button
          type="button"
          aria-label={running ? t("aria.archiveRunningSession") : t("aria.archiveSession")}
          title={running ? t("aria.archiveRunningSession") : t("aria.archiveSession")}
          onClick={(event) => {
            event.stopPropagation()
            onArchive()
          }}
          disabled={running}
          className="flex size-5 shrink-0 items-center justify-center rounded hover:bg-sidebar-accent hover:text-sidebar-accent-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50"
        >
          <Archive className="size-3.5" />
        </button>
      </div>
    </div>
  )
}

export function SidebarEmptyState() {
  const t = useT()

  return (
    <div className="flex min-h-full flex-1 items-center justify-center px-5 py-8 text-center">
      <div className="max-w-40">
        <div className="mx-auto flex size-12 items-center justify-center rounded-lg border border-sidebar-border bg-sidebar-accent/65 text-sidebar-foreground shadow-sm">
          <MessageSquarePlus className="size-5" aria-hidden="true" />
        </div>
        <div className="oo-text-label mt-3 text-sidebar-accent-foreground">{t("sidebar.emptyTitle")}</div>
        <p className="oo-text-caption mt-1 text-sidebar-foreground/75">{t("sidebar.emptyDescription")}</p>
      </div>
    </div>
  )
}

export function ProjectSidebarEmptyState({ onSelectFolder }: { onSelectFolder: () => void }) {
  const t = useT()

  return (
    <div className="flex min-h-full flex-1 items-center justify-center px-5 py-8 text-center">
      <div className="max-w-44">
        <div className="mx-auto flex size-12 items-center justify-center rounded-lg border border-sidebar-border bg-sidebar-accent/65 text-sidebar-foreground shadow-sm">
          <Folder className="size-5" aria-hidden="true" />
        </div>
        <div className="oo-text-label mt-3 text-sidebar-accent-foreground">{t("project.emptyTitle")}</div>
        <p className="oo-text-caption mt-1 text-sidebar-foreground/75">{t("project.emptyDescription")}</p>
        <Button type="button" size="sm" variant="outline" className="mt-3 h-7" onClick={onSelectFolder}>
          <FolderPlus className="size-3.5" />
          {t("project.selectFolder")}
        </Button>
      </div>
    </div>
  )
}

export function SidebarSegmentControl({
  value,
  onChange,
}: {
  value: SidebarSegment
  onChange: (value: SidebarSegment) => void
}) {
  const t = useT()
  const options: Array<{ label: string; value: SidebarSegment }> = [
    { label: t("sidebar.segmentTasks"), value: "tasks" },
    { label: t("sidebar.segmentProjects"), value: "projects" },
  ]

  return (
    <div className="grid grid-cols-2 gap-0.5 rounded-md bg-sidebar-accent/80 p-0.5">
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          className={cn(
            "oo-text-control flex h-7 min-w-0 items-center justify-center gap-1 rounded px-2 text-sidebar-foreground/75",
            value === option.value && "bg-background text-foreground shadow-sm",
          )}
          aria-pressed={value === option.value}
          onClick={() => onChange(option.value)}
        >
          {option.value === "tasks" ? <SquarePen className="size-3.5" /> : <Folder className="size-3.5" />}
          <span className="truncate">{option.label}</span>
        </button>
      ))}
    </div>
  )
}

export function ProjectSidebarGroupItem({
  expanded,
  group,
  hasUnreadSession,
  isSessionRunning,
  now,
  running,
  onArchiveSession,
  onArchiveProject,
  onExpandedChange,
  onPinProject,
  onRemoveProject,
  onRenameProject,
  onNewSession,
  onPinSession,
  onRenameSession,
  onSelectSession,
  selectedSessionId,
  onShowProjectInFolder,
}: {
  expanded: boolean
  group: ProjectSidebarGroup
  hasUnreadSession: (sessionId: string) => boolean
  isSessionRunning: (sessionId: string) => boolean
  now: number
  running: boolean
  onArchiveSession: (session: SessionInfo) => void
  onArchiveProject: (project: SessionProject) => void
  onExpandedChange: (expanded: boolean) => void
  onNewSession: (project: SessionProject) => void
  onPinProject: (project: SessionProject) => void
  onRemoveProject: (project: SessionProject) => void
  onRenameProject: (project: SessionProject) => void
  onPinSession: (session: SessionInfo) => void
  onRenameSession: (session: SessionInfo) => void
  onSelectSession: (session: SessionInfo) => void
  selectedSessionId: string | null
  onShowProjectInFolder: (project: SessionProject) => void
}) {
  const t = useT()
  const hasSessions = group.sessions.length > 0
  const toggleLabel = expanded ? t("project.collapse") : t("project.expand")
  const projectTitle = t("project.newTask")
  const pinned = Boolean(group.project.pinnedAt)
  const showCollapsedRunning = !expanded && running
  const toggleTitle = showCollapsedRunning
    ? `${toggleLabel}: ${group.project.name} · ${t("aria.sessionRunning")}`
    : `${toggleLabel}: ${group.project.name}`

  return (
    <section className="grid gap-1">
      <div className="group oo-sidebar-nav-item oo-text-body flex h-8 items-center rounded-md px-3">
        <button
          type="button"
          className="group/toggle flex h-full min-w-0 flex-1 items-center gap-2 text-left"
          title={toggleTitle}
          aria-label={toggleTitle}
          aria-expanded={expanded}
          onClick={() => onExpandedChange(!expanded)}
        >
          <Folder className="size-4 shrink-0 text-sidebar-foreground/75" />
          <span className="oo-sidebar-nav-label min-w-0 truncate" title={group.project.name}>
            {group.project.name}
          </span>
          <span className="relative flex size-3.5 shrink-0 items-center justify-center">
            {expanded ? (
              <ChevronDown className="absolute size-3.5 opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible/toggle:opacity-100" />
            ) : (
              <ChevronRight className="absolute size-3.5 opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible/toggle:opacity-100" />
            )}
          </span>
        </button>
        <div className="ml-1 flex shrink-0 items-center gap-0.5">
          {showCollapsedRunning ? (
            <span
              title={t("aria.sessionRunning")}
              aria-label={t("aria.sessionRunning")}
              className="flex size-5 items-center justify-center"
            >
              <LoaderCircle className="size-3.5 animate-spin text-sidebar-foreground/70" aria-hidden="true" />
            </span>
          ) : (
            <>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button
                    type="button"
                    title={t("project.moreActions")}
                    aria-label={t("project.moreActions")}
                    className="pointer-events-none flex size-5 items-center justify-center rounded opacity-0 transition-opacity group-hover:pointer-events-auto group-hover:opacity-100 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground focus-visible:pointer-events-auto focus-visible:bg-sidebar-accent focus-visible:text-sidebar-accent-foreground focus-visible:opacity-100 data-[state=open]:pointer-events-auto data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-accent-foreground data-[state=open]:opacity-100"
                  >
                    <Ellipsis className="size-3.5" />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="min-w-44">
                  <DropdownMenuItem onSelect={() => onPinProject(group.project)}>
                    {pinned ? <PinOff className="size-4" /> : <Pin className="size-4" />}
                    <span>{pinned ? t("project.unpin") : t("project.pin")}</span>
                  </DropdownMenuItem>
                  <DropdownMenuItem onSelect={() => onShowProjectInFolder(group.project)}>
                    <FolderOpen className="size-4" />
                    <span>{t("project.showInFinder")}</span>
                  </DropdownMenuItem>
                  <DropdownMenuItem onSelect={() => onRenameProject(group.project)}>
                    <Pencil className="size-4" />
                    <span>{t("project.rename")}</span>
                  </DropdownMenuItem>
                  <DropdownMenuItem onSelect={() => onArchiveProject(group.project)}>
                    <Archive className="size-4" />
                    <span>{t("project.archive")}</span>
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem variant="destructive" onSelect={() => onRemoveProject(group.project)}>
                    <Trash2 className="size-4" />
                    <span>{t("project.remove")}</span>
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
              <button
                type="button"
                title={projectTitle}
                aria-label={projectTitle}
                className="pointer-events-none flex size-5 items-center justify-center rounded opacity-0 transition-opacity group-hover:pointer-events-auto group-hover:opacity-100 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground focus-visible:pointer-events-auto focus-visible:bg-sidebar-accent focus-visible:text-sidebar-accent-foreground focus-visible:opacity-100"
                onClick={() => onNewSession(group.project)}
              >
                <SquarePen className="size-3.5" />
              </button>
            </>
          )}
        </div>
      </div>
      {expanded ? (
        <div className="grid gap-0.5">
          {hasSessions ? (
            group.sessions.map((session) => (
              <SessionItem
                key={session.id}
                session={session}
                selected={selectedSessionId === session.id}
                running={isSessionRunning(session.id)}
                unread={hasUnreadSession(session.id)}
                now={now}
                onSelect={() => onSelectSession(session)}
                onRenameRequest={() => onRenameSession(session)}
                onPinToggle={() => onPinSession(session)}
                onArchive={() => onArchiveSession(session)}
                leadingSlot={<span className="size-4 shrink-0" aria-hidden="true" />}
              />
            ))
          ) : (
            <div className="oo-text-body flex h-8 items-center gap-2 px-3 text-sidebar-foreground/45">
              <span className="size-4 shrink-0" aria-hidden="true" />
              <span className="oo-sidebar-nav-label min-w-0 truncate">{t("project.noSessions")}</span>
            </div>
          )}
          {group.hiddenCount > 0 ? (
            <div className="oo-text-caption px-3 py-1 text-sidebar-foreground/60">
              {t("project.hiddenSessions", { count: group.hiddenCount })}
            </div>
          ) : null}
        </div>
      ) : null}
    </section>
  )
}

export function SidebarTitlebarActions({
  collapsed,
  onToggleCollapsed,
  onSearch,
}: {
  collapsed: boolean
  onToggleCollapsed: () => void
  onSearch: () => void
}) {
  const t = useT()
  const sidebarLabel = collapsed ? t("aria.expandSidebar") : t("aria.collapseSidebar")
  const sidebarTitle = labelWithShortcut(sidebarLabel, appCommandShortcutLabel(APP_COMMANDS.toggleSidebar))
  const searchTitle = labelWithShortcut(t("sidebar.search"), appCommandShortcutLabel(APP_COMMANDS.openSearch))

  return (
    <div className="oo-sidebar-titlebar-actions flex shrink-0 items-center gap-1 [-webkit-app-region:no-drag]">
      <button
        type="button"
        title={sidebarTitle}
        aria-label={sidebarTitle}
        aria-keyshortcuts={appCommandAriaShortcut(APP_COMMANDS.toggleSidebar)}
        aria-pressed={collapsed}
        onClick={onToggleCollapsed}
        className="oo-sidebar-titlebar-button flex size-7 shrink-0 items-center justify-center rounded-md"
      >
        {collapsed ? <PanelLeftOpen className="size-4" /> : <PanelLeftClose className="size-4" />}
      </button>
      <button
        type="button"
        title={searchTitle}
        aria-label={searchTitle}
        aria-keyshortcuts={appCommandAriaShortcut(APP_COMMANDS.openSearch)}
        onClick={onSearch}
        className="oo-sidebar-titlebar-button flex size-7 shrink-0 items-center justify-center rounded-md"
      >
        <Search className="size-4" />
      </button>
    </div>
  )
}
