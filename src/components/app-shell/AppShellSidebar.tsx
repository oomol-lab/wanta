import type { SessionInfo, SessionProject } from "../../../electron/session/common.ts"
import type { AppShellRoute } from "./app-shell-types.ts"
import type { ProjectSidebarGroup } from "./app-sidebar-model.ts"
import type { SidebarSegment } from "./sidebar-persistence.ts"
import type { UseOrganizationWorkspace, WorkspaceSelection } from "@/hooks/useOrganizationWorkspace"

import {
  AlertTriangle,
  Archive,
  Building2,
  ChevronDown,
  ChevronRight,
  ChevronsUpDown,
  Download,
  Ellipsis,
  Folder,
  FolderOpen,
  FolderPlus,
  LogOut,
  LoaderCircle,
  MessageSquarePlus,
  Package,
  PanelLeftClose,
  PanelLeftOpen,
  Pencil,
  Pin,
  PinOff,
  Plug,
  RefreshCw,
  Search,
  Settings,
  SquarePen,
  Trash2,
} from "lucide-react"
import * as React from "react"
import { APP_COMMANDS } from "../../../electron/app-command.ts"
import { formatSessionAbsoluteTime, formatSessionRelativeTime } from "@/components/app-shell/session-time"
import { CachedAvatarImage } from "@/components/CachedAvatarImage"
import { ErrorNotice } from "@/components/ErrorNotice"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { InputGroup, InputGroupAddon, InputGroupInput } from "@/components/ui/input-group"
import { useAppUpdate } from "@/hooks/useAppUpdate"
import { organizationAvatarStyle, organizationInitials } from "@/hooks/useOrganizationWorkspace"
import { useI18n, useT } from "@/i18n/i18n"
import { appCommandAriaShortcut, appCommandShortcutLabel, labelWithShortcut } from "@/lib/app-shortcuts"
import { cn } from "@/lib/utils"

function normalizeSearchText(value: string): string {
  return value.trim().toLocaleLowerCase()
}

function encodedDomIdSegment(value: string): string {
  return Array.from(value, (char) => {
    const codePoint = char.codePointAt(0)
    return codePoint === undefined ? "0" : codePoint.toString(16)
  }).join("-")
}

function sessionSearchResultId(sessionId: string): string {
  return `session-search-result-${encodedDomIdSegment(sessionId)}`
}

function accountInitial(name?: string): string {
  const trimmed = name?.trim()
  return trimmed ? trimmed.charAt(0).toLocaleUpperCase() : "L"
}

function workspaceSelectionKey(workspace: WorkspaceSelection): string {
  return workspace.type === "organization" ? `organization:${workspace.organizationId}` : "personal"
}

