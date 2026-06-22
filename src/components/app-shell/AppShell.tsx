import type { AppCommand } from "../../../electron/app-command.ts"
import type {
  AgentRuntimeStatus,
  AuthorizationInfo,
  ChatAttachment,
  ChatContextMention,
  ChatMessage,
} from "../../../electron/chat/common.ts"
import type { ConnectionProvider } from "../../../electron/connections/common.ts"
import type { ModelChoice } from "../../../electron/models/common.ts"
import type { SessionInfo } from "../../../electron/session/common.ts"
import type { ChatQueueMap, QueuedChatMessage } from "./chat-queue.ts"
import type { PendingChatTransition } from "./pending-chat.ts"
import type { UseOrganizationWorkspace, WorkspaceSelection } from "@/hooks/useOrganizationWorkspace"
import type { ChatTurnRetrySource } from "@/routes/Chat/chat-turns"
import type { ComposerState } from "@/routes/Chat/composer-state"
import type { ArtifactSelection } from "@/routes/Chat/GeneratedArtifacts"
import type { ChatStatus } from "ai"

import {
  AlertTriangle,
  Archive,
  Building2,
  ChevronsUpDown,
  Download,
  LogOut,
  LoaderCircle,
  MessageSquarePlus,
  Package,
  PanelLeftClose,
  PanelLeftOpen,
  PanelRightClose,
  PanelRightOpen,
  Pin,
  PinOff,
  Plug,
  RefreshCw,
  Search,
  Settings,
  SquarePen,
} from "lucide-react"
import * as React from "react"
import { toast } from "sonner"
import { APP_COMMANDS } from "../../../electron/app-command.ts"
import {
  buildFallbackSessionTitle,
  shouldAutoRefreshSessionTitle,
  trimTitleToColumns,
} from "../../../electron/session/title.ts"
import {
  appendQueuedMessage,
  consumeNextQueuedMessage,
  removeQueuedMessage,
  shouldDispatchQueuedMessage,
} from "./chat-queue.ts"
import { isPendingChatCaughtUp } from "./pending-chat.ts"
import { groupSidebarSessions, nextActiveSessionIdAfterArchive } from "./sidebar-sessions.ts"
import { BillingUsagePopover } from "@/components/app-shell/BillingUsagePopover"
import { formatSessionAbsoluteTime, formatSessionRelativeTime } from "@/components/app-shell/session-time"
import { useChatService } from "@/components/AppContext"
import { BrandIcon } from "@/components/BrandIcon"
import { ErrorNotice } from "@/components/ErrorNotice"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Dialog } from "@/components/ui/dialog"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Input } from "@/components/ui/input"
import { useAppCommandEvents, useAppCommandShortcuts } from "@/hooks/useAppCommandShortcuts"
import { useAppUpdate } from "@/hooks/useAppUpdate"
import { useAuth } from "@/hooks/useAuth"
import { useChat } from "@/hooks/useChat"
import { useConnections } from "@/hooks/useConnections"
import {
  organizationAvatarStyle,
  organizationInitials,
  useOrganizationWorkspace,
} from "@/hooks/useOrganizationWorkspace"
import { useSessions } from "@/hooks/useSessions"
import { useI18n, useT } from "@/i18n/i18n"
import { appCommandAriaShortcut, appCommandShortcutLabel, labelWithShortcut } from "@/lib/app-shortcuts"
import { resolveUserFacingError, userFacingErrorDescription } from "@/lib/user-facing-error"
import { cn } from "@/lib/utils"
import { chatTurnInputKey } from "@/routes/Chat/chat-turns"
import { hasComposerDraftContent, toCachedComposerState } from "@/routes/Chat/composer-state"
import { visibleUserText } from "@/routes/Chat/message-text"

type Route = "archived" | "billing" | "chat" | "connections" | "organizations" | "skills" | "settings"

const ArtifactsPanel = React.lazy(() =>
  import("@/routes/Chat/GeneratedArtifacts").then((module) => ({ default: module.ArtifactsPanel })),
)
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

const SIDEBAR_RESTORE_DELAY_MS = 260
const SIDEBAR_AUTO_COLLAPSE_MAX_WIDTH_PX = 720
const SIDEBAR_DEFAULT_WIDTH_PX = 264
const SIDEBAR_MIN_WIDTH_PX = 220
const SIDEBAR_MAX_WIDTH_PX = 420
const SIDEBAR_WIDTH_STORAGE_KEY = "lumo.sidebarWidth"
const CHAT_AREA_MIN_WIDTH_PX = 320
const ARTIFACTS_PANEL_DEFAULT_WIDTH_PX = 300
const ARTIFACTS_PANEL_MIN_WIDTH_PX = 260
const ARTIFACTS_PANEL_WIDTH_STORAGE_KEY = "lumo.artifactsPanelWidth"
const TURN_RETRY_OPTIONS_LIMIT = 48
const SESSION_TITLE_RETRY_DELAY_MS = 20_000
const EMPTY_CONNECTION_PROVIDERS: ConnectionProvider[] = []
const NEW_SESSION_COMPOSER_DRAFT_KEY = "__new_session__"

function RouteLoadingFallback({ className }: { className?: string }) {
  return <div className={cn("h-full min-h-0 bg-background", className)} />
}

interface TurnRetryOptions {
  contextMentions?: ChatContextMention[]
  model?: ModelChoice
}

function initialRoute(): Route {
  const route = (import.meta.env as Record<string, string | undefined>)["VITE_LUMO_ROUTE"]
  return route === "settings" ||
    route === "connections" ||
    route === "skills" ||
    route === "organizations" ||
    route === "billing" ||
    route === "archived"
    ? route
    : "chat"
}

function clampSidebarWidth(width: number): number {
  return Math.min(SIDEBAR_MAX_WIDTH_PX, Math.max(SIDEBAR_MIN_WIDTH_PX, width))
}

function readStoredSidebarWidth(): number {
  try {
    const stored = globalThis.localStorage?.getItem(SIDEBAR_WIDTH_STORAGE_KEY)
    if (!stored) {
      return SIDEBAR_DEFAULT_WIDTH_PX
    }
    const width = Number.parseInt(stored, 10)
    return Number.isFinite(width) ? clampSidebarWidth(width) : SIDEBAR_DEFAULT_WIDTH_PX
  } catch {
    return SIDEBAR_DEFAULT_WIDTH_PX
  }
}

function clampArtifactsPanelWidth(width: number): number {
  return Math.max(ARTIFACTS_PANEL_MIN_WIDTH_PX, width)
}

function artifactsPanelMaxWidth(appWidth: number, sidebarWidth: number, sidebarCollapsed: boolean): number {
  const sidebarTrackWidth = sidebarCollapsed ? 0 : sidebarWidth
  const maxWidth = Math.floor(appWidth - sidebarTrackWidth - CHAT_AREA_MIN_WIDTH_PX)
  return Math.max(ARTIFACTS_PANEL_MIN_WIDTH_PX, maxWidth)
}

function clampArtifactsPanelWidthForLayout(width: number, maxWidth: number): number {
  return Math.min(maxWidth, clampArtifactsPanelWidth(width))
}

function readStoredArtifactsPanelWidth(): number {
  try {
    const stored = globalThis.localStorage?.getItem(ARTIFACTS_PANEL_WIDTH_STORAGE_KEY)
    if (!stored) {
      return ARTIFACTS_PANEL_DEFAULT_WIDTH_PX
    }
    const width = Number.parseInt(stored, 10)
    return Number.isFinite(width) ? clampArtifactsPanelWidth(width) : ARTIFACTS_PANEL_DEFAULT_WIDTH_PX
  } catch {
    return ARTIFACTS_PANEL_DEFAULT_WIDTH_PX
  }
}

function chatMessageText(message: ChatMessage): string {
  const text = message.parts
    .filter((part) => part.kind === "text")
    .map((part) => part.text ?? "")
    .join("")
  return message.role === "user" ? visibleUserText(text) : text
}

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
  const [failed, setFailed] = React.useState(false)
  const avatarUrl = workspace.type === "organization" ? workspace.organization?.avatar : accountAvatarUrl
  const fallback =
    workspace.type === "organization"
      ? organizationInitials(workspace.organization?.name ?? workspace.organizationId)
      : accountInitial(accountName)
  const fallbackStyle =
    workspace.type === "organization" && (!avatarUrl || failed)
      ? organizationAvatarStyle(workspace.organizationId)
      : undefined

  React.useEffect(() => {
    setFailed(false)
  }, [avatarUrl])

  return (
    <span
      className={cn(
        "grid shrink-0 place-items-center overflow-hidden rounded-full border bg-background text-xs font-medium text-foreground",
        className,
      )}
      style={fallbackStyle}
    >
      {avatarUrl && !failed ? (
        <img
          src={avatarUrl}
          alt=""
          className="size-full object-cover"
          draggable={false}
          referrerPolicy="no-referrer"
          onError={() => setFailed(true)}
        />
      ) : (
        fallback
      )}
    </span>
  )
}

