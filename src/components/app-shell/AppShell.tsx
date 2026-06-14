import type { AuthorizationInfo, ChatAttachment, ChatMessage } from "../../../electron/chat/common.ts"
import type { ModelChoice } from "../../../electron/models/common.ts"
import type { SessionInfo } from "../../../electron/session/common.ts"
import type { ArtifactSelection } from "@/routes/Chat/GeneratedArtifacts"
import type { ChatStatus } from "ai"

import {
  LogOut,
  LoaderCircle,
  Package,
  PanelLeftClose,
  PanelLeftOpen,
  PanelRightClose,
  PanelRightOpen,
  Plug,
  Search,
  Settings,
  SquarePen,
  Trash2,
} from "lucide-react"
import * as React from "react"
import { buildFallbackSessionTitle, shouldAutoRefreshSessionTitle } from "../../../electron/session/title.ts"
import { formatSessionAbsoluteTime, formatSessionRelativeTime } from "@/components/app-shell/session-time"
import { useChatService } from "@/components/AppContext"
import { BrandIcon } from "@/components/BrandIcon"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Input } from "@/components/ui/input"
import { useAuth } from "@/hooks/useAuth"
import { useChat } from "@/hooks/useChat"
import { useConnections } from "@/hooks/useConnections"
import { useSessions } from "@/hooks/useSessions"
import { useI18n, useT } from "@/i18n/i18n"
import { cn } from "@/lib/utils"
import { ChatArea } from "@/routes/Chat"
import { ArtifactsPanel } from "@/routes/Chat/GeneratedArtifacts"
import { ConnectionsPanel } from "@/routes/Connections"
import { SettingsRoute } from "@/routes/Settings"
import { SkillsRoute } from "@/routes/Skills"

type Route = "chat" | "connections" | "skills" | "settings"

const SIDEBAR_RESTORE_DELAY_MS = 260
const SIDEBAR_AUTO_COLLAPSE_MAX_WIDTH_PX = 720
const SIDEBAR_DEFAULT_WIDTH_PX = 264
const SIDEBAR_MIN_WIDTH_PX = 220
const SIDEBAR_MAX_WIDTH_PX = 420
const SIDEBAR_WIDTH_STORAGE_KEY = "lumo.sidebarWidth"
const ARTIFACTS_PANEL_DEFAULT_WIDTH_PX = 300
const ARTIFACTS_PANEL_MIN_WIDTH_PX = 260
const ARTIFACTS_PANEL_MAX_WIDTH_PX = 520
const ARTIFACTS_PANEL_WIDTH_STORAGE_KEY = "lumo.artifactsPanelWidth"

interface PendingChatTransition {
  sessionId: string | null
  text: string
  attachments: ChatAttachment[]
  model?: ModelChoice
  createdAt: number
}

function initialRoute(): Route {
  const route = (import.meta.env as Record<string, string | undefined>)["VITE_LUMO_ROUTE"]
  return route === "settings" || route === "connections" || route === "skills" ? route : "chat"
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
  return Math.min(ARTIFACTS_PANEL_MAX_WIDTH_PX, Math.max(ARTIFACTS_PANEL_MIN_WIDTH_PX, width))
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
  return message.parts
    .filter((part) => part.kind === "text")
    .map((part) => part.text ?? "")
    .join("")
}

function chatMessageAttachmentPaths(message: ChatMessage): string {
  return message.parts
    .filter((part) => part.kind === "attachment" && part.attachment)
    .map((part) => part.attachment?.path ?? "")
    .sort()
    .join("\n")
}

function attachmentPaths(attachments: ChatAttachment[]): string {
  return attachments
    .map((attachment) => attachment.path)
    .sort()
    .join("\n")
}

function hasUserMessage(messages: ChatMessage[], text: string, attachments: ChatAttachment[] = []): boolean {
  const expectedAttachments = attachmentPaths(attachments)
  return messages.some(
    (message) =>
      message.role === "user" &&
      chatMessageText(message) === text &&
      chatMessageAttachmentPaths(message) === expectedAttachments,
  )
}

function normalizeSearchText(value: string): string {
  return value.trim().toLocaleLowerCase()
}

