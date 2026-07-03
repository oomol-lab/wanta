import type { SessionInfo } from "../../../electron/session/common.ts"
import type { ArchivedSortMode } from "./archived-route-model.ts"
import type { MessageKey } from "@/i18n/i18n"
import type { UserFacingError } from "@/lib/user-facing-error"

import {
  ArchiveIcon,
  CalendarClockIcon,
  Clock3Icon,
  FolderIcon,
  MoreHorizontalIcon,
  RotateCcwIcon,
  SearchIcon,
  Trash2Icon,
} from "lucide-react"
import * as React from "react"
import { toast } from "sonner"
import { visibleArchivedSessions } from "./archived-route-model.ts"
import { ErrorNotice } from "@/components/ErrorNotice"
import { PageRouteShell } from "@/components/PageRouteShell"
import { Button } from "@/components/ui/button"
import {
  ConfirmDialog,
  ConfirmDialogAction,
  ConfirmDialogCancel,
  ConfirmDialogContent,
  ConfirmDialogDescription,
  ConfirmDialogFooter,
  ConfirmDialogHeader,
  ConfirmDialogTitle,
  ConfirmDialogTrigger,
} from "@/components/ui/confirm-dialog"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { useI18n } from "@/i18n/i18n"
import { reportRendererHandledError } from "@/lib/renderer-diagnostics"
import { resolveUserFacingError, userFacingErrorDescription } from "@/lib/user-facing-error"
import { cn } from "@/lib/utils"

interface ArchivedRouteProps {
  listArchived: () => Promise<SessionInfo[]>
  onBack: () => void
  onOpenSession: (session: SessionInfo) => void
  refreshSessions: () => Promise<void>
  removeSession: (id: string) => Promise<void>
  ready: boolean
  unarchiveSession: (id: string) => Promise<SessionInfo | null>
}

const sortOptions = [
  { icon: Clock3Icon, labelKey: "archived.sortUpdated", value: "updatedAt" },
  { icon: CalendarClockIcon, labelKey: "archived.sortCreated", value: "createdAt" },
  { icon: ArchiveIcon, labelKey: "archived.sortTitle", value: "title" },
] satisfies Array<{
  icon: React.ComponentType<{ className?: string }>
  labelKey: MessageKey
  value: ArchivedSortMode
}>