function WorkspaceMenuContent({
  accountAvatarUrl,
  accountName,
  align = "start",
  loading,
  onManageOrganizations,
  onRefresh,
  onSelectOrganization,
  onSelectPersonal,
  error,
  getOrganizationRole,
  hasLoaded,
  organizations,
  side = "bottom",
  workspace,
}: {
  accountAvatarUrl?: string
  accountName?: string
  align?: "center" | "end" | "start"
  error: UseOrganizationWorkspace["error"]
  getOrganizationRole: UseOrganizationWorkspace["getOrganizationRole"]
  hasLoaded: boolean
  loading: boolean
  onManageOrganizations: () => void
  onRefresh: () => void
  onSelectOrganization: (organizationId: string) => void
  onSelectPersonal: () => void
  organizations: UseOrganizationWorkspace["organizations"]
  side?: "bottom" | "left" | "right" | "top"
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
    "my-1 grid min-w-0 grid-cols-[2.5rem_minmax(0,1fr)_3.5rem] items-center gap-2 rounded-md py-2 data-[active=true]:bg-accent data-[active=true]:text-accent-foreground focus:bg-accent focus:text-accent-foreground"

  return (
    <DropdownMenuContent align={align} side={side} sideOffset={8} className="w-72">
      <DropdownMenuLabel>{t("organizations.workspaceGroup")}</DropdownMenuLabel>
      <DropdownMenuItem
        className={workspaceItemClassName}
        onSelect={onSelectPersonal}
        data-active={activeKey === "personal"}
      >
        <WorkspaceAvatar
          accountAvatarUrl={accountAvatarUrl}
          accountName={accountName}
          workspace={{ type: "personal" }}
        />
        <span className="grid min-w-0 flex-1 gap-0.5">
          <span className="truncate">{personalLabel}</span>
          <span className="oo-text-caption-compact truncate text-muted-foreground">{personalDescription}</span>
        </span>
        <span aria-hidden="true" />
      </DropdownMenuItem>
      {loading ? (
        <DropdownMenuItem disabled>
          <LoaderCircle className="size-4 animate-spin" />
          {t("organizations.loading")}
        </DropdownMenuItem>
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
        return (
          <DropdownMenuItem
            key={organization.id}
            className={workspaceItemClassName}
            onSelect={() => onSelectOrganization(organization.id)}
            data-active={selected}
          >
            <WorkspaceAvatar
              workspace={{ type: "organization", organization, organizationId: organization.id, role }}
            />
            <span className="min-w-0 flex-1 truncate">{organization.name}</span>
            <Badge variant="outline" className="flex w-full justify-end text-right font-normal">
              {role === "creator" ? t("organizations.roleCreator") : t("organizations.roleMember")}
            </Badge>
          </DropdownMenuItem>
        )
      })}
      {!loading && organizations.length === 0 && !showBlockingError ? (
        <div className="oo-text-caption oo-text-muted px-2 py-1.5">{t("organizations.emptyOrganizations")}</div>
      ) : null}
      <DropdownMenuSeparator />
      {error ? (
        <DropdownMenuItem onSelect={onRefresh}>
          <RefreshCw className="size-4" />
          {t("organizations.retry")}
        </DropdownMenuItem>
      ) : null}
      <DropdownMenuItem onSelect={onManageOrganizations}>
        <Building2 className="size-4" />
        {t("organizations.manageOrganizations")}
      </DropdownMenuItem>
    </DropdownMenuContent>
  )
}

function rememberTurnRetryOptions(
  store: Map<string, Map<string, TurnRetryOptions>>,
  sessionId: string,
  key: string,
  options: TurnRetryOptions,
): void {
  const sessionStore = store.get(sessionId) ?? new Map<string, TurnRetryOptions>()
  sessionStore.set(key, options)
  while (sessionStore.size > TURN_RETRY_OPTIONS_LIMIT) {
    const first = sessionStore.keys().next()
    if (first.done) {
      break
    }
    sessionStore.delete(first.value)
  }
  store.set(sessionId, sessionStore)
}

function buildSessionTitleInput(
  messages: ChatMessage[],
  text: string,
  attachments: ChatAttachment[],
): { text: string; attachmentNames?: string[] } {
  const recentUserMessages = messages
    .filter((message) => message.role === "user")
    .map(chatMessageText)
    .map((messageText) => messageText.trim())
    .filter(Boolean)
    .slice(-3)
  const currentText = text.trim()
  const titleText = [...recentUserMessages, currentText].filter(Boolean).join("\n\n")
  const attachmentNames = attachments.map((attachment) => attachment.name.trim()).filter(Boolean)
  return {
    text: titleText || attachmentNames.join("\n"),
    ...(attachmentNames.length > 0 ? { attachmentNames } : {}),
  }
}

function sessionTitleGenerationKey(
  input: { text: string; attachmentNames?: string[] },
  allowPlaceholder: boolean,
  replaceableTitle?: string,
): string {
  return JSON.stringify({
    allowPlaceholder,
    attachmentNames: input.attachmentNames ?? [],
    replaceableTitle: replaceableTitle ?? "",
    text: input.text,
  })
}

function isSessionTitleAutoRefreshable(
  session: SessionInfo,
  allowPlaceholder: boolean,
  fallbackTitles: Map<string, string>,
  fallbackTitle?: string,
): boolean {
  return (
    shouldAutoRefreshSessionTitle(session.title, allowPlaceholder) ||
    fallbackTitles.get(session.id) === session.title ||
    fallbackTitle === session.title
  )
}