function accountInitial(name?: string): string {
  const trimmed = name?.trim()
  return trimmed ? trimmed.charAt(0).toLocaleUpperCase() : "L"
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

function SessionItem({
  session,
  active,
  running,
  now,
  onSelect,
  onRename,
  onDelete,
}: {
  session: SessionInfo
  active: boolean
  running: boolean
  now: number
  onSelect: () => void
  onRename: (title: string) => void
  onDelete: () => void
}) {
  const t = useT()
  const { locale } = useI18n()
  const [editing, setEditing] = React.useState(false)
  const [draft, setDraft] = React.useState(session.title)
  const relativeTime = formatSessionRelativeTime(session.updatedAt, now, locale)
  const absoluteTime = formatSessionAbsoluteTime(session.updatedAt, locale)

  if (editing) {
    return (
      <Input
        autoFocus
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => {
          setEditing(false)
          if (draft.trim() && draft !== session.title) {
            onRename(draft.trim())
          }
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.currentTarget.blur()
          } else if (e.key === "Escape") {
            setDraft(session.title)
            setEditing(false)
          }
        }}
        className="oo-text-control h-8"
      />
    )
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
        onDoubleClick={() => setEditing(true)}
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
            <LoaderCircle className="size-4 animate-spin" aria-hidden="true" />
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
      <button
        type="button"
        aria-label={t("aria.deleteSession")}
        onClick={onDelete}
        className="ml-1 hidden size-5 shrink-0 items-center justify-center rounded group-hover:flex hover:text-destructive"
      >
        <Trash2 className="size-3.5" />
      </button>
    </div>
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
  const [query, setQuery] = React.useState("")
  const normalizedQuery = normalizeSearchText(query)
  const filteredSessions = normalizedQuery
    ? sessions.filter((session) => normalizeSearchText(session.title).includes(normalizedQuery))
    : sessions

  React.useEffect(() => {
    if (open) {
      setQuery("")
      window.setTimeout(() => inputRef.current?.focus(), 0)
    }
  }, [open])

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
          onClose()
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
            className="h-8 min-w-0 flex-1 border-0 bg-transparent px-0 shadow-none focus-visible:ring-0"
          />
        </div>

        <p className="oo-text-control mt-4 px-3 text-muted-foreground">
          {t("sidebar.searchResults", { count: filteredSessions.length })}
        </p>
        <div className="mt-3 max-h-[min(46vh,420px)] overflow-y-auto pr-1">
          <div className="grid gap-1">
            {filteredSessions.map((session) => (
              <button
                key={session.id}
                type="button"
                onClick={() => onSelect(session)}
                title={session.title}
                className="oo-session-search-result oo-text-value flex h-10 min-w-0 items-center rounded-lg px-3 text-left"
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

  return (
    <div className="oo-sidebar-titlebar-actions flex shrink-0 items-center gap-1 [-webkit-app-region:no-drag]">
      <button
        type="button"
        title={collapsed ? t("aria.expandSidebar") : t("aria.collapseSidebar")}
        aria-label={collapsed ? t("aria.expandSidebar") : t("aria.collapseSidebar")}
        aria-pressed={collapsed}
        onClick={onToggleCollapsed}
        className="oo-sidebar-titlebar-button flex size-7 shrink-0 items-center justify-center rounded-md"
      >
        {collapsed ? <PanelLeftOpen className="size-4" /> : <PanelLeftClose className="size-4" />}
      </button>
      <button
        type="button"
        title={t("sidebar.search")}
        aria-label={t("sidebar.search")}
        onClick={onSearch}
        className="oo-sidebar-titlebar-button flex size-7 shrink-0 items-center justify-center rounded-md"
      >
        <Search className="size-4" />
      </button>
    </div>
  )
}

function SidebarAccountMenu({
  accountName,
  avatarUrl,
  activeRoute,
  loggingOut,
  onNavigate,
  onLogout,
}: {
  accountName?: string
  avatarUrl?: string
  activeRoute: Route
  loggingOut: boolean
  onNavigate: (route: Route) => void
  onLogout: () => void
}) {
  const t = useT()
  const displayName = accountName?.trim() || t("settings.account")

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className={cn(
            "oo-sidebar-account oo-sidebar-nav-item -mx-3 flex h-14 shrink-0 items-center gap-2 px-4 text-left [-webkit-app-region:no-drag]",
            activeRoute === "settings" && "bg-sidebar-accent text-sidebar-accent-foreground",
          )}
          aria-label={t("sidebar.accountMenu")}
          title={t("sidebar.accountMenu")}
        >
          <AccountAvatar name={displayName} avatarUrl={avatarUrl} />
          <div className="oo-sidebar-nav-label min-w-0 flex-1">
            <div className="oo-text-control truncate text-foreground" title={displayName}>
              {displayName}
            </div>
          </div>
          <span className="flex size-8 shrink-0 items-center justify-center rounded-md">
            <Settings className="size-4" />
          </span>
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent side="top" align="start" alignOffset={12} sideOffset={8} className="w-56">
        <DropdownMenuLabel className="truncate">{displayName}</DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => onNavigate("connections")}>
          <Plug className="size-4" />
          {t("connections.title")}
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => onNavigate("skills")}>
          <Package className="size-4" />
          {t("skills.title")}
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
  )
}

