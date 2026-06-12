import type { AuthorizationInfo } from "../../../electron/chat/common"
import type { SessionInfo } from "../../../electron/session/common"

import {
  MessageSquare,
  MessageSquarePlus,
  PanelRightClose,
  PanelRightOpen,
  Settings,
  Sparkles,
  Trash2,
} from "lucide-react"
import * as React from "react"
import { branding } from "../../../electron/branding"
import { useChatService } from "@/components/AppContext"
import { Button } from "@/components/ui/button"
import { SplitViewBody, SplitViewDesktopDetailPane, SplitViewListPane, SplitViewRoot } from "@/components/ui/split-view"
import { useChat } from "@/hooks/useChat"
import { useConnections } from "@/hooks/useConnections"
import { useSessions } from "@/hooks/useSessions"
import { useT } from "@/i18n/i18n"
import { cn } from "@/lib/utils"
import { ChatArea } from "@/routes/Chat"
import { ConnectionsPanel } from "@/routes/Connections"
import { SettingsRoute } from "@/routes/Settings"

type Route = "chat" | "settings"

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
        className="oo-input-surface oo-text-control h-[var(--sidebar-item-height)] rounded-md border px-2 outline-none"
      />
    )
  }

  return (
    <div
      className={cn(
        "oo-sidebar-nav-item group oo-text-control flex h-[var(--sidebar-item-height)] items-center gap-2 rounded-md px-2",
        active && "bg-sidebar-accent text-sidebar-accent-foreground",
      )}
    >
      <button
        type="button"
        onClick={onSelect}
        onDoubleClick={() => setEditing(true)}
        className="flex min-w-0 flex-1 items-center gap-2"
      >
        <MessageSquare className="size-4 shrink-0" />
        <span className="oo-sidebar-nav-label truncate">{session.title}</span>
      </button>
      <button
        type="button"
        aria-label={t("aria.deleteSession")}
        onClick={onDelete}
        className="hidden size-5 shrink-0 items-center justify-center rounded group-hover:flex hover:text-destructive"
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
  const [route, setRoute] = React.useState<Route>(
    (import.meta.env as Record<string, string | undefined>)["VITE_LUMO_ROUTE"] === "settings" ? "settings" : "chat",
  )
  const [activeSessionId, setActiveSessionId] = React.useState<string | null>(null)
  const [showConnections, setShowConnections] = React.useState(true)
  const [ready, setReady] = React.useState(false)

  const { messages, isGenerating, error, send, stop } = useChat(activeSessionId)
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
    if (!activeSessionId && sessions.length > 0) {
      setActiveSessionId(sessions[0].id)
    }
  }, [sessions, activeSessionId])

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
      void send(pending.sessionId, pending.text)
    }
  }, [connections.summary, send])

  const activeSession = sessions.find((s) => s.id === activeSessionId)

  const handleNewSession = async (): Promise<void> => {
    const info = await create()
    setActiveSessionId(info.id)
    setRoute("chat")
  }

  const handleSend = async (text: string): Promise<void> => {
    setRoute("chat")
    let sessionId = activeSessionId
    if (!sessionId) {
      const info = await create(text.slice(0, 40))
      sessionId = info.id
      setActiveSessionId(sessionId)
    }
    await send(sessionId, text)
  }

  const handleDelete = async (id: string): Promise<void> => {
    await remove(id)
    if (activeSessionId === id) {
      setActiveSessionId(null)
    }
  }

  const handleAuthorize = (auth: AuthorizationInfo): void => {
    // R5 闭环：展开右侧面板并定位该 provider；记录原 action，待用户在面板完成授权后自动重试。
    setShowConnections(true)
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
          className="relative flex h-[var(--app-titlebar-height)] items-center gap-2 [-webkit-app-region:drag]"
          style={{ paddingLeft: "var(--traffic-light-space)", paddingRight: "12px" }}
        >
          <Sparkles className="oo-icon-accent size-4" />
          <span className="oo-sidebar-chrome-brand oo-text-title">{branding.appName}</span>
        </header>

        <div className="px-3 pb-2 [-webkit-app-region:no-drag]">
          <Button
            variant="outline"
            size="sm"
            className="w-full justify-start gap-2"
            onClick={() => void handleNewSession()}
          >
            <MessageSquarePlus className="size-4" />
            {t("sidebar.newSession")}
          </Button>
        </div>

        <nav className="flex min-h-0 flex-1 flex-col justify-between overflow-y-auto px-3 [-webkit-app-region:no-drag]">
          <div className="grid gap-1">
            {sessions.map((session) => (
              <SessionItem
                key={session.id}
                session={session}
                active={route === "chat" && activeSessionId === session.id}
                onSelect={() => {
                  setActiveSessionId(session.id)
                  setRoute("chat")
                }}
                onRename={(title) => void rename(session.id, title)}
                onDelete={() => void handleDelete(session.id)}
              />
            ))}
            {sessions.length === 0 && <p className="oo-text-caption px-2 py-4">{t("sidebar.empty")}</p>}
          </div>

          <div className="grid gap-1 pb-3">
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
        <header className="oo-toolbar oo-border-divider flex h-[var(--app-titlebar-height)] items-center justify-between border-b px-4 [-webkit-app-region:drag]">
          <span className="oo-toolbar-title oo-text-title">
            {route === "settings" ? t("settings.title") : (activeSession?.title ?? t("chat.defaultTitle"))}
          </span>
          {route === "chat" && (
            <button
              type="button"
              aria-label={showConnections ? t("aria.collapseConnections") : t("aria.expandConnections")}
              onClick={() => setShowConnections((value) => !value)}
              className="oo-toolbar-button flex size-8 items-center justify-center rounded-md [-webkit-app-region:no-drag] hover:bg-accent"
            >
              {showConnections ? <PanelRightClose className="size-4" /> : <PanelRightOpen className="size-4" />}
            </button>
          )}
        </header>

        <main className="oo-content-surface min-h-0">
          {route === "settings" ? (
            <SettingsRoute />
          ) : (
            <SplitViewRoot narrowPane="list">
              <SplitViewBody className={cn(!showConnections && "min-[960px]:grid-cols-[minmax(0,1fr)]")}>
                <SplitViewListPane narrowPane="list" className="px-4">
                  <ChatArea
                    sessionTitle={activeSession?.title ?? ""}
                    messages={messages}
                    isGenerating={isGenerating}
                    error={error}
                    disabled={!ready}
                    placeholder={ready ? t("chat.inputPlaceholder") : t("chat.agentStarting")}
                    onSend={(text) => void handleSend(text)}
                    onStop={() => activeSessionId && void stop(activeSessionId)}
                    onAuthorize={handleAuthorize}
                  />
                </SplitViewListPane>
                {showConnections && (
                  <SplitViewDesktopDetailPane>
                    <ConnectionsPanel connections={connections} selectedService={selectedService} />
                  </SplitViewDesktopDetailPane>
                )}
              </SplitViewBody>
            </SplitViewRoot>
          )}
        </main>
      </div>
    </div>
  )
}