function WorkspaceAvatar({
  accountAvatarUrl,
  accountName,
  className = "size-7",
  workspace,
}: {
  accountAvatarUrl?: string
  accountName?: string
  className?: string
  workspace: WorkspaceSelection
}) {
  const avatarUrl = workspace.type === "organization" ? workspace.organization?.avatar : accountAvatarUrl
  const fallback =
    workspace.type === "organization"
      ? organizationInitials(workspace.organization?.name ?? workspace.organizationId)
      : accountInitial(accountName)
  const fallbackStyle =
    workspace.type === "organization" ? organizationAvatarStyle(workspace.organizationId) : undefined

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
  accountAvatarUrl,
  accountName,
  loading,
  onManageOrganizations,
  onRefresh,
  onSelectOrganization,
  onSelectPersonal,
  error,
  getOrganizationCanManage,
  getOrganizationRole,
  hasLoaded,
  organizations,
  workspace,
}: {
  accountAvatarUrl?: string
  accountName?: string
  error: UseOrganizationWorkspace["error"]
  getOrganizationCanManage: UseOrganizationWorkspace["getOrganizationCanManage"]
  getOrganizationRole: UseOrganizationWorkspace["getOrganizationRole"]
  hasLoaded: boolean
  loading: boolean
  onManageOrganizations: () => void
  onRefresh: () => void
  onSelectOrganization: (organizationId: string) => void
  onSelectPersonal: () => void
  organizations: UseOrganizationWorkspace["organizations"]
  workspace: WorkspaceSelection
}) {
  const t = useT()
  const activeKey = workspaceSelectionKey(workspace)
  const personalLabel = accountName?.trim() || t("organizations.personal")
  const personalDescription =
    personalLabel === t("organizations.personal") ? t("organizations.workspace") : t("organizations.personal")
  const showBlockingError = Boolean(error && !hasLoaded)
  const showRefreshWarning = Boolean(error && hasLoaded)
  const workspaceItemClassName =
    "my-1 grid w-full min-w-0 grid-cols-[2.5rem_minmax(0,1fr)_4.5rem] items-center gap-2 rounded-md px-2 py-2 text-left outline-none data-[active=true]:bg-accent data-[active=true]:text-accent-foreground focus:bg-accent focus:text-accent-foreground hover:bg-accent hover:text-accent-foreground"

  return (
    <div className="absolute bottom-full left-3 z-[90] mb-2 w-72 rounded-md border bg-popover p-1 text-popover-foreground shadow-md">
      <div className="px-2 py-1.5 text-sm font-medium">{t("organizations.workspaceGroup")}</div>
      <button
        type="button"
        className={workspaceItemClassName}
        onClick={onSelectPersonal}
        data-active={activeKey === "personal"}
      >
        <WorkspaceAvatar
          accountAvatarUrl={accountAvatarUrl}
          accountName={accountName}
          workspace={{ type: "personal" }}
        />
        <span className="min-w-0 flex-1 truncate">{personalLabel}</span>
        <Badge variant="outline" className="flex w-full justify-end px-0 text-right font-normal">
          {personalDescription}
        </Badge>
      </button>
      {loading ? (
        <div className="relative flex items-center gap-2 rounded-sm px-2 py-1.5 text-sm text-muted-foreground">
          <LoaderCircle className="size-4 animate-spin" />
          {t("organizations.loading")}
        </div>
      ) : null}
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
          <button
            key={organization.id}
            type="button"
            className={workspaceItemClassName}
            onClick={() => onSelectOrganization(organization.id)}
            data-active={selected}
          >
            <WorkspaceAvatar
              workspace={{ type: "organization", canManage, organization, organizationId: organization.id, role }}
            />
            <span className="min-w-0 flex-1 truncate">{organization.name}</span>
            <Badge variant="outline" className="flex w-full justify-end px-0 text-right font-normal">
              {role === "creator" ? t("organizations.roleCreator") : t("organizations.roleMember")}
            </Badge>
          </button>
        )
      })}
      {!loading && organizations.length === 0 && !showBlockingError ? (
        <div className="oo-text-caption oo-text-muted px-2 py-1.5">{t("organizations.emptyOrganizations")}</div>
      ) : null}
      <div className="-mx-1 my-1 h-px bg-border" />
      {error ? (
        <button
          type="button"
          className="relative flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-sm outline-none hover:bg-accent hover:text-accent-foreground focus:bg-accent focus:text-accent-foreground"
          onClick={onRefresh}
        >
          <RefreshCw className="size-4" />
          {t("organizations.retry")}
        </button>
      ) : null}
      <button
        type="button"
        className="relative flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-sm outline-none hover:bg-accent hover:text-accent-foreground focus:bg-accent focus:text-accent-foreground"
        onClick={onManageOrganizations}
      >
        <Building2 className="size-4" />
        {t("organizations.manageOrganizations")}
      </button>
    </div>
  )
}