function AccountAvatar({ name, avatarUrl }: { name: string; avatarUrl?: string }) {
  const [failed, setFailed] = React.useState(false)

  React.useEffect(() => {
    setFailed(false)
  }, [avatarUrl])

  return (
    <div className="flex size-8 shrink-0 items-center justify-center overflow-hidden rounded-full bg-muted text-sm font-medium text-foreground">
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

export function AppShell() {
  const t = useT()
  const chatService = useChatService()
  const auth = useAuth()
  const { sessions, create, generateTitle, rename, remove, refresh } = useSessions()
  const [route, setRoute] = React.useState<Route>(initialRoute)
  const [activeSessionId, setActiveSessionId] = React.useState<string | null>(null)
  const [isDraftSession, setIsDraftSession] = React.useState(false)
  const [pendingChatTransition, setPendingChatTransition] = React.useState<PendingChatTransition | null>(null)
  const [ready, setReady] = React.useState(false)
  const [sidebarCollapsed, setSidebarCollapsed] = React.useState(false)
  const [isSidebarRestoring, setIsSidebarRestoring] = React.useState(false)
  const [sidebarWidth, setSidebarWidth] = React.useState(readStoredSidebarWidth)
  const [isSidebarResizing, setIsSidebarResizing] = React.useState(false)
  const [searchOpen, setSearchOpen] = React.useState(false)
  const [relativeTimeNow, setRelativeTimeNow] = React.useState(() => Date.now())
  const [artifactSelection, setArtifactSelection] = React.useState<ArtifactSelection | null>(null)
  const [artifactsPanelOpen, setArtifactsPanelOpen] = React.useState(false)
  const [artifactsPanelWidth, setArtifactsPanelWidth] = React.useState(readStoredArtifactsPanelWidth)
  const [isArtifactsPanelResizing, setIsArtifactsPanelResizing] = React.useState(false)

  const { messages, status, messagesLoaded, error, getSessionStatus, send, stop } = useChat(activeSessionId)
  const connections = useConnections()
  const [selectedService, setSelectedService] = React.useState<string | null>(null)
  // 聊天内"去授权"后待重试的原 action：provider 连上后自动重发。
  const pendingRetry = React.useRef<{
    sessionId: string
    service: string
    text: string
    attachments: ChatAttachment[]
    model?: ModelChoice
  } | null>(null)
  const sidebarResizeStart = React.useRef<{ pointerX: number; width: number } | null>(null)
  const artifactsPanelResizeStart = React.useRef<{ pointerX: number; width: number } | null>(null)
  const lastModelBySession = React.useRef<Map<string, ModelChoice | undefined>>(new Map())
  const sessionsRef = React.useRef<SessionInfo[]>([])

  React.useEffect(() => {
    sessionsRef.current = sessions
  }, [sessions])

  // 轮询 agent 就绪（sidecar 异步启动，首启需拉起 opencode + provider）。
  React.useEffect(() => {
    let cancelled = false
    const check = async (): Promise<void> => {
      try {
        const r = await chatService.invoke("isReady")
        if (cancelled) {
          return
        }
        setReady(r)
        if (!r) {
          setTimeout(() => void check(), 1500)
        }
      } catch {
        if (!cancelled) {
          setTimeout(() => void check(), 1500)
        }
      }
    }
    void check()
    return () => {
      cancelled = true
    }
  }, [chatService])

  // agent 就绪后刷新会话列表（启动期的 list 调用会被服务端忽略返回空）。
  React.useEffect(() => {
    if (ready) {
      void refresh()
    }
  }, [ready, refresh])

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

  // 默认选中最近的会话。
  React.useEffect(() => {
    if (!isDraftSession && !activeSessionId && sessions.length > 0) {
      setActiveSessionId(sessions[0].id)
    }
  }, [sessions, activeSessionId, isDraftSession])

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
      void send(pending.sessionId, pending.text, pending.attachments, { model: pending.model })
    }
  }, [connections.summary, send])

  const activeSession = sessions.find((s) => s.id === activeSessionId)
  const pendingCaughtUp = Boolean(
    pendingChatTransition?.sessionId &&
    activeSessionId === pendingChatTransition.sessionId &&
    hasUserMessage(messages, pendingChatTransition.text, pendingChatTransition.attachments),
  )
  const initialSendPending = Boolean(pendingChatTransition && !pendingCaughtUp)
  const displayedStatus: ChatStatus = initialSendPending ? "submitted" : status
  const showChatEmptyState = (!activeSessionId && !pendingChatTransition) || initialSendPending
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
      : route === "connections"
        ? t("connections.title")
        : route === "skills"
          ? t("skills.title")
          : (activeSession?.title ?? t("chat.newSession"))

  React.useEffect(() => {
    if (pendingCaughtUp) {
      setPendingChatTransition(null)
    }
  }, [pendingCaughtUp])

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

    const handlePointerMove = (event: PointerEvent): void => {
      const start = artifactsPanelResizeStart.current
      if (!start) {
        return
      }
      setArtifactsPanelWidth(clampArtifactsPanelWidth(start.width + start.pointerX - event.clientX))
    }
    const handlePointerUp = (): void => {
      artifactsPanelResizeStart.current = null
      setIsArtifactsPanelResizing(false)
    }

    window.addEventListener("pointermove", handlePointerMove)
    window.addEventListener("pointerup", handlePointerUp, { once: true })
    window.addEventListener("pointercancel", handlePointerUp, { once: true })
    return () => {
      window.removeEventListener("pointermove", handlePointerMove)
      window.removeEventListener("pointerup", handlePointerUp)
      window.removeEventListener("pointercancel", handlePointerUp)
    }
  }, [isArtifactsPanelResizing])

  const handleNewSession = (): void => {
    setActiveSessionId(null)
    setIsDraftSession(true)
    setPendingChatTransition(null)
    setRoute("chat")
  }

  const refreshGeneratedTitle = React.useCallback(
    async (
      sessionId: string,
      input: { text: string; attachmentNames?: string[] },
      allowPlaceholder: boolean,
      replaceableTitle?: string,
    ) => {
      const current = sessionsRef.current.find((session) => session.id === sessionId)
      if (
        current &&
        current.title !== replaceableTitle &&
        !shouldAutoRefreshSessionTitle(current.title, allowPlaceholder)
      ) {
        return
      }
      try {
        const title = await generateTitle(input)
        const latest = sessionsRef.current.find((session) => session.id === sessionId)
        if (
          latest &&
          latest.title !== replaceableTitle &&
          !shouldAutoRefreshSessionTitle(latest.title, allowPlaceholder)
        ) {
          return
        }
        if (title && title !== latest?.title) {
          await rename(sessionId, title)
        }
      } catch (error) {
        console.error("[lumo] generate session title failed", error)
      }
    },
    [generateTitle, rename],
  )

  React.useEffect(() => {
    if (!activeSession || !messagesLoaded || messages.length === 0) {
      return
    }
    if (!shouldAutoRefreshSessionTitle(activeSession.title, true)) {
      return
    }
    const titleInput = buildSessionTitleInput(messages, "", [])
    if (!titleInput.text && !titleInput.attachmentNames?.length) {
      return
    }
    void refreshGeneratedTitle(activeSession.id, titleInput, true, activeSession.title)
  }, [activeSession, messages, messagesLoaded, refreshGeneratedTitle])

  const handleSend = async (text: string, attachments: ChatAttachment[] = [], model?: ModelChoice): Promise<void> => {
    setRoute("chat")
    let sessionId = activeSessionId
    const titleInput = buildSessionTitleInput(messages, text, attachments)
    const fallbackTitle = buildFallbackSessionTitle(titleInput)
    const allowPlaceholderTitle =
      !sessionId || (activeSession ? shouldAutoRefreshSessionTitle(activeSession.title, true) : false)
    const shouldRefreshTitle =
      !sessionId || (activeSession ? shouldAutoRefreshSessionTitle(activeSession.title, allowPlaceholderTitle) : false)
    const bridgeEmptySend = messagesLoaded && messages.length === 0
    const createdAt = Date.now()
    if (bridgeEmptySend) {
      setPendingChatTransition({ sessionId, text, attachments, model, createdAt })
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
        !activeSessionId ? fallbackTitle : undefined,
      )
    }
    lastModelBySession.current.set(sessionId, model)
    try {
      await send(sessionId, text, attachments, { optimistic: bridgeEmptySend ? "after-ack" : "before-ack", model })
    } catch (error) {
      if (bridgeEmptySend) {
        setPendingChatTransition(null)
      }
      throw error
    }
  }

  const handleDelete = async (id: string): Promise<void> => {
    await remove(id)
    if (activeSessionId === id) {
      setActiveSessionId(null)
      setIsDraftSession(false)
      setPendingChatTransition(null)
    }
    lastModelBySession.current.delete(id)
  }

  const handleAuthorize = (auth: AuthorizationInfo): void => {
    // R5 闭环：打开连接页并定位该 provider；记录原 action，待用户完成授权后自动重试。
    setRoute("connections")
    setSelectedService(auth.service)
    const lastUser = [...messages].reverse().find((m) => m.role === "user")
    const text = (lastUser?.parts ?? [])
      .filter((p) => p.kind === "text")
      .map((p) => p.text ?? "")
      .join("")
    const attachments = (lastUser?.parts ?? [])
      .filter((p) => p.kind === "attachment" && p.attachment)
      .map((p) => p.attachment as ChatAttachment)
    if (activeSessionId && (text || attachments.length > 0)) {
      const model =
        pendingChatTransition?.sessionId === activeSessionId
          ? pendingChatTransition.model
          : lastModelBySession.current.get(activeSessionId)
      pendingRetry.current = { sessionId: activeSessionId, service: auth.service, text, attachments, model }
    }
  }
  const handleToggleSidebar = (): void => {
    if (sidebarCollapsed) {
      setIsSidebarRestoring(true)
    }
    setSidebarCollapsed((collapsed) => !collapsed)
  }
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
    artifactsPanelResizeStart.current = { pointerX: event.clientX, width: artifactsPanelWidth }
    setIsArtifactsPanelResizing(true)
  }
  const handleArtifactsPanelResizeKeyDown = (event: React.KeyboardEvent<HTMLDivElement>): void => {
    if (!artifactsPanelVisible) {
      return
    }

    const step = event.shiftKey ? 24 : 12
    if (event.key === "ArrowLeft") {
      event.preventDefault()
      setArtifactsPanelWidth((width) => clampArtifactsPanelWidth(width + step))
    } else if (event.key === "ArrowRight") {
      event.preventDefault()
      setArtifactsPanelWidth((width) => clampArtifactsPanelWidth(width - step))
    } else if (event.key === "Home") {
      event.preventDefault()
      setArtifactsPanelWidth(ARTIFACTS_PANEL_MIN_WIDTH_PX)
    } else if (event.key === "End") {
      event.preventDefault()
      setArtifactsPanelWidth(ARTIFACTS_PANEL_MAX_WIDTH_PX)
    }
  }
  const handleOpenSearch = (): void => setSearchOpen(true)
  const handleArtifactsReset = React.useCallback(() => {
    setArtifactSelection(null)
    setArtifactsPanelOpen(false)
  }, [])
  const handleArtifactsOpen = React.useCallback((selection: ArtifactSelection) => {
    setArtifactSelection(selection)
    setArtifactsPanelOpen(true)
  }, [])
  const handleArtifactsAvailable = React.useCallback((selection: ArtifactSelection) => {
    setArtifactSelection((current) => current ?? selection)
  }, [])
  const artifactsPanelVisible = route === "chat" && artifactsPanelOpen
  const showArtifactsToggle = route === "chat" && !artifactsPanelVisible
  const ArtifactsToggleIcon = artifactsPanelOpen ? PanelRightClose : PanelRightOpen
  const artifactsToggleLabel = artifactsPanelOpen ? t("artifacts.collapse") : t("artifacts.expand")

  if (route === "settings") {
    return <SettingsRoute onBack={() => setRoute("chat")} />
  }

  return (
    <div
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
          className="relative flex h-[var(--app-titlebar-height)] items-center justify-between gap-3 [-webkit-app-region:drag]"
          style={{ paddingLeft: "var(--traffic-light-space)", paddingRight: "12px" }}
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
          <nav aria-label="primary" className="grid gap-1 px-3 pb-3 [-webkit-app-region:no-drag]">
            <button
              type="button"
              onClick={handleNewSession}
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
          </nav>

          <nav className="flex min-h-0 flex-1 flex-col px-3 [-webkit-app-region:no-drag]">
            <div className="oo-text-caption shrink-0 px-3 pt-1 pb-2">{t("sidebar.tasks")}</div>
            <div className="oo-sidebar-session-scroll -mx-3 min-h-0 flex-1 overflow-y-auto px-3 pb-2">
              <div className="grid gap-0.5">
                {sessions.map((session) => (
                  <SessionItem
                    key={session.id}
                    session={session}
                    active={route === "chat" && activeSessionId === session.id}
                    running={isSessionRunning(session.id)}
                    now={relativeTimeNow}
                    onSelect={() => {
                      setActiveSessionId(session.id)
                      setIsDraftSession(false)
                      setRoute("chat")
                    }}
                    onRename={(title) => void rename(session.id, title)}
                    onDelete={() => void handleDelete(session.id)}
                  />
                ))}
                {sessions.length === 0 && <p className="oo-text-caption px-3 py-3">{t("sidebar.empty")}</p>}
              </div>
            </div>

            <SidebarAccountMenu
              accountName={auth.state?.account?.name}
              avatarUrl={auth.state?.account?.avatarUrl}
              activeRoute={route}
              loggingOut={auth.loggingOut}
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
          <header className="oo-toolbar oo-main-titlebar oo-border-divider flex h-[var(--app-titlebar-height)] items-center border-b [-webkit-app-region:drag]">
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
                "oo-main-titlebar-title flex min-w-0 items-center gap-2",
                isSidebarRestoring && "is-restoring",
              )}
            >
              <span className="oo-toolbar-title oo-text-title truncate" title={titlebarTitle}>
                {titlebarTitle}
              </span>
            </div>
            <div className="ml-auto flex shrink-0 items-center gap-1 [-webkit-app-region:no-drag]">
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
            {route === "connections" ? (
              <div className="h-full min-h-0 p-0">
                <ConnectionsPanel connections={connections} selectedService={selectedService} />
              </div>
            ) : route === "skills" ? (
              <SkillsRoute />
            ) : (
              <div className="h-full min-h-0 overflow-hidden">
                <ChatArea
                  messages={initialSendPending ? [] : messages}
                  status={displayedStatus}
                  showEmptyState={showChatEmptyState}
                  error={error}
                  disabled={!ready}
                  initialSendPending={initialSendPending}
                  providers={connections.summary?.providers ?? []}
                  placeholder={ready ? t("chat.inputPlaceholder") : t("chat.agentStarting")}
                  onSend={(text, attachments, model) => void handleSend(text, attachments, model)}
                  onStop={() => activeSessionId && void stop(activeSessionId)}
                  onAuthorize={handleAuthorize}
                  onArtifactsReset={handleArtifactsReset}
                  onArtifactsOpen={handleArtifactsOpen}
                  onArtifactsAvailable={handleArtifactsAvailable}
                />
              </div>
            )}
          </main>
        </div>

        <div
          className={cn(
            "oo-artifacts-panel-shell relative min-h-0 shrink-0 overflow-hidden transition-[width,opacity,transform] duration-200 ease-out",
            artifactsPanelVisible ? "translate-x-0 opacity-100" : "pointer-events-none translate-x-3 opacity-0",
          )}
          style={{ width: artifactsPanelVisible ? `${artifactsPanelWidth}px` : "0px" }}
        >
          <div
            role="separator"
            aria-orientation="vertical"
            aria-label={t("aria.resizeArtifactsPanel")}
            aria-valuemin={ARTIFACTS_PANEL_MIN_WIDTH_PX}
            aria-valuemax={ARTIFACTS_PANEL_MAX_WIDTH_PX}
            aria-valuenow={artifactsPanelWidth}
            title={t("aria.resizeArtifactsPanel")}
            tabIndex={artifactsPanelVisible ? 0 : -1}
            className="oo-artifacts-panel-resize-handle"
            onPointerDown={handleArtifactsPanelResizeStart}
            onKeyDown={handleArtifactsPanelResizeKeyDown}
          />
          <div className="h-full" style={{ width: `${artifactsPanelWidth}px` }}>
            <ArtifactsPanel selection={artifactSelection} onCollapse={() => setArtifactsPanelOpen(false)} />
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
    </div>
  )
}