export function ArchivedRoute({
  listArchived,
  onBack,
  onOpenSession,
  refreshSessions,
  removeSession,
  ready,
  unarchiveSession,
}: ArchivedRouteProps) {
  const { locale, t } = useI18n()
  const [sessions, setSessions] = React.useState<SessionInfo[]>([])
  const [query, setQuery] = React.useState("")
  const [sortMode, setSortMode] = React.useState<ArchivedSortMode>("updatedAt")
  const [loaded, setLoaded] = React.useState(false)
  const [error, setError] = React.useState<UserFacingError | null>(null)
  const [pendingSessionId, setPendingSessionId] = React.useState<string | null>(null)
  const [deletingAll, setDeletingAll] = React.useState(false)
  const visibleSessions = React.useMemo(
    () => visibleArchivedSessions(sessions, query, sortMode),
    [query, sessions, sortMode],
  )
  const canDeleteAll = sessions.length > 0 && !deletingAll

  const refreshArchived = React.useCallback(async () => {
    if (!ready) {
      setLoaded(false)
      return
    }
    try {
      const nextSessions = await listArchived()
      setSessions(nextSessions)
      setError(null)
    } catch (cause) {
      console.error("[wanta] list archived sessions failed", cause)
      reportRendererHandledError("archived.refresh", "Failed to refresh archived sessions", cause)
      setError(resolveUserFacingError(cause, { area: "session" }))
    } finally {
      setLoaded(true)
    }
  }, [listArchived, ready])

  React.useEffect(() => {
    if (!ready) {
      setLoaded(false)
      return
    }
    let cancelled = false
    setLoaded(false)
    void listArchived()
      .then((nextSessions) => {
        if (!cancelled) {
          setSessions(nextSessions)
          setError(null)
        }
      })
      .catch((cause: unknown) => {
        if (!cancelled) {
          console.error("[wanta] list archived sessions failed", cause)
          reportRendererHandledError("archived.initialLoad", "Failed to load archived sessions", cause)
          setError(resolveUserFacingError(cause, { area: "session" }))
        }
      })
      .finally(() => {
        if (!cancelled) {
          setLoaded(true)
        }
      })
    return () => {
      cancelled = true
    }
  }, [listArchived, ready])

  const runSessionAction = async (sessionId: string, action: () => Promise<void>): Promise<boolean> => {
    setPendingSessionId(sessionId)
    try {
      await action()
      await Promise.all([refreshArchived(), refreshSessions()])
      return true
    } catch (cause) {
      const notice = resolveUserFacingError(cause, { area: "session" })
      toast.error(userFacingErrorDescription(notice, t))
      return false
    } finally {
      setPendingSessionId(null)
    }
  }

  const restoreSession = async (session: SessionInfo): Promise<SessionInfo | null> => {
    setPendingSessionId(session.id)
    try {
      const restored = await unarchiveSession(session.id)
      await Promise.all([refreshArchived(), refreshSessions()])
      return restored
    } catch (cause) {
      const notice = resolveUserFacingError(cause, { area: "session" })
      toast.error(userFacingErrorDescription(notice, t))
      return null
    } finally {
      setPendingSessionId(null)
    }
  }

  const handleOpen = async (session: SessionInfo): Promise<void> => {
    const restored = await restoreSession(session)
    if (restored) {
      onOpenSession(restored)
    }
  }

  const handleRestore = async (session: SessionInfo): Promise<void> => {
    const restored = await restoreSession(session)
    if (restored) {
      toast.success(t("archived.restoredToast"))
    }
  }

  const handleDelete = async (session: SessionInfo): Promise<void> => {
    const removed = await runSessionAction(session.id, () => removeSession(session.id))
    if (removed) {
      toast.success(t("archived.deletedToast"))
    }
  }

  const handleDeleteAll = async (): Promise<void> => {
    if (!canDeleteAll) {
      return
    }
    setDeletingAll(true)
    try {
      await Promise.all(sessions.map((session) => removeSession(session.id)))
      await Promise.all([refreshArchived(), refreshSessions()])
      toast.success(t("archived.deletedAllToast"))
    } catch (cause) {
      const notice = resolveUserFacingError(cause, { area: "session" })
      toast.error(userFacingErrorDescription(notice, t))
    } finally {
      setDeletingAll(false)
    }
  }

  return (
    <PageRouteShell backLabel={t("archived.backToChat")} contentClassName="max-w-[82rem] gap-5" onBack={onBack}>
      <div className="flex min-w-0 items-center justify-between gap-4">
        <h1 className="oo-text-page-title min-w-0 truncate">{t("archived.title")}</h1>
        <ConfirmDialog>
          <ConfirmDialogTrigger asChild>
            <Button
              type="button"
              variant="outline"
              className="border-destructive/15 bg-destructive/8 text-destructive hover:bg-destructive/12 hover:text-destructive"
              disabled={!canDeleteAll}
            >
              <Trash2Icon className="size-4" />
              {t("archived.deleteAll")}
            </Button>
          </ConfirmDialogTrigger>
          <ConfirmDialogContent>
            <ConfirmDialogHeader>
              <ConfirmDialogTitle>{t("archived.deleteAllConfirmTitle")}</ConfirmDialogTitle>
              <ConfirmDialogDescription>{t("archived.deleteAllConfirmDescription")}</ConfirmDialogDescription>
            </ConfirmDialogHeader>
            <ConfirmDialogFooter>
              <ConfirmDialogCancel disabled={deletingAll}>{t("common.cancel")}</ConfirmDialogCancel>
              <ConfirmDialogAction disabled={deletingAll} onClick={() => void handleDeleteAll()}>
                {deletingAll ? t("archived.deleting") : t("archived.deleteAll")}
              </ConfirmDialogAction>
            </ConfirmDialogFooter>
          </ConfirmDialogContent>
        </ConfirmDialog>
      </div>

      <section className="overflow-hidden rounded-md border border-[var(--oo-divider)] bg-background">
        <div className="grid grid-cols-[minmax(16rem,1fr)_auto] gap-3 border-b border-[var(--oo-divider)] p-3 max-[760px]:grid-cols-1">
          <div className="flex h-10 min-w-0 items-center gap-2 rounded-md bg-muted/70 px-3">
            <SearchIcon className="size-4 shrink-0 text-muted-foreground" />
            <Input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={t("archived.searchPlaceholder")}
              aria-label={t("archived.searchPlaceholder")}
              className="h-8 min-w-0 flex-1 border-0 bg-transparent px-0 shadow-none focus-visible:ring-0"
            />
          </div>
          <Select value={sortMode} onValueChange={(value) => setSortMode(value as ArchivedSortMode)}>
            <SelectTrigger
              className="h-10 min-w-48 bg-muted/70 max-[760px]:w-full"
              aria-label={t("archived.sortLabel")}
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent align="end">
              {sortOptions.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  <option.icon className="size-4" />
                  {t(option.labelKey)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {error ? (
          <ErrorNotice
            error={error}
            action={{ label: t("archived.retry"), onClick: () => void refreshArchived() }}
            className="m-3"
          />
        ) : !loaded ? (
          <ArchivedListSkeleton />
        ) : visibleSessions.length > 0 ? (
          <div className="divide-y divide-[var(--oo-divider)]">
            {visibleSessions.map((session) => (
              <ArchivedSessionRow
                key={session.id}
                locale={locale}
                pending={pendingSessionId === session.id}
                session={session}
                onDelete={handleDelete}
                onOpen={handleOpen}
                onRestore={handleRestore}
              />
            ))}
          </div>
        ) : (
          <ArchivedEmptyState hasQuery={query.trim().length > 0} />
        )}
      </section>
    </PageRouteShell>
  )
}

function ArchivedSessionRow({
  locale,
  pending,
  session,
  onDelete,
  onOpen,
  onRestore,
}: {
  locale: string
  pending: boolean
  session: SessionInfo
  onDelete: (session: SessionInfo) => Promise<void>
  onOpen: (session: SessionInfo) => Promise<void>
  onRestore: (session: SessionInfo) => Promise<void>
}) {
  const { t } = useI18n()
  const updatedAt = formatDateTime(session.updatedAt, locale)
  const archivedAt = formatDateTime(session.archivedAt ?? session.updatedAt, locale)

  return (
    <article
      className={cn("grid grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-4 px-5 py-4", pending && "opacity-60")}
    >
      <button
        type="button"
        className="grid min-w-0 gap-2 text-left"
        disabled={pending}
        onClick={() => void onOpen(session)}
      >
        <div className="oo-text-caption flex min-w-0 items-center gap-2 text-muted-foreground">
          <FolderIcon className="size-4 shrink-0" />
          <span className="min-w-0 truncate">{t("archived.listMeta", { date: archivedAt })}</span>
        </div>
        <div className="oo-text-label truncate text-foreground" title={session.title}>
          {session.title}
        </div>
        <div className="oo-text-caption text-muted-foreground">{t("archived.updatedAt", { date: updatedAt })}</div>
      </button>
      <div className="oo-text-caption hidden whitespace-nowrap text-muted-foreground sm:block">
        {t("archived.chatCount", { count: 1 })}
      </div>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            className="grid size-8 place-items-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
            aria-label={t("archived.rowActions")}
            title={t("archived.rowActions")}
            disabled={pending}
          >
            <MoreHorizontalIcon className="size-4" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onSelect={() => void onRestore(session)}>
            <RotateCcwIcon className="size-4" />
            {t("archived.restore")}
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem variant="destructive" onSelect={() => void onDelete(session)}>
            <Trash2Icon className="size-4" />
            {t("archived.delete")}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </article>
  )
}

function ArchivedListSkeleton() {
  return (
    <div className="divide-y divide-[var(--oo-divider)]">
      {Array.from({ length: 5 }, (_, index) => (
        <div key={index} className="grid gap-3 px-5 py-4">
          <div className="h-4 w-64 max-w-full animate-pulse rounded bg-muted" />
          <div className="h-5 w-80 max-w-full animate-pulse rounded bg-muted" />
          <div className="h-4 w-40 animate-pulse rounded bg-muted" />
        </div>
      ))}
    </div>
  )
}

function ArchivedEmptyState({ hasQuery }: { hasQuery: boolean }) {
  const { t } = useI18n()
  return (
    <div className="grid min-h-[22rem] place-items-center px-6 py-12 text-center">
      <div className="max-w-80">
        <div className="mx-auto grid size-12 place-items-center rounded-lg border border-[var(--oo-divider)] bg-muted/60 text-muted-foreground">
          <ArchiveIcon className="size-5" />
        </div>
        <h2 className="oo-text-title mt-3 text-foreground">
          {hasQuery ? t("archived.searchEmptyTitle") : t("archived.emptyTitle")}
        </h2>
        <p className="oo-text-body mt-1 text-muted-foreground">
          {hasQuery ? t("archived.searchEmptyDescription") : t("archived.emptyDescription")}
        </p>
      </div>
    </div>
  )
}

function formatDateTime(timestamp: number, locale: string): string {
  if (!Number.isFinite(timestamp) || timestamp <= 0) {
    return ""
  }
  return new Intl.DateTimeFormat(locale, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(timestamp))
}