export function SessionItem({
  session,
  active,
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
  active: boolean
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

  return (
    <div
      className={cn(
        "oo-sidebar-nav-item group oo-text-body flex h-8 items-center rounded-md px-3",
        active && "bg-sidebar-accent text-sidebar-accent-foreground",
      )}
    >
      <button
        type="button"
        onClick={onSelect}
        onDoubleClick={onRenameRequest}
        onKeyDown={handleRenameKeyDown}
        title={session.title}
        className="flex min-w-0 flex-1 items-center gap-2 text-left"
      >
        {leadingSlot}
        <span className="oo-sidebar-nav-label min-w-0 truncate">{session.title}</span>
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
      <div className="ml-1 hidden shrink-0 items-center gap-0.5 group-focus-within:flex group-hover:flex">
        <button
          type="button"
          aria-label={pinned ? t("aria.unpinSession") : t("aria.pinSession")}
          title={pinned ? t("aria.unpinSession") : t("aria.pinSession")}
          onClick={onPinToggle}
          className={cn(
            "flex size-5 shrink-0 items-center justify-center rounded hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
            pinned && "text-sidebar-accent-foreground",
          )}
        >
          {pinned ? <PinOff className="size-3.5" /> : <Pin className="size-3.5" />}
        </button>
        <button
          type="button"
          aria-label={running ? t("aria.archiveRunningSession") : t("aria.archiveSession")}
          title={running ? t("aria.archiveRunningSession") : t("aria.archiveSession")}
          onClick={onArchive}
          disabled={running}
          className="flex size-5 shrink-0 items-center justify-center rounded hover:bg-sidebar-accent hover:text-sidebar-accent-foreground disabled:cursor-not-allowed disabled:opacity-50"
        >
          <Archive className="size-3.5" />
        </button>
      </div>
    </div>
  )
}

export function SessionSearchOverlay({
  sessions,
  open,
  onClose,
  onSelect,
}: {
  sessions: SessionInfo[]
  open: boolean
  onClose: () => void
  onSelect: (session: SessionInfo) => void
}) {
  const t = useT()
  const inputRef = React.useRef<HTMLInputElement | null>(null)
  const resultRefs = React.useRef(new Map<string, HTMLButtonElement>())
  const [query, setQuery] = React.useState("")
  const [activeIndex, setActiveIndex] = React.useState(0)
  const normalizedQuery = normalizeSearchText(query)
  const filteredSessions = normalizedQuery
    ? sessions.filter((session) => normalizeSearchText(session.title).includes(normalizedQuery))
    : sessions
  const activeSession = filteredSessions[activeIndex]
  const activeResultId = activeSession ? sessionSearchResultId(activeSession.id) : undefined

  React.useEffect(() => {
    if (open) {
      setQuery("")
      setActiveIndex(0)
      window.setTimeout(() => inputRef.current?.focus(), 0)
    }
  }, [open])

  React.useEffect(() => {
    setActiveIndex(0)
  }, [normalizedQuery])

  React.useEffect(() => {
    setActiveIndex((index) => Math.min(index, Math.max(0, filteredSessions.length - 1)))
  }, [filteredSessions.length])

  React.useEffect(() => {
    if (!activeSession) {
      return
    }
    resultRefs.current.get(activeSession.id)?.scrollIntoView({ block: "nearest" })
  }, [activeSession])

  const selectSession = (session: SessionInfo | undefined): void => {
    if (!session) {
      return
    }
    onSelect(session)
  }

  if (!open) {
    return null
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={t("sidebar.search")}
      className="oo-modal-backdrop fixed inset-0 z-[120] flex items-center justify-center p-5"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) {
          onClose()
        }
      }}
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.preventDefault()
          onClose()
          return
        }
        if (filteredSessions.length === 0) {
          return
        }
        if (event.key === "ArrowDown") {
          event.preventDefault()
          setActiveIndex((index) => (index + 1) % filteredSessions.length)
          return
        }
        if (event.key === "ArrowUp") {
          event.preventDefault()
          setActiveIndex((index) => (index - 1 + filteredSessions.length) % filteredSessions.length)
          return
        }
        if (event.key === "Home") {
          event.preventDefault()
          setActiveIndex(0)
          return
        }
        if (event.key === "End") {
          event.preventDefault()
          setActiveIndex(filteredSessions.length - 1)
          return
        }
        if (event.key === "Enter") {
          event.preventDefault()
          selectSession(filteredSessions[activeIndex])
        }
      }}
    >
      <section className="oo-modal-surface w-full max-w-[520px] rounded-lg border p-5">
        <InputGroup className="oo-session-search-input h-10 rounded-lg shadow-none">
          <InputGroupAddon align="inline-start">
            <Search className="size-4" aria-hidden="true" />
          </InputGroupAddon>
          <InputGroupInput
            ref={inputRef}
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={t("sidebar.searchPlaceholder")}
            aria-label={t("sidebar.searchPlaceholder")}
            aria-activedescendant={activeResultId}
            aria-controls="session-search-results"
            aria-expanded="true"
            autoCapitalize="none"
            autoComplete="off"
            autoCorrect="off"
            className="oo-text-title h-8 min-w-0"
            role="combobox"
            spellCheck={false}
          />
        </InputGroup>

        <p className="oo-text-control mt-4 px-3 text-muted-foreground">
          {t("sidebar.searchResults", { count: filteredSessions.length })}
        </p>
        <div
          id="session-search-results"
          className="mt-3 max-h-[min(46vh,420px)] overflow-y-auto pr-1"
          role="listbox"
          aria-label={t("sidebar.searchResults", { count: filteredSessions.length })}
        >
          <div className="grid gap-1">
            {filteredSessions.map((session, index) => (
              <button
                key={session.id}
                id={sessionSearchResultId(session.id)}
                ref={(node) => {
                  if (node) {
                    resultRefs.current.set(session.id, node)
                  } else {
                    resultRefs.current.delete(session.id)
                  }
                }}
                type="button"
                role="option"
                aria-selected={index === activeIndex}
                onMouseEnter={() => setActiveIndex(index)}
                onClick={() => selectSession(session)}
                title={session.title}
                className="oo-session-search-result oo-text-label flex h-9 min-w-0 items-center rounded-md px-3 text-left"
              >
                <span className="truncate">{session.title}</span>
              </button>
            ))}
            {filteredSessions.length === 0 && (
              <p className="oo-text-control px-3 py-6 text-muted-foreground">{t("sidebar.searchEmpty")}</p>
            )}
          </div>
        </div>
      </section>
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
  activeSessionId,
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
  onShowProjectInFolder,
}: {
  activeSessionId: string | null
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
            <LoaderCircle
              className="size-3.5 animate-spin text-sidebar-foreground/70 opacity-100 transition-opacity group-focus-within:hidden group-hover:hidden"
              aria-hidden="true"
            />
          ) : null}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                title={t("project.moreActions")}
                aria-label={t("project.moreActions")}
                className="pointer-events-none flex size-5 items-center justify-center rounded opacity-0 transition-opacity group-focus-within:pointer-events-auto group-focus-within:opacity-100 group-hover:pointer-events-auto group-hover:opacity-100 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground focus-visible:pointer-events-auto focus-visible:bg-sidebar-accent focus-visible:text-sidebar-accent-foreground focus-visible:opacity-100 data-[state=open]:pointer-events-auto data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-accent-foreground data-[state=open]:opacity-100"
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
            className="pointer-events-none flex size-5 items-center justify-center rounded opacity-0 transition-opacity group-focus-within:pointer-events-auto group-focus-within:opacity-100 group-hover:pointer-events-auto group-hover:opacity-100 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground focus-visible:pointer-events-auto focus-visible:bg-sidebar-accent focus-visible:text-sidebar-accent-foreground focus-visible:opacity-100"
            onClick={() => onNewSession(group.project)}
          >
            <SquarePen className="size-3.5" />
          </button>
        </div>
      </div>
      {expanded ? (
        <div className="grid gap-0.5">
          {hasSessions ? (
            group.sessions.map((session) => (
              <SessionItem
                key={session.id}
                session={session}
                active={activeSessionId === session.id}
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

export function SidebarFooterControls({
  accountName,
  avatarUrl,
  activeRoute,
  loggingOut,
  onNavigate,
  onLogout,
  workspace,
}: {
  accountName?: string
  avatarUrl?: string
  activeRoute: AppShellRoute
  loggingOut: boolean
  onNavigate: (route: AppShellRoute) => void
  onLogout: () => void
  workspace: UseOrganizationWorkspace
}) {
  const t = useT()
  const rootRef = React.useRef<HTMLDivElement | null>(null)
  const [workspaceMenuOpen, setWorkspaceMenuOpen] = React.useState(false)
  const [accountMenuOpen, setAccountMenuOpen] = React.useState(false)
  const trimmedAccountName = accountName?.trim()
  const displayName = trimmedAccountName || t("settings.account")
  const personalWorkspaceLabel = trimmedAccountName || t("organizations.personal")
  const activeWorkspaceLabel =
    workspace.activeWorkspace.type === "organization"
      ? (workspace.activeWorkspace.organization?.name ?? t("organizations.workspace"))
      : personalWorkspaceLabel

  React.useEffect(() => {
    if (!workspaceMenuOpen && !accountMenuOpen) {
      return
    }
    const handlePointerDown = (event: PointerEvent): void => {
      const target = event.target
      if (target instanceof Node && rootRef.current?.contains(target)) {
        return
      }
      setWorkspaceMenuOpen(false)
      setAccountMenuOpen(false)
    }
    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.key === "Escape") {
        setWorkspaceMenuOpen(false)
        setAccountMenuOpen(false)
      }
    }
    document.addEventListener("pointerdown", handlePointerDown)
    document.addEventListener("keydown", handleKeyDown)
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown)
      document.removeEventListener("keydown", handleKeyDown)
    }
  }, [accountMenuOpen, workspaceMenuOpen])

  const closeMenus = React.useCallback(() => {
    setWorkspaceMenuOpen(false)
    setAccountMenuOpen(false)
  }, [])

  return (
    <div
      ref={rootRef}
      className="oo-sidebar-account relative -mx-3 flex h-12 shrink-0 items-center gap-1 px-3 [-webkit-app-region:no-drag]"
    >
      <button
        type="button"
        className="oo-sidebar-nav-item oo-sidebar-workspace-trigger flex h-10 min-w-0 flex-1 items-center gap-2 rounded-md px-1.5 text-left"
        aria-label={t("organizations.workspaceSwitcher")}
        aria-expanded={workspaceMenuOpen}
        title={activeWorkspaceLabel}
        onClick={() => {
          setWorkspaceMenuOpen((open) => !open)
          setAccountMenuOpen(false)
        }}
      >
        <WorkspaceAvatar
          accountAvatarUrl={avatarUrl}
          accountName={displayName}
          className="size-7"
          workspace={workspace.activeWorkspace}
        />
        <div className="oo-sidebar-nav-label min-w-0 flex-1">
          <div className="oo-text-body truncate text-sidebar-foreground" title={activeWorkspaceLabel}>
            {activeWorkspaceLabel}
          </div>
        </div>
        <ChevronsUpDown className="oo-sidebar-nav-label size-4 shrink-0 text-muted-foreground" />
      </button>
      {workspaceMenuOpen ? (
        <WorkspaceMenuContent
          accountAvatarUrl={avatarUrl}
          accountName={trimmedAccountName}
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
            workspace.selectOrganization(organizationId)
          }}
          onSelectPersonal={() => {
            closeMenus()
            workspace.selectPersonal()
          }}
        />
      ) : null}

      <button
        type="button"
        className={cn(
          "oo-sidebar-nav-item flex size-10 shrink-0 items-center justify-center rounded-md",
          (activeRoute === "settings" || activeRoute === "archived") &&
            "bg-sidebar-accent text-sidebar-accent-foreground",
        )}
        aria-label={t("sidebar.accountMenu")}
        aria-expanded={accountMenuOpen}
        title={t("settings.title")}
        onClick={() => {
          setAccountMenuOpen((open) => !open)
          setWorkspaceMenuOpen(false)
        }}
      >
        <Settings className="size-4" />
      </button>
      {accountMenuOpen ? (
        <div className="absolute right-3 bottom-full z-[90] mb-2 w-56 rounded-md border bg-popover p-1 text-popover-foreground shadow-md">
          <div className="px-2 py-1.5 text-sm font-medium">
            <div className="flex min-w-0 items-center gap-2">
              <AccountAvatar name={displayName} avatarUrl={avatarUrl} />
              <span className="truncate">{displayName}</span>
            </div>
          </div>
          <div className="-mx-1 my-1 h-px bg-border" />
          <SidebarMenuButton
            onClick={() => {
              closeMenus()
              onNavigate("connections")
            }}
          >
            <Plug className="size-4" />
            {t("connections.title")}
          </SidebarMenuButton>
          <SidebarMenuButton
            onClick={() => {
              closeMenus()
              onNavigate("skills")
            }}
          >
            <Package className="size-4" />
            {t("skills.title")}
          </SidebarMenuButton>
          <SidebarMenuButton
            onClick={() => {
              closeMenus()
              onNavigate("archived")
            }}
          >
            <Archive className="size-4" />
            {t("archived.navTitle")}
          </SidebarMenuButton>
          <SidebarMenuButton
            onClick={() => {
              closeMenus()
              onNavigate("settings")
            }}
          >
            <Settings className="size-4" />
            {t("settings.title")}
          </SidebarMenuButton>
          <div className="-mx-1 my-1 h-px bg-border" />
          <SidebarMenuButton
            disabled={loggingOut}
            destructive
            onClick={() => {
              closeMenus()
              onLogout()
            }}
          >
            <LogOut className="size-4" />
            {t("settings.logout")}
          </SidebarMenuButton>
        </div>
      ) : null}
    </div>
  )
}