function createQueuedChatMessage(
  sessionId: string,
  text: string,
  attachments: ChatAttachment[],
  contextMentions: ChatContextMention[] | undefined,
  model?: ModelChoice,
): QueuedChatMessage {
  return {
    id: globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`,
    sessionId,
    text,
    attachments,
    ...(contextMentions && contextMentions.length > 0 ? { contextMentions } : {}),
    model,
    createdAt: Date.now(),
  }
}

function SessionItem({
  session,
  active,
  running,
  unread,
  now,
  onSelect,
  onRenameRequest,
  onPinToggle,
  onArchive,
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
        "oo-sidebar-nav-item group oo-text-control flex h-8 items-center rounded-md px-3",
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

function RenameSessionDialog({
  session,
  open,
  onClose,
  onRename,
}: {
  session: SessionInfo | null
  open: boolean
  onClose: () => void
  onRename: (sessionId: string, title: string) => void
}) {
  const t = useT()
  const inputRef = React.useRef<HTMLInputElement | null>(null)
  const [draft, setDraft] = React.useState("")
  const trimmedDraft = draft.trim()
  const canSave = Boolean(session && trimmedDraft)

  React.useEffect(() => {
    if (!open || !session) {
      return
    }
    setDraft(session.title)
    window.setTimeout(() => {
      inputRef.current?.focus()
      inputRef.current?.select()
    }, 0)
  }, [open, session])

  if (!open || !session) {
    return null
  }

  const save = (): void => {
    if (!canSave) {
      return
    }
    const nextTitle = trimTitleToColumns(trimmedDraft)
    if (nextTitle !== session.title) {
      onRename(session.id, nextTitle)
    }
    onClose()
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="rename-session-title"
      aria-describedby="rename-session-description"
      className="oo-modal-backdrop fixed inset-0 z-50 flex items-center justify-center p-5"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) {
          onClose()
        }
      }}
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.preventDefault()
          onClose()
        }
      }}
    >
      <form
        className="oo-modal-surface w-full max-w-[440px] rounded-xl p-6"
        onSubmit={(event) => {
          event.preventDefault()
          save()
        }}
      >
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <h2 id="rename-session-title" className="oo-text-dialog-title text-foreground">
              {t("session.renameTitle")}
            </h2>
            <p id="rename-session-description" className="oo-text-caption mt-1 text-muted-foreground">
              {t("session.renameDescription")}
            </p>
          </div>
          <button
            type="button"
            aria-label={t("session.renameClose")}
            onClick={onClose}
            className="oo-icon-muted -mt-1 -mr-1 flex size-7 shrink-0 items-center justify-center rounded-md hover:bg-accent hover:text-foreground"
          >
            <span aria-hidden="true">×</span>
          </button>
        </div>

        <input
          ref={inputRef}
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          aria-label={t("session.renameInputLabel")}
          className="oo-text-value mt-6 block h-8 w-full min-w-0 border-0 bg-transparent p-0 text-foreground shadow-none ring-0 outline-none selection:bg-primary selection:text-primary-foreground placeholder:text-muted-foreground focus:border-0 focus:ring-0 focus:outline-none focus-visible:outline-none"
        />

        <div className="mt-6 flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={onClose}>
            {t("common.cancel")}
          </Button>
          <Button type="submit" disabled={!canSave}>
            {t("common.save")}
          </Button>
        </div>
      </form>
    </div>
  )
}

function ArchiveSessionDialog({
  confirming,
  open,
  onClose,
  onConfirm,
}: {
  confirming: boolean
  open: boolean
  onClose: () => void
  onConfirm: () => void
}) {
  const t = useT()

  return (
    <Dialog
      open={open}
      onClose={() => {
        if (!confirming) {
          onClose()
        }
      }}
      closeLabel={t("common.cancel")}
      title={t("session.archiveConfirmTitle")}
      footer={
        <>
          <Button type="button" variant="outline" disabled={confirming} onClick={onClose}>
            {t("common.cancel")}
          </Button>
          <Button type="button" disabled={confirming} onClick={onConfirm}>
            {confirming ? <LoaderCircle className="size-3.5 animate-spin" /> : null}
            {confirming ? t("session.archiveConfirming") : t("session.archiveConfirmAction")}
          </Button>
        </>
      }
    >
      <p className="oo-text-body text-muted-foreground">{t("session.archiveConfirmDescription")}</p>
    </Dialog>
  )
}

function EditableTitlebarTitle({
  title,
  editable,
  onRename,
}: {
  title: string
  editable: boolean
  onRename: (title: string) => void
}) {
  const t = useT()
  const inputRef = React.useRef<HTMLInputElement | null>(null)
  const cancelNextBlur = React.useRef(false)
  const [editing, setEditing] = React.useState(false)
  const [draft, setDraft] = React.useState(title)

  React.useEffect(() => {
    if (!editing) {
      setDraft(title)
    }
  }, [editing, title])

  React.useEffect(() => {
    if (!editing) {
      return
    }
    window.setTimeout(() => {
      inputRef.current?.focus()
      inputRef.current?.select()
    }, 0)
  }, [editing])

  const startEditing = (): void => {
    if (!editable) {
      return
    }
    setDraft(title)
    setEditing(true)
  }
  const handleRenameKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>): void => {
    if (event.key === "F2" || event.key === "Enter") {
      event.preventDefault()
      startEditing()
    }
  }

  const commit = (): void => {
    const trimmedDraft = draft.trim()
    setEditing(false)
    if (!trimmedDraft) {
      return
    }
    const nextTitle = trimTitleToColumns(trimmedDraft)
    if (nextTitle && nextTitle !== title) {
      onRename(nextTitle)
    }
  }

  if (editing) {
    return (
      <input
        ref={inputRef}
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={() => {
          if (cancelNextBlur.current) {
            cancelNextBlur.current = false
            return
          }
          commit()
        }}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault()
            commit()
          } else if (event.key === "Escape") {
            event.preventDefault()
            cancelNextBlur.current = true
            setDraft(title)
            setEditing(false)
          }
        }}
        aria-label={t("session.renameInputLabel")}
        className="oo-toolbar-title oo-text-title block h-[var(--oo-line-control)] w-full min-w-0 border-0 bg-transparent p-0 shadow-none ring-0 outline-none [-webkit-app-region:no-drag] selection:bg-primary selection:text-primary-foreground focus:border-0 focus:ring-0 focus:outline-none focus-visible:outline-none"
      />
    )
  }

  if (!editable) {
    return (
      <span className="oo-toolbar-title oo-text-title inline-block max-w-full min-w-0 truncate" title={title}>
        {title}
      </span>
    )
  }

  return (
    <button
      type="button"
      onDoubleClick={startEditing}
      onKeyDown={handleRenameKeyDown}
      title={title}
      aria-label={t("session.renameFromTitlebar")}
      className="oo-toolbar-title oo-text-title inline-block max-w-full min-w-0 cursor-pointer truncate border-0 bg-transparent p-0 text-left outline-none [-webkit-app-region:no-drag]"
    >
      {title}
    </button>
  )
}

function SessionSearchOverlay({
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
      className="oo-modal-backdrop fixed inset-0 z-50 flex items-center justify-center p-5"
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
        <div className="oo-session-search-input oo-text-title flex h-10 min-w-0 items-center gap-2 rounded-lg border px-3">
          <Search className="size-4 shrink-0 text-muted-foreground" />
          <Input
            ref={inputRef}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={t("sidebar.searchPlaceholder")}
            aria-label={t("sidebar.searchPlaceholder")}
            aria-activedescendant={activeResultId}
            aria-controls="session-search-results"
            aria-expanded="true"
            className="h-8 min-w-0 flex-1 border-0 bg-transparent px-0 shadow-none focus-visible:ring-0"
            role="combobox"
          />
        </div>

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
                className={cn(
                  "oo-session-search-result oo-text-value flex h-10 min-w-0 items-center rounded-lg px-3 text-left",
                  index === activeIndex && "bg-accent text-accent-foreground",
                )}
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

function SidebarEmptyState() {
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

function SidebarTitlebarActions({
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

function SidebarFooterControls({
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
  activeRoute: Route
  loggingOut: boolean
  onNavigate: (route: Route) => void
  onLogout: () => void
  workspace: UseOrganizationWorkspace
}) {
  const t = useT()
  const trimmedAccountName = accountName?.trim()
  const displayName = trimmedAccountName || t("settings.account")
  const personalWorkspaceLabel = trimmedAccountName || t("organizations.personal")
  const activeWorkspaceLabel =
    workspace.activeWorkspace.type === "organization"
      ? (workspace.activeWorkspace.organization?.name ?? t("organizations.workspace"))
      : personalWorkspaceLabel

  return (
    <div className="oo-sidebar-account -mx-3 flex h-12 shrink-0 items-center gap-1 px-3 [-webkit-app-region:no-drag]">
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            className="oo-sidebar-nav-item oo-sidebar-workspace-trigger flex h-10 min-w-0 flex-1 items-center gap-2 rounded-md px-1.5 text-left"
            aria-label={t("organizations.workspaceSwitcher")}
            title={activeWorkspaceLabel}
          >
            <WorkspaceAvatar
              accountAvatarUrl={avatarUrl}
              accountName={displayName}
              className="size-7"
              workspace={workspace.activeWorkspace}
            />
            <div className="oo-sidebar-nav-label min-w-0 flex-1">
              <div className="oo-text-control truncate text-sidebar-foreground" title={activeWorkspaceLabel}>
                {activeWorkspaceLabel}
              </div>
            </div>
            <ChevronsUpDown className="oo-sidebar-nav-label size-4 shrink-0 text-muted-foreground" />
          </button>
        </DropdownMenuTrigger>
        <WorkspaceMenuContent
          accountAvatarUrl={avatarUrl}
          accountName={trimmedAccountName}
          align="start"
          error={workspace.error}
          getOrganizationRole={workspace.getOrganizationRole}
          hasLoaded={workspace.hasLoaded}
          loading={workspace.loading}
          organizations={workspace.organizations}
          side="top"
          workspace={workspace.activeWorkspace}
          onManageOrganizations={() => onNavigate("organizations")}
          onRefresh={() => void workspace.refresh({ forceRefresh: true })}
          onSelectOrganization={workspace.selectOrganization}
          onSelectPersonal={workspace.selectPersonal}
        />
      </DropdownMenu>

      <DropdownMenu>
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
          <DropdownMenuItem onSelect={() => onNavigate("connections")}>
            <Plug className="size-4" />
            {t("connections.title")}
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => onNavigate("skills")}>
            <Package className="size-4" />
            {t("skills.title")}
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => onNavigate("archived")}>
            <Archive className="size-4" />
            {t("archived.navTitle")}
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => onNavigate("settings")}>
            <Settings className="size-4" />
            {t("settings.title")}
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem variant="destructive" disabled={loggingOut} onSelect={onLogout}>
            <LogOut className="size-4" />
            {t("settings.logout")}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  )
}

function AccountAvatar({ name, avatarUrl }: { name: string; avatarUrl?: string }) {
  const [failed, setFailed] = React.useState(false)

  React.useEffect(() => {
    setFailed(false)
  }, [avatarUrl])

  return (
    <div className="flex size-7 shrink-0 items-center justify-center overflow-hidden rounded-full bg-muted text-xs font-medium text-foreground">
      {avatarUrl && !failed ? (
        <img
          src={avatarUrl}
          alt=""
          className="size-full object-cover"
          draggable={false}
          referrerPolicy="no-referrer"
          onError={() => setFailed(true)}
        />
      ) : (
        accountInitial(name)
      )}
    </div>
  )
}

function AppUpdateTitlebarEntry() {
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

export function AppShell() {
  const t = useT()
  const chatService = useChatService()
  const auth = useAuth()
  const [ready, setReady] = React.useState(false)
  const [agentStatus, setAgentStatus] = React.useState<AgentRuntimeStatus>({ status: "starting" })
  const {
    sessions,
    loaded: sessionsLoaded,
    error: sessionsError,
    create,
    generateTitle,
    rename,
    pin,
    archive,
    listArchived,
    unarchive,
    remove: removeSession,
    refresh: refreshSessions,
  } = useSessions({ enabled: ready })
  const [route, setRoute] = React.useState<Route>(initialRoute)
  const [activeSessionId, setActiveSessionId] = React.useState<string | null>(null)
  const [isDraftSession, setIsDraftSession] = React.useState(false)
  const [pendingChatTransition, setPendingChatTransition] = React.useState<PendingChatTransition | null>(null)
  const [queuedMessagesBySession, setQueuedMessagesBySession] = React.useState<ChatQueueMap>({})
  const [sidebarCollapsed, setSidebarCollapsed] = React.useState(false)
  const [isSidebarRestoring, setIsSidebarRestoring] = React.useState(false)
  const [sidebarWidth, setSidebarWidth] = React.useState(readStoredSidebarWidth)
  const [isSidebarResizing, setIsSidebarResizing] = React.useState(false)
  const [searchOpen, setSearchOpen] = React.useState(false)
  const [composerFocusRequest, setComposerFocusRequest] = React.useState(0)
  const [renameSessionId, setRenameSessionId] = React.useState<string | null>(null)
  const [archiveSessionId, setArchiveSessionId] = React.useState<string | null>(null)
  const [archiveConfirming, setArchiveConfirming] = React.useState(false)
  const [relativeTimeNow, setRelativeTimeNow] = React.useState(() => Date.now())
  const [artifactSelection, setArtifactSelection] = React.useState<ArtifactSelection | null>(null)
  const [artifactsPanelOpen, setArtifactsPanelOpen] = React.useState(false)
  const [artifactsPanelWidth, setArtifactsPanelWidth] = React.useState(readStoredArtifactsPanelWidth)
  const [artifactsPanelMaxWidthState, setArtifactsPanelMaxWidthState] = React.useState<number | null>(null)
  const [isArtifactsPanelResizing, setIsArtifactsPanelResizing] = React.useState(false)

  const { messages, status, activity, messagesLoaded, error, getSessionStatus, hasUnreadSession, send, stop } = useChat(
    activeSessionId,
    route === "chat" ? activeSessionId : null,
  )
  const organizationWorkspace = useOrganizationWorkspace(auth.state?.account?.id)
  const connections = useConnections(organizationWorkspace.connectionWorkspace)
  const [selectedService, setSelectedService] = React.useState<string | null>(null)
  // 聊天内"去授权"后待重试的原 action：provider 连上后自动重发。
  const pendingRetry = React.useRef<{
    sessionId: string
    service: string
    text: string
    attachments: ChatAttachment[]
    contextMentions?: ChatContextMention[]
    model?: ModelChoice
  } | null>(null)
  const sidebarResizeStart = React.useRef<{ pointerX: number; width: number } | null>(null)
  const artifactsPanelResizeStart = React.useRef<{ pointerX: number; width: number } | null>(null)
  const artifactsPanelResizeFrame = React.useRef<number | null>(null)
  const artifactsPanelPendingWidth = React.useRef<number | null>(null)
  const appChromeRef = React.useRef<HTMLDivElement | null>(null)
  const artifactsPanelShellRef = React.useRef<HTMLDivElement | null>(null)
  const artifactsPanelContentRef = React.useRef<HTMLDivElement | null>(null)
  const lastModelBySession = React.useRef<Map<string, ModelChoice | undefined>>(new Map())
  const lastContextMentionsBySession = React.useRef<Map<string, ChatContextMention[]>>(new Map())
  const turnRetryOptionsBySession = React.useRef<Map<string, Map<string, TurnRetryOptions>>>(new Map())
  const composerDraftsByKey = React.useRef<Map<string, ComposerState>>(new Map())
  const sessionsRef = React.useRef<SessionInfo[]>([])
  const sendInFlightRef = React.useRef(false)
  const dispatchingQueuedSessionsRef = React.useRef<Set<string>>(new Set())
  const titleGenerationInFlightBySession = React.useRef<Map<string, string>>(new Map())
  const lastTitleGenerationKeyBySession = React.useRef<Map<string, string>>(new Map())
  const titleGenerationRetryAfterBySession = React.useRef<Map<string, { key: string; retryAfter: number }>>(new Map())
  const autoFallbackTitleBySession = React.useRef<Map<string, string>>(new Map())
  React.useEffect(() => {
    sessionsRef.current = sessions
  }, [sessions])

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
    const id = window.setInterval(() => setRelativeTimeNow(Date.now()), 60_000)
    return () => window.clearInterval(id)
  }, [])

  // dev/smoke：VITE_LUMO_SMOKE 设置时，就绪后自动发送一条消息用于可视化验证（生产无此 env，无害）。
  const smokeSent = React.useRef(false)
  React.useEffect(() => {
    const smoke = (import.meta.env as Record<string, string | undefined>)["VITE_LUMO_SMOKE"]
    if (ready && smoke && !smokeSent.current) {
      smokeSent.current = true
      void handleSend(smoke)
    }
  }, [ready])

  // 默认选中最近的会话。用 layout effect 避免 sessions 加载完成后的中间帧先绘制空聊天态。
  React.useLayoutEffect(() => {
    if (sessionsLoaded && !isDraftSession && !activeSessionId && sessions.length > 0) {
      setActiveSessionId(sessions[0].id)
    }
  }, [sessions, sessionsLoaded, activeSessionId, isDraftSession])

  // R5 闭环：待重试的 provider 一旦连上，刷新已授权清单后自动重发原 action。
  React.useEffect(() => {
    const pending = pendingRetry.current
    if (!pending) {
      return
    }
    const connected = connections.summary?.providers.some(
      (p) => p.service === pending.service && p.status === "connected" && p.appStatus === "active",
    )
    if (connected) {
      pendingRetry.current = null
      setSelectedService(null)
      setRoute("chat")
      void send(pending.sessionId, pending.text, pending.attachments, {
        contextMentions: pending.contextMentions ?? [],
        model: pending.model,
      })
    }
  }, [connections.summary, send])

  const activeSession = sessions.find((s) => s.id === activeSessionId)
  const sidebarSessionGroups = React.useMemo(() => groupSidebarSessions(sessions), [sessions])
  const activeComposerDraftKey = activeSessionId ?? NEW_SESSION_COMPOSER_DRAFT_KEY
  const initialComposerState = composerDraftsByKey.current.get(activeComposerDraftKey)
  const renameSession = sessions.find((s) => s.id === renameSessionId) ?? null
  const activeQueuedMessages = activeSessionId ? (queuedMessagesBySession[activeSessionId] ?? []) : []
  const archiveSession = sessions.find((s) => s.id === archiveSessionId) ?? null
  const activeProviders = connections.summary?.providers ?? EMPTY_CONNECTION_PROVIDERS
  const pendingCaughtUp = isPendingChatCaughtUp(pendingChatTransition, activeSessionId, messages)
  const initialSendPending = Boolean(pendingChatTransition && !pendingCaughtUp)
  const bridgeInitialSendPending = initialSendPending && messages.length === 0
  const displayedStatus: ChatStatus = initialSendPending ? "submitted" : status
  const needsDefaultSessionSelection = sessionsLoaded && !isDraftSession && !activeSessionId && sessions.length > 0
  const startupError =
    agentStatus.status === "error" ? resolveUserFacingError(agentStatus.message, { area: "agent" }) : null
  const chatBootstrapping =
    !startupError &&
    (!ready ||
      !sessionsLoaded ||
      needsDefaultSessionSelection ||
      Boolean(activeSessionId && !messagesLoaded && !pendingChatTransition))
  const showChatEmptyState = ready && sessionsLoaded && !activeSessionId && !pendingChatTransition
  const isSessionRunning = React.useCallback(
    (sessionId: string): boolean => {
      const sessionStatus = getSessionStatus(sessionId)
      return (
        sessionStatus === "submitted" ||
        sessionStatus === "streaming" ||
        (sessionId === activeSessionId && pendingChatTransition?.sessionId === sessionId && !pendingCaughtUp)
      )
    },
    [activeSessionId, getSessionStatus, pendingCaughtUp, pendingChatTransition],
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
  const artifactsPanelMaxWidthValue = artifactsPanelMaxWidthState ?? Number.POSITIVE_INFINITY
  const clampArtifactsPanelWidthToLayout = React.useCallback(
    (width: number): number => clampArtifactsPanelWidthForLayout(width, artifactsPanelMaxWidthValue),
    [artifactsPanelMaxWidthValue],
  )
  const applyArtifactsPanelShellWidth = React.useCallback((width: number): void => {
    const element = artifactsPanelShellRef.current
    if (element) {
      element.style.width = `${width}px`
    }
  }, [])
  const freezeArtifactsPanelContentWidth = React.useCallback((width: number): void => {
    const element = artifactsPanelContentRef.current
    if (element) {
      element.style.width = `${width}px`
    }
  }, [])
  const clearArtifactsPanelContentWidth = React.useCallback((): void => {
    const element = artifactsPanelContentRef.current
    if (element) {
      element.style.removeProperty("width")
    }
  }, [])

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
    if (archiveSessionId && !archiveSession) {
      setArchiveSessionId(null)
    }
  }, [archiveSession, archiveSessionId])

  React.useEffect(() => {
    setArtifactSelection(null)
    setArtifactsPanelOpen(false)
  }, [activeSessionId])

  React.useEffect(() => {
    if (pendingChatTransition && status === "error") {
      setPendingChatTransition(null)
    }
  }, [pendingChatTransition, status])

  React.useEffect(() => {
    if (!isSidebarRestoring) {
      return
    }
    const id = window.setTimeout(() => setIsSidebarRestoring(false), SIDEBAR_RESTORE_DELAY_MS)
    return () => window.clearTimeout(id)
  }, [isSidebarRestoring])

  React.useEffect(() => {
    const mediaQuery = window.matchMedia(`(max-width: ${SIDEBAR_AUTO_COLLAPSE_MAX_WIDTH_PX}px)`)
    const collapseIfNarrow = (matches: boolean): void => {
      if (matches) {
        setSidebarCollapsed(true)
      }
    }

    collapseIfNarrow(mediaQuery.matches)
    const onChange = (event: MediaQueryListEvent): void => collapseIfNarrow(event.matches)
    mediaQuery.addEventListener("change", onChange)
    return () => mediaQuery.removeEventListener("change", onChange)
  }, [])

  React.useLayoutEffect(() => {
    const element = appChromeRef.current
    if (!element) {
      return
    }

    const updateArtifactsPanelBounds = (): void => {
      const maxWidth = artifactsPanelMaxWidth(element.clientWidth, sidebarWidth, sidebarCollapsed)
      setArtifactsPanelMaxWidthState(maxWidth)
      setArtifactsPanelWidth((width) => clampArtifactsPanelWidthForLayout(width, maxWidth))
    }

    updateArtifactsPanelBounds()
    const observer = new ResizeObserver(updateArtifactsPanelBounds)
    observer.observe(element)
    return () => observer.disconnect()
  }, [sidebarCollapsed, sidebarWidth])

  React.useEffect(() => {
    try {
      globalThis.localStorage?.setItem(SIDEBAR_WIDTH_STORAGE_KEY, String(sidebarWidth))
    } catch {
      // 本地存储不可用时仅保留本次会话宽度。
    }
  }, [sidebarWidth])

  React.useEffect(() => {
    try {
      globalThis.localStorage?.setItem(ARTIFACTS_PANEL_WIDTH_STORAGE_KEY, String(artifactsPanelWidth))
    } catch {
      // 本地存储不可用时仅保留本次会话宽度。
    }
  }, [artifactsPanelWidth])

  React.useEffect(() => {
    if (!isSidebarResizing) {
      return
    }

    const handlePointerMove = (event: PointerEvent): void => {
      const start = sidebarResizeStart.current
      if (!start) {
        return
      }
      setSidebarWidth(clampSidebarWidth(start.width + event.clientX - start.pointerX))
    }
    const handlePointerUp = (): void => {
      sidebarResizeStart.current = null
      setIsSidebarResizing(false)
    }

    window.addEventListener("pointermove", handlePointerMove)
    window.addEventListener("pointerup", handlePointerUp, { once: true })
    window.addEventListener("pointercancel", handlePointerUp, { once: true })
    return () => {
      window.removeEventListener("pointermove", handlePointerMove)
      window.removeEventListener("pointerup", handlePointerUp)
      window.removeEventListener("pointercancel", handlePointerUp)
    }
  }, [isSidebarResizing])

  React.useEffect(() => {
    if (!isArtifactsPanelResizing) {
      return
    }

    const flushArtifactsPanelWidth = (): void => {
      artifactsPanelResizeFrame.current = null
      const width = artifactsPanelPendingWidth.current
      if (width !== null) {
        applyArtifactsPanelShellWidth(width)
      }
    }
    const handlePointerMove = (event: PointerEvent): void => {
      const start = artifactsPanelResizeStart.current
      if (!start) {
        return
      }
      artifactsPanelPendingWidth.current = clampArtifactsPanelWidthToLayout(
        start.width + start.pointerX - event.clientX,
      )
      if (artifactsPanelResizeFrame.current === null) {
        artifactsPanelResizeFrame.current = window.requestAnimationFrame(flushArtifactsPanelWidth)
      }
    }
    const handlePointerUp = (): void => {
      if (artifactsPanelResizeFrame.current !== null) {
        window.cancelAnimationFrame(artifactsPanelResizeFrame.current)
        artifactsPanelResizeFrame.current = null
      }
      const width = artifactsPanelPendingWidth.current
      artifactsPanelPendingWidth.current = null
      if (width !== null) {
        applyArtifactsPanelShellWidth(width)
        setArtifactsPanelWidth(width)
      }
      clearArtifactsPanelContentWidth()
      artifactsPanelResizeStart.current = null
      setIsArtifactsPanelResizing(false)
    }

    window.addEventListener("pointermove", handlePointerMove)
    window.addEventListener("pointerup", handlePointerUp, { once: true })
    window.addEventListener("pointercancel", handlePointerUp, { once: true })
    return () => {
      if (artifactsPanelResizeFrame.current !== null) {
        window.cancelAnimationFrame(artifactsPanelResizeFrame.current)
        artifactsPanelResizeFrame.current = null
      }
      artifactsPanelPendingWidth.current = null
      clearArtifactsPanelContentWidth()
      window.removeEventListener("pointermove", handlePointerMove)
      window.removeEventListener("pointerup", handlePointerUp)
      window.removeEventListener("pointercancel", handlePointerUp)
    }
  }, [
    applyArtifactsPanelShellWidth,
    clampArtifactsPanelWidthToLayout,
    clearArtifactsPanelContentWidth,
    isArtifactsPanelResizing,
  ])

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

  const handleNewSession = React.useCallback((): void => {
    setActiveSessionId(null)
    setIsDraftSession(true)
    setPendingChatTransition(null)
    setRoute("chat")
    setSearchOpen(false)
    setComposerFocusRequest((request) => request + 1)
  }, [])

  const refreshGeneratedTitle = React.useCallback(
    async (
      sessionId: string,
      input: { text: string; attachmentNames?: string[] },
      allowPlaceholder: boolean,
      replaceableTitle?: string,
    ) => {
      const generationKey = sessionTitleGenerationKey(input, allowPlaceholder, replaceableTitle)
      if (
        titleGenerationInFlightBySession.current.get(sessionId) === generationKey ||
        lastTitleGenerationKeyBySession.current.get(sessionId) === generationKey
      ) {
        return
      }
      const retryAfter = titleGenerationRetryAfterBySession.current.get(sessionId)
      if (retryAfter?.key === generationKey && Date.now() < retryAfter.retryAfter) {
        return
      }

      const fallbackTitle = buildFallbackSessionTitle(input)
      const current = sessionsRef.current.find((session) => session.id === sessionId)
      if (
        current &&
        current.title !== replaceableTitle &&
        !isSessionTitleAutoRefreshable(current, allowPlaceholder, autoFallbackTitleBySession.current, fallbackTitle)
      ) {
        autoFallbackTitleBySession.current.delete(sessionId)
        titleGenerationRetryAfterBySession.current.delete(sessionId)
        lastTitleGenerationKeyBySession.current.set(sessionId, generationKey)
        return
      }

      titleGenerationInFlightBySession.current.set(sessionId, generationKey)
      const applyFallbackTitle = async (title: string): Promise<void> => {
        const latest = sessionsRef.current.find((session) => session.id === sessionId)
        if (!latest || !title) {
          return
        }
        const canRefresh = isSessionTitleAutoRefreshable(
          latest,
          allowPlaceholder,
          autoFallbackTitleBySession.current,
          fallbackTitle,
        )
        if (!canRefresh && title !== latest.title) {
          return
        }
        if (title !== latest.title) {
          await rename(sessionId, title)
        }
        if (canRefresh || title === latest.title) {
          autoFallbackTitleBySession.current.set(sessionId, title)
        }
      }
      try {
        const result = await generateTitle(input)
        const title = result.title
        const latest = sessionsRef.current.find((session) => session.id === sessionId)
        const latestTitle = latest?.title ?? replaceableTitle
        if (
          latest &&
          latest.title !== replaceableTitle &&
          !isSessionTitleAutoRefreshable(latest, allowPlaceholder, autoFallbackTitleBySession.current, fallbackTitle)
        ) {
          autoFallbackTitleBySession.current.delete(sessionId)
          titleGenerationRetryAfterBySession.current.delete(sessionId)
          lastTitleGenerationKeyBySession.current.set(sessionId, generationKey)
          return
        }

        if (!result.generated) {
          await applyFallbackTitle(title || fallbackTitle)
          titleGenerationRetryAfterBySession.current.set(sessionId, {
            key: generationKey,
            retryAfter: Date.now() + SESSION_TITLE_RETRY_DELAY_MS,
          })
          return
        }

        if (title && title !== latestTitle) {
          await rename(sessionId, title)
          autoFallbackTitleBySession.current.delete(sessionId)
          titleGenerationRetryAfterBySession.current.delete(sessionId)
          lastTitleGenerationKeyBySession.current.set(sessionId, generationKey)
          return
        }
        if (
          latestTitle &&
          (shouldAutoRefreshSessionTitle(latestTitle, allowPlaceholder) ||
            autoFallbackTitleBySession.current.get(sessionId) === latestTitle ||
            fallbackTitle === latestTitle)
        ) {
          autoFallbackTitleBySession.current.delete(sessionId)
          titleGenerationRetryAfterBySession.current.delete(sessionId)
          lastTitleGenerationKeyBySession.current.set(sessionId, generationKey)
          return
        }
        titleGenerationRetryAfterBySession.current.delete(sessionId)
        lastTitleGenerationKeyBySession.current.set(sessionId, generationKey)
      } catch (error) {
        await applyFallbackTitle(fallbackTitle)
        titleGenerationRetryAfterBySession.current.set(sessionId, {
          key: generationKey,
          retryAfter: Date.now() + SESSION_TITLE_RETRY_DELAY_MS,
        })
        console.error("[lumo] generate session title failed", error)
      } finally {
        if (titleGenerationInFlightBySession.current.get(sessionId) === generationKey) {
          titleGenerationInFlightBySession.current.delete(sessionId)
        }
      }
    },
    [generateTitle, rename],
  )

  React.useEffect(() => {
    if (!activeSession || !messagesLoaded || messages.length === 0) {
      return
    }
    const titleInput = buildSessionTitleInput(messages, "", [])
    if (!titleInput.text && !titleInput.attachmentNames?.length) {
      return
    }
    const fallbackTitle = buildFallbackSessionTitle(titleInput)
    if (!isSessionTitleAutoRefreshable(activeSession, true, autoFallbackTitleBySession.current, fallbackTitle)) {
      return
    }
    void refreshGeneratedTitle(activeSession.id, titleInput, true, activeSession.title)
  }, [activeSession, messages, messagesLoaded, refreshGeneratedTitle])

  const sendNow = React.useCallback(
    async (
      text: string,
      attachments: ChatAttachment[] = [],
      contextMentions: ChatContextMention[] = [],
      model?: ModelChoice,
    ): Promise<boolean> => {
      if (sendInFlightRef.current) {
        return false
      }
      sendInFlightRef.current = true
      try {
        setRoute("chat")
        let sessionId = activeSessionId
        const titleInput = buildSessionTitleInput(messages, text, attachments)
        const fallbackTitle = buildFallbackSessionTitle(titleInput)
        const autoFallbackTitle = sessionId ? autoFallbackTitleBySession.current.get(sessionId) : undefined
        const allowPlaceholderTitle =
          !sessionId ||
          (activeSession
            ? isSessionTitleAutoRefreshable(activeSession, true, autoFallbackTitleBySession.current, fallbackTitle)
            : false)
        const shouldRefreshTitle =
          !sessionId ||
          (activeSession
            ? isSessionTitleAutoRefreshable(
                activeSession,
                allowPlaceholderTitle,
                autoFallbackTitleBySession.current,
                fallbackTitle,
              )
            : false)
        const bridgeEmptySend = messagesLoaded && messages.length === 0
        const createdAt = Date.now()
        if (bridgeEmptySend) {
          setPendingChatTransition({ sessionId, text, attachments, contextMentions, model, createdAt })
        }
        if (!sessionId) {
          let info: SessionInfo
          try {
            info = await create(fallbackTitle)
          } catch (error) {
            if (bridgeEmptySend) {
              setPendingChatTransition(null)
            }
            throw error
          }
          sessionId = info.id
          autoFallbackTitleBySession.current.set(sessionId, fallbackTitle)
          setActiveSessionId(sessionId)
          setIsDraftSession(false)
          setPendingChatTransition((pending) =>
            pending?.createdAt === createdAt ? { ...pending, sessionId: info.id } : pending,
          )
        }
        if (shouldRefreshTitle) {
          void refreshGeneratedTitle(
            sessionId,
            titleInput,
            allowPlaceholderTitle,
            !activeSessionId ? fallbackTitle : autoFallbackTitle,
          )
        }
        lastModelBySession.current.set(sessionId, model)
        lastContextMentionsBySession.current.set(sessionId, contextMentions)
        rememberTurnRetryOptions(
          turnRetryOptionsBySession.current,
          sessionId,
          chatTurnInputKey({ text, attachments }),
          {
            contextMentions,
            model,
          },
        )
        try {
          await send(sessionId, text, attachments, { contextMentions, model })
        } catch (error) {
          if (bridgeEmptySend) {
            setPendingChatTransition(null)
          }
          throw error
        }
        return true
      } finally {
        sendInFlightRef.current = false
      }
    },
    [activeSession, activeSessionId, create, messages, messagesLoaded, refreshGeneratedTitle, send],
  )

  const handleSend = React.useCallback(
    async (
      text: string,
      attachments: ChatAttachment[] = [],
      contextMentions: ChatContextMention[] = [],
      model?: ModelChoice,
    ): Promise<boolean> => {
      const draftKey = activeSessionId ?? NEW_SESSION_COMPOSER_DRAFT_KEY
      if (activeSessionId && (isSessionRunning(activeSessionId) || sendInFlightRef.current)) {
        const queuedMessage = createQueuedChatMessage(activeSessionId, text, attachments, contextMentions, model)
        setQueuedMessagesBySession((current) => appendQueuedMessage(current, queuedMessage))
        clearComposerDraft(draftKey)
        return true
      }
      const accepted = await sendNow(text, attachments, contextMentions, model)
      if (accepted) {
        clearComposerDraft(draftKey)
      }
      return accepted
    },
    [activeSessionId, clearComposerDraft, isSessionRunning, sendNow],
  )

  React.useEffect(() => {
    if (!activeSessionId || !shouldDispatchQueuedMessage(status, initialSendPending)) {
      return
    }
    if (dispatchingQueuedSessionsRef.current.has(activeSessionId)) {
      return
    }
    if (sendInFlightRef.current) {
      return
    }
    const queue = queuedMessagesBySession[activeSessionId] ?? []
    if (queue.length === 0) {
      return
    }
    const consumed = consumeNextQueuedMessage(queuedMessagesBySession, activeSessionId)
    const { message } = consumed
    if (!message) {
      return
    }
    dispatchingQueuedSessionsRef.current.add(activeSessionId)
    setQueuedMessagesBySession(consumed.queues)
    void sendNow(message.text, message.attachments, message.contextMentions ?? [], message.model)
      .then((accepted) => {
        if (!accepted) {
          setQueuedMessagesBySession((current) => appendQueuedMessage(current, message))
        }
      })
      .catch((cause: unknown) => {
        setQueuedMessagesBySession((current) => appendQueuedMessage(current, message))
        console.error("[lumo] dispatch queued message failed", cause)
      })
      .finally(() => {
        dispatchingQueuedSessionsRef.current.delete(activeSessionId)
      })
  }, [activeSessionId, initialSendPending, queuedMessagesBySession, sendNow, status])

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
      clearComposerDraft(session.id)
    } catch (cause) {
      const notice = resolveUserFacingError(cause, { area: "session" })
      toast.error(userFacingErrorDescription(notice, t))
      return
    } finally {
      setArchiveConfirming(false)
    }
    if (activeSessionId === session.id) {
      setActiveSessionId(nextActiveSessionIdAfterArchive(sessions, session.id))
      setIsDraftSession(false)
      setPendingChatTransition(null)
      setRoute("chat")
    }
    setArchiveSessionId(null)
  }

  const handleAuthorize = React.useCallback(
    (auth: AuthorizationInfo, source?: ChatTurnRetrySource): void => {
      // R5 闭环：打开连接页并定位该 provider；记录原 action，待用户完成授权后自动重试。
      setRoute("connections")
      setSelectedService(auth.service)
      if (activeSessionId && source && (source.text || source.attachments.length > 0)) {
        const retryKey = chatTurnInputKey(source)
        const storedOptions = turnRetryOptionsBySession.current.get(activeSessionId)?.get(retryKey)
        pendingRetry.current = {
          sessionId: activeSessionId,
          service: auth.service,
          text: source.text,
          attachments: source.attachments,
          contextMentions: storedOptions?.contextMentions ?? lastContextMentionsBySession.current.get(activeSessionId),
          model: storedOptions?.model ?? lastModelBySession.current.get(activeSessionId),
        }
      }
    },
    [activeSessionId],
  )
  const handleToggleSidebar = React.useCallback((): void => {
    setSidebarCollapsed((collapsed) => {
      if (collapsed) {
        setIsSidebarRestoring(true)
      }
      return !collapsed
    })
  }, [])
  const handleSidebarResizeStart = (event: React.PointerEvent<HTMLDivElement>): void => {
    if (sidebarCollapsed) {
      return
    }
    event.preventDefault()
    sidebarResizeStart.current = { pointerX: event.clientX, width: sidebarWidth }
    setIsSidebarResizing(true)
  }
  const handleSidebarResizeKeyDown = (event: React.KeyboardEvent<HTMLDivElement>): void => {
    if (sidebarCollapsed) {
      return
    }

    const step = event.shiftKey ? 24 : 12
    if (event.key === "ArrowLeft") {
      event.preventDefault()
      setSidebarWidth((width) => clampSidebarWidth(width - step))
    } else if (event.key === "ArrowRight") {
      event.preventDefault()
      setSidebarWidth((width) => clampSidebarWidth(width + step))
    } else if (event.key === "Home") {
      event.preventDefault()
      setSidebarWidth(SIDEBAR_MIN_WIDTH_PX)
    } else if (event.key === "End") {
      event.preventDefault()
      setSidebarWidth(SIDEBAR_MAX_WIDTH_PX)
    }
  }
  const handleArtifactsPanelResizeStart = (event: React.PointerEvent<HTMLDivElement>): void => {
    if (!artifactsPanelVisible) {
      return
    }
    event.preventDefault()
    event.currentTarget.setPointerCapture(event.pointerId)
    const dragStartWidth = visibleArtifactsPanelWidth
    const frozenContentWidth = Math.max(
      dragStartWidth,
      Number.isFinite(artifactsPanelMaxWidthValue) ? artifactsPanelMaxWidthValue : dragStartWidth,
    )
    applyArtifactsPanelShellWidth(dragStartWidth)
    freezeArtifactsPanelContentWidth(frozenContentWidth)
    artifactsPanelResizeStart.current = { pointerX: event.clientX, width: dragStartWidth }
    setIsArtifactsPanelResizing(true)
  }
  const handleArtifactsPanelResizeKeyDown = (event: React.KeyboardEvent<HTMLDivElement>): void => {
    if (!artifactsPanelVisible) {
      return
    }

    const step = event.shiftKey ? 24 : 12
    if (event.key === "ArrowLeft") {
      event.preventDefault()
      setArtifactsPanelWidth((width) => clampArtifactsPanelWidthToLayout(width + step))
    } else if (event.key === "ArrowRight") {
      event.preventDefault()
      setArtifactsPanelWidth((width) => clampArtifactsPanelWidthToLayout(width - step))
    } else if (event.key === "Home") {
      event.preventDefault()
      setArtifactsPanelWidth(ARTIFACTS_PANEL_MIN_WIDTH_PX)
    }
  }
  const handleOpenSearch = React.useCallback((): void => setSearchOpen(true), [])
  const handleRenameSession = (sessionId: string, title: string): void => {
    autoFallbackTitleBySession.current.delete(sessionId)
    void rename(sessionId, title).catch((cause: unknown) => {
      console.error("[lumo] rename session failed", cause)
      toast.error(t("session.renameFailed"))
    })
  }
  const handleArtifactsReset = React.useCallback(() => {
    setArtifactSelection(null)
    setArtifactsPanelOpen(false)
  }, [])
  const handleArtifactsOpen = React.useCallback((selection: ArtifactSelection) => {
    setArtifactSelection(selection)
    setArtifactsPanelOpen(true)
  }, [])
  const handleArtifactsAvailable = React.useCallback((selection: ArtifactSelection) => {
    setArtifactSelection((current) => (current?.messageId === selection.messageId ? current : selection))
  }, [])
  const handleChatStop = React.useCallback(() => {
    if (activeSessionId) {
      void stop(activeSessionId)
    }
  }, [activeSessionId, stop])
  const runAppCommand = React.useCallback(
    (command: AppCommand): void => {
      switch (command) {
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
          handleChatStop()
          return
        case APP_COMMANDS.toggleSidebar:
          handleToggleSidebar()
          return
      }
    },
    [handleChatStop, handleNewSession, handleOpenSearch, handleToggleSidebar, requestComposerFocus],
  )
  useAppCommandEvents(runAppCommand)
  useAppCommandShortcuts(runAppCommand)

  const handleQueuedMessageRemove = React.useCallback(
    (messageId: string) => {
      if (!activeSessionId) {
        return
      }
      setQueuedMessagesBySession((current) => removeQueuedMessage(current, activeSessionId, messageId))
    },
    [activeSessionId],
  )
  const handleViewBilling = React.useCallback(() => {
    setRoute("billing")
  }, [])
  const hasArtifactSelection = artifactSelection !== null
  const artifactsPanelVisible = route === "chat" && artifactsPanelOpen && hasArtifactSelection
  const visibleArtifactsPanelWidth = clampArtifactsPanelWidthToLayout(artifactsPanelWidth)
  const showArtifactsToggle = route === "chat" && hasArtifactSelection && !artifactsPanelVisible
  const ArtifactsToggleIcon = artifactsPanelOpen ? PanelRightClose : PanelRightOpen
  const artifactsToggleLabel = artifactsPanelOpen ? t("artifacts.collapse") : t("artifacts.expand")
  const billingCacheScope = auth.state?.account?.id ?? "authenticated"
  const newChatShortcut = appCommandShortcutLabel(APP_COMMANDS.newChat)
  const newChatLabel = labelWithShortcut(t("sidebar.newSession"), newChatShortcut)

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
        <BillingRoute cacheScope={billingCacheScope} onBack={() => setRoute("chat")} />
      </React.Suspense>
    )
  }

  if (route === "archived") {
    return (
      <React.Suspense fallback={<RouteLoadingFallback />}>
        <ArchivedRoute
          listArchived={listArchived}
          onBack={() => setRoute("chat")}
          onOpenSession={(sessionId) => {
            setActiveSessionId(sessionId)
            setIsDraftSession(false)
            setPendingChatTransition(null)
            setRoute("chat")
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
      {/* 左：会话导航栏 */}
      <aside className="oo-sidebar oo-border-divider relative z-20 flex min-h-0 flex-col border-r">
        <header
          data-slot="sidebar-chrome-header"
          className="oo-sidebar-chrome-header relative flex h-[var(--app-titlebar-height)] items-center justify-between gap-3 [-webkit-app-region:drag]"
        >
          <div className="oo-sidebar-chrome-brand min-w-0 items-center gap-2">
            <BrandIcon className="size-6" />
          </div>
          <div className="oo-sidebar-titlebar-actions-expanded ml-auto">
            <SidebarTitlebarActions
              collapsed={sidebarCollapsed}
              onToggleCollapsed={handleToggleSidebar}
              onSearch={handleOpenSearch}
            />
          </div>
        </header>

        <div className="oo-sidebar-content flex min-h-0 flex-1 flex-col">
          <nav aria-label="primary" className="grid gap-1 px-3 pt-0 pb-3 [-webkit-app-region:no-drag]">
            <button
              type="button"
              onClick={handleNewSession}
              title={newChatLabel}
              aria-label={newChatLabel}
              aria-keyshortcuts={appCommandAriaShortcut(APP_COMMANDS.newChat)}
              className={cn(
                "oo-sidebar-nav-item oo-text-control flex h-[var(--sidebar-item-height)] items-center gap-2 rounded-md px-2",
                route === "chat" && !activeSessionId && "bg-sidebar-accent text-sidebar-accent-foreground",
              )}
            >
              <SquarePen className="size-4 shrink-0" />
              <span className="oo-sidebar-nav-label truncate">{t("sidebar.newSession")}</span>
            </button>
            <button
              type="button"
              onClick={() => setRoute("connections")}
              className={cn(
                "oo-sidebar-nav-item oo-text-control flex h-[var(--sidebar-item-height)] items-center gap-2 rounded-md px-2",
                route === "connections" && "bg-sidebar-accent text-sidebar-accent-foreground",
              )}
            >
              <Plug className="size-4 shrink-0" />
              <span className="oo-sidebar-nav-label truncate">{t("connections.title")}</span>
            </button>
            <button
              type="button"
              onClick={() => setRoute("skills")}
              className={cn(
                "oo-sidebar-nav-item oo-text-control flex h-[var(--sidebar-item-height)] items-center gap-2 rounded-md px-2",
                route === "skills" && "bg-sidebar-accent text-sidebar-accent-foreground",
              )}
            >
              <Package className="size-4 shrink-0" />
              <span className="oo-sidebar-nav-label truncate">{t("skills.title")}</span>
            </button>
            <button
              type="button"
              onClick={() => setRoute("organizations")}
              className={cn(
                "oo-sidebar-nav-item oo-text-control flex h-[var(--sidebar-item-height)] items-center gap-2 rounded-md px-2",
                route === "organizations" && "bg-sidebar-accent text-sidebar-accent-foreground",
              )}
            >
              <Building2 className="size-4 shrink-0" />
              <span className="oo-sidebar-nav-label truncate">{t("organizations.title")}</span>
            </button>
          </nav>

          <nav className="flex min-h-0 flex-1 flex-col px-3 [-webkit-app-region:no-drag]">
            <div className="oo-sidebar-session-scroll -mx-3 min-h-0 flex-1 overflow-y-auto px-3 pb-2">
              {sessionsError ? (
                <ErrorNotice error={sessionsError} compact className="mx-0" />
              ) : sessions.length > 0 ? (
                <div className="grid gap-3">
                  {sidebarSessionGroups.pinned.length > 0 ? (
                    <div className="grid gap-0.5">
                      <div className="oo-sidebar-section-heading oo-text-caption px-3 pt-1 pb-2">
                        {t("sidebar.pinned")}
                      </div>
                      {sidebarSessionGroups.pinned.map((session) => (
                        <SessionItem
                          key={session.id}
                          session={session}
                          active={route === "chat" && activeSessionId === session.id}
                          running={isSessionRunning(session.id)}
                          unread={hasUnreadSession(session.id)}
                          now={relativeTimeNow}
                          onSelect={() => {
                            setActiveSessionId(session.id)
                            setIsDraftSession(false)
                            setRoute("chat")
                          }}
                          onRenameRequest={() => setRenameSessionId(session.id)}
                          onPinToggle={() => void handlePinSession(session)}
                          onArchive={() => handleArchiveSessionRequest(session)}
                        />
                      ))}
                    </div>
                  ) : null}
                  {sidebarSessionGroups.regular.length > 0 ? (
                    <div className="grid gap-0.5">
                      <div className="oo-sidebar-section-heading oo-text-caption px-3 pt-1 pb-2">
                        {t("sidebar.tasks")}
                      </div>
                      {sidebarSessionGroups.regular.map((session) => (
                        <SessionItem
                          key={session.id}
                          session={session}
                          active={route === "chat" && activeSessionId === session.id}
                          running={isSessionRunning(session.id)}
                          unread={hasUnreadSession(session.id)}
                          now={relativeTimeNow}
                          onSelect={() => {
                            setActiveSessionId(session.id)
                            setIsDraftSession(false)
                            setRoute("chat")
                          }}
                          onRenameRequest={() => setRenameSessionId(session.id)}
                          onPinToggle={() => void handlePinSession(session)}
                          onArchive={() => handleArchiveSessionRequest(session)}
                        />
                      ))}
                    </div>
                  ) : null}
                </div>
              ) : (
                <SidebarEmptyState />
              )}
            </div>

            <SidebarFooterControls
              accountName={auth.state?.account?.name}
              avatarUrl={auth.state?.account?.avatarUrl}
              activeRoute={route}
              loggingOut={auth.loggingOut}
              workspace={organizationWorkspace}
              onNavigate={setRoute}
              onLogout={() => void auth.logout()}
            />
          </nav>
        </div>
        <div
          role="separator"
          aria-orientation="vertical"
          aria-label={t("aria.resizeSidebar")}
          aria-valuemin={SIDEBAR_MIN_WIDTH_PX}
          aria-valuemax={SIDEBAR_MAX_WIDTH_PX}
          aria-valuenow={sidebarWidth}
          title={t("aria.resizeSidebar")}
          tabIndex={sidebarCollapsed ? -1 : 0}
          className="oo-sidebar-resize-handle"
          onPointerDown={handleSidebarResizeStart}
          onKeyDown={handleSidebarResizeKeyDown}
        />
      </aside>

      {/* 右：主区（顶部工具条 + 内容） */}
      <div className="flex min-h-0">
        <div className="grid min-w-0 flex-1 grid-rows-[var(--app-titlebar-height)_minmax(0,1fr)]">
          <header className="oo-titlebar oo-toolbar oo-main-titlebar oo-border-divider flex h-[var(--app-titlebar-height)] items-center border-b [-webkit-app-region:drag]">
            <div className="oo-titlebar-collapsed-controls shrink-0 items-center gap-3">
              <div className="oo-titlebar-control-spacer shrink-0" />
              <SidebarTitlebarActions
                collapsed={sidebarCollapsed}
                onToggleCollapsed={handleToggleSidebar}
                onSearch={handleOpenSearch}
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
                    handleRenameSession(activeSession.id, title)
                  }
                }}
              />
            </div>
            <div className="ml-auto flex shrink-0 items-center gap-1 [-webkit-app-region:no-drag]">
              <AppUpdateTitlebarEntry />
              <BillingUsagePopover cacheScope={billingCacheScope} onViewDetails={() => setRoute("billing")} />
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
                  onClick={() => setArtifactsPanelOpen((open) => !open)}
                >
                  <ArtifactsToggleIcon className="size-4" />
                </button>
              ) : null}
            </div>
          </header>

          <main className="oo-content-surface min-h-0">
            <React.Suspense fallback={<RouteLoadingFallback />}>
              {route === "connections" ? (
                <div className="h-full min-h-0 p-0">
                  <ConnectionsPanel connections={connections} selectedService={selectedService} />
                </div>
              ) : route === "skills" ? (
                <SkillsRoute />
              ) : route === "organizations" ? (
                <OrganizationManagementRoute workspace={organizationWorkspace} />
              ) : (
                <div className="h-full min-h-0 overflow-hidden">
                  <ChatArea
                    billingCacheScope={billingCacheScope}
                    composerDraftKey={activeComposerDraftKey}
                    messages={bridgeInitialSendPending ? [] : messages}
                    status={displayedStatus}
                    activity={bridgeInitialSendPending ? null : activity}
                    showEmptyState={showChatEmptyState}
                    bootstrapping={chatBootstrapping}
                    startupError={startupError}
                    error={error}
                    submitDisabled={!ready || chatBootstrapping}
                    initialComposerState={initialComposerState}
                    initialSendPending={initialSendPending}
                    composerFocusRequest={composerFocusRequest}
                    providers={activeProviders}
                    queuedMessages={activeQueuedMessages}
                    placeholder={
                      startupError
                        ? t("error.agent.title")
                        : ready
                          ? t("chat.inputPlaceholder")
                          : t("chat.agentStarting")
                    }
                    onComposerStateChange={handleComposerStateChange}
                    onSend={handleSend}
                    onStop={handleChatStop}
                    onQueuedMessageRemove={handleQueuedMessageRemove}
                    onAuthorize={handleAuthorize}
                    onArtifactsReset={handleArtifactsReset}
                    onArtifactsOpen={handleArtifactsOpen}
                    onArtifactsAvailable={handleArtifactsAvailable}
                    onViewBilling={handleViewBilling}
                  />
                </div>
              )}
            </React.Suspense>
          </main>
        </div>

        <div
          ref={artifactsPanelShellRef}
          className={cn(
            "oo-artifacts-panel-shell relative min-h-0 shrink-0 overflow-hidden",
            isArtifactsPanelResizing ? "transition-none" : "transition-[width,opacity,transform] duration-200 ease-out",
            artifactsPanelVisible ? "translate-x-0 opacity-100" : "pointer-events-none translate-x-3 opacity-0",
          )}
          style={{ width: artifactsPanelVisible ? `${visibleArtifactsPanelWidth}px` : "0px" }}
        >
          <div
            role="separator"
            aria-orientation="vertical"
            aria-label={t("aria.resizeArtifactsPanel")}
            aria-valuemin={ARTIFACTS_PANEL_MIN_WIDTH_PX}
            aria-valuemax={artifactsPanelMaxWidthState ?? undefined}
            aria-valuenow={visibleArtifactsPanelWidth}
            title={t("aria.resizeArtifactsPanel")}
            tabIndex={artifactsPanelVisible ? 0 : -1}
            className="oo-artifacts-panel-resize-handle"
            onPointerDown={handleArtifactsPanelResizeStart}
            onKeyDown={handleArtifactsPanelResizeKeyDown}
          />
          <div ref={artifactsPanelContentRef} className="h-full w-full min-w-0">
            {artifactsPanelVisible ? (
              <React.Suspense fallback={null}>
                <ArtifactsPanel selection={artifactSelection} onCollapse={() => setArtifactsPanelOpen(false)} />
              </React.Suspense>
            ) : null}
          </div>
        </div>
      </div>

      <SessionSearchOverlay
        sessions={sessions}
        open={searchOpen}
        onClose={() => setSearchOpen(false)}
        onSelect={(session) => {
          setActiveSessionId(session.id)
          setIsDraftSession(false)
          setPendingChatTransition(null)
          setRoute("chat")
          setSearchOpen(false)
        }}
      />
      <RenameSessionDialog
        session={renameSession}
        open={Boolean(renameSession)}
        onClose={() => setRenameSessionId(null)}
        onRename={handleRenameSession}
      />
      <ArchiveSessionDialog
        confirming={archiveConfirming}
        open={Boolean(archiveSession)}
        onClose={() => setArchiveSessionId(null)}
        onConfirm={() => {
          if (archiveSession) {
            void handleArchiveSession(archiveSession)
          }
        }}
      />
    </div>
  )
}
