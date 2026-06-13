import type { AuthorizationInfo, ChatMessage } from "../../../electron/chat/common"
import type { SessionInfo } from "../../../electron/session/common"
import type { ChatStatus } from "ai"

import { Plug, Settings, SquarePen, Trash2 } from "lucide-react"
import * as React from "react"
import { buildSessionTitle } from "@/components/app-shell/session-title"
import { useChatService } from "@/components/AppContext"
import { useChat } from "@/hooks/useChat"
import { useConnections } from "@/hooks/useConnections"
import { useSessions } from "@/hooks/useSessions"
import { useT } from "@/i18n/i18n"
import { cn } from "@/lib/utils"
import { ChatArea } from "@/routes/Chat"
import { ConnectionsPanel } from "@/routes/Connections"
import { SettingsRoute } from "@/routes/Settings"

type Route = "chat" | "connections" | "settings"

interface PendingChatTransition {
  sessionId: string | null
  text: string
  createdAt: number
}

function initialRoute(): Route {
  const route = (import.meta.env as Record<string, string | undefined>)["VITE_LUMO_ROUTE"]
  return route === "settings" || route === "connections" ? route : "chat"
}

function chatMessageText(message: ChatMessage): string {
  return message.parts
    .filter((part) => part.kind === "text")
    .map((part) => part.text ?? "")
    .join("")
}

function hasUserMessage(messages: ChatMessage[], text: string): boolean {
  return messages.some((message) => message.role === "user" && chatMessageText(message) === text)
}

function SessionItem({
  session,
  active,
  onSelect,
  onRename,
  onDelete,
}: {
  session: SessionInfo
  active: boolean
  onSelect: () => void
  onRename: (title: string) => void
  onDelete: () => void
}) {
  const t = useT()
  const [editing, setEditing] = React.useState(false)
  const [draft, setDraft] = React.useState(session.title)

  if (editing) {
    return (
      <input
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
        className="oo-input-surface oo-text-control h-8 rounded-md border px-3 outline-none"
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
        className="min-w-0 flex-1 text-left"
      >
        <span className="oo-sidebar-nav-label truncate">{session.title}</span>
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

export function AppShell() {
  const t = useT()
  const chatService = useChatService()
  const { sessions, create, rename, remove, refresh } = useSessions()
  const [route, setRoute] = React.useState<Route>(initialRoute)
  const [activeSessionId, setActiveSessionId] = React.useState<string | null>(null)
  const [isDraftSession, setIsDraftSession] = React.useState(false)
  const [pendingChatTransition, setPendingChatTransition] = React.useState<PendingChatTransition | null>(null)
  const [ready, setReady] = React.useState(false)

  const { messages, status, messagesLoaded, error, send, stop } = useChat(activeSessionId)
  const connections = useConnections()
  const [selectedService, setSelectedService] = React.useState<string | null>(null)
  // 聊天内"去授权"后待重试的原 action：provider 连上后自动重发。
  const pendingRetry = React.useRef<{ sessionId: string; service: string; text: string } | null>(null)

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
    const connected = connections.summary?.providers.some((p) => p.service === pending.service && p.connected)
    if (connected) {
      pendingRetry.current = null
      setSelectedService(null)
      setRoute("chat")
      void send(pending.sessionId, pending.text)
    }
  }, [connections.summary, send])

  const activeSession = sessions.find((s) => s.id === activeSessionId)
  const pendingCaughtUp = Boolean(
    pendingChatTransition?.sessionId &&
    activeSessionId === pendingChatTransition.sessionId &&
    hasUserMessage(messages, pendingChatTransition.text),
  )
  const initialSendPending = Boolean(pendingChatTransition && !pendingCaughtUp)
  const displayedStatus: ChatStatus = initialSendPending ? "submitted" : status
  const showChatEmptyState = (!activeSessionId && !pendingChatTransition) || initialSendPending

  React.useEffect(() => {
    if (pendingCaughtUp) {
      setPendingChatTransition(null)
    }
  }, [pendingCaughtUp])

  React.useEffect(() => {
    if (pendingChatTransition && status === "error") {
      setPendingChatTransition(null)
    }
  }, [pendingChatTransition, status])

  const handleNewSession = (): void => {
    setActiveSessionId(null)
    setIsDraftSession(true)
    setPendingChatTransition(null)
    setRoute("chat")
  }

  const handleSend = async (text: string): Promise<void> => {
    setRoute("chat")
    let sessionId = activeSessionId
    const bridgeEmptySend = messagesLoaded && messages.length === 0
    const createdAt = Date.now()
    if (bridgeEmptySend) {
      setPendingChatTransition({ sessionId, text, createdAt })
    }
    if (!sessionId) {
      let info: SessionInfo
      try {
        info = await create(buildSessionTitle(text))
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
    try {
      await send(sessionId, text, { optimistic: bridgeEmptySend ? "after-ack" : "before-ack" })
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
    if (activeSessionId && text) {
      pendingRetry.current = { sessionId: activeSessionId, service: auth.service, text }
    }
  }

  return (
    <div className="oo-app-chrome grid h-full text-foreground">
      {/* 左：会话导航栏 */}
      <aside className="oo-sidebar oo-border-divider flex min-h-0 flex-col border-r">
        <header
          data-slot="sidebar-chrome-header"
          className="relative h-[var(--app-titlebar-height)] [-webkit-app-region:drag]"
          style={{ paddingLeft: "var(--traffic-light-space)", paddingRight: "12px" }}
        />

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

          <div className="grid shrink-0 gap-1 pb-3">
            <button
              type="button"
              onClick={() => setRoute("settings")}
              className={cn(
                "oo-sidebar-nav-item oo-text-control flex h-[var(--sidebar-item-height)] items-center gap-2 rounded-md px-2",
                route === "settings" && "bg-sidebar-accent text-sidebar-accent-foreground",
              )}
            >
              <Settings className="size-4 shrink-0" />
              <span className="oo-sidebar-nav-label truncate">{t("nav.settings")}</span>
            </button>
          </div>
        </nav>
      </aside>

      {/* 右：主区（顶部工具条 + 内容） */}
      <div className="grid min-h-0 grid-rows-[var(--app-titlebar-height)_minmax(0,1fr)]">
        <header className="oo-toolbar oo-border-divider flex h-[var(--app-titlebar-height)] items-center border-b px-4 [-webkit-app-region:drag]">
          <div className="flex min-w-0 items-center gap-2">
            <span className="oo-toolbar-title oo-text-title truncate">
              {route === "settings"
                ? t("settings.title")
                : route === "connections"
                  ? t("connections.title")
                  : (activeSession?.title ?? t("chat.newSession"))}
            </span>
          </div>
        </header>

        <main className="oo-content-surface min-h-0">
          {route === "settings" ? (
            <SettingsRoute />
          ) : route === "connections" ? (
            <div className="h-full min-h-0 px-4 py-3">
              <ConnectionsPanel connections={connections} selectedService={selectedService} />
            </div>
          ) : (
            <div className="h-full min-h-0 overflow-hidden pb-3">
              <ChatArea
                messages={initialSendPending ? [] : messages}
                status={displayedStatus}
                showEmptyState={showChatEmptyState}
                error={error}
                disabled={!ready}
                initialSendPending={initialSendPending}
                placeholder={ready ? t("chat.inputPlaceholder") : t("chat.agentStarting")}
                onSend={(text) => void handleSend(text)}
                onStop={() => activeSessionId && void stop(activeSessionId)}
                onAuthorize={handleAuthorize}
              />
            </div>
          )}
        </main>
      </div>
    </div>
  )
}