function SidebarMenuButton({
  children,
  destructive = false,
  disabled = false,
  onClick,
}: {
  children: React.ReactNode
  destructive?: boolean
  disabled?: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      className={cn(
        "relative flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-sm outline-none hover:bg-accent hover:text-accent-foreground focus:bg-accent focus:text-accent-foreground disabled:pointer-events-none disabled:opacity-50",
        destructive && "text-destructive hover:bg-destructive/10 focus:bg-destructive/10",
      )}
      disabled={disabled}
      onClick={onClick}
    >
      {children}
    </button>
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

export function AppUpdateTitlebarEntry() {
  const t = useT()
  const update = useAppUpdate()
  const state = update.state

  if (!state?.isPackaged) {
    return null
  }

  switch (state.status.status) {
    case "available": {
      const label = t("nav.updateDownload")
      return (
        <Button
          type="button"
          size="sm"
          className="oo-toolbar-button max-w-40 min-w-0"
          aria-label={label}
          disabled={update.isDownloadInFlight}
          onClick={() => void update.download()}
        >
          {update.isDownloadInFlight ? (
            <LoaderCircle className="size-3.5 shrink-0 animate-spin" />
          ) : (
            <Download className="size-3.5 shrink-0" />
          )}
          <span className="truncate">{label}</span>
        </Button>
      )
    }
    case "downloading": {
      const percent = Math.round(state.status.percent ?? 0)
      const label = t("nav.updateDownloading", { percent })
      return (
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="oo-toolbar-button max-w-40 min-w-0"
          aria-label={label}
          disabled
        >
          <LoaderCircle className="size-3.5 shrink-0 animate-spin" />
          <span className="truncate">{label}</span>
        </Button>
      )
    }
    case "downloaded": {
      const label = t("nav.restartToUpdate")
      return (
        <Button
          type="button"
          size="sm"
          className="oo-toolbar-button max-w-40 min-w-0"
          aria-label={label}
          disabled={update.isInstallTriggered}
          onClick={() => void update.install()}
        >
          {update.isInstallTriggered ? (
            <LoaderCircle className="size-3.5 shrink-0 animate-spin" />
          ) : (
            <RefreshCw className="size-3.5 shrink-0" />
          )}
          <span className="truncate">{label}</span>
        </Button>
      )
    }
    default:
      return null
  }
}
