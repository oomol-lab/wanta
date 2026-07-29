import type { BatchSessionResult, SessionInfo } from "../../../electron/session/common.ts"
import type { SidebarTaskSortMode } from "@/components/app-shell/sidebar-persistence"

import { ArchiveIcon, SearchIcon, Trash2Icon } from "lucide-react"
import * as React from "react"
import { toast } from "sonner"
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
} from "@/components/ui/confirm-dialog"
import { Dialog } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { useI18n } from "@/i18n/i18n"
import { resolveUserFacingError, userFacingErrorDescription } from "@/lib/user-facing-error"
import { cn } from "@/lib/utils"

interface TasksDialogProps {
  archiveSessions: (ids: string[]) => Promise<BatchSessionResult>
  isSessionRunning: (id: string) => boolean
  open: boolean
  removeSessions: (ids: string[]) => Promise<BatchSessionResult>
  sessions: SessionInfo[]
  sortMode: SidebarTaskSortMode
  onClose: () => void
  onSortModeChange: (mode: SidebarTaskSortMode) => void
}

type PendingAction = "archive" | "remove" | null

function visibleTasks(sessions: SessionInfo[], query: string, sortMode: SidebarTaskSortMode): SessionInfo[] {
  const normalizedQuery = query.trim().toLocaleLowerCase()
  return sessions
    .filter((session) => !normalizedQuery || session.title.toLocaleLowerCase().includes(normalizedQuery))
    .sort((left, right) => {
      switch (sortMode) {
        case "title":
          return left.title.localeCompare(right.title)
        case "updatedAt":
          return right.updatedAt - left.updatedAt || right.createdAt - left.createdAt
        case "createdAt":
          return right.createdAt - left.createdAt
      }
    })
}

export function TasksDialog({
  archiveSessions,
  isSessionRunning,
  onClose,
  onSortModeChange,
  open,
  removeSessions,
  sessions,
  sortMode,
}: TasksDialogProps) {
  const { locale, t } = useI18n()
  const [query, setQuery] = React.useState("")
  const [selectedIds, setSelectedIds] = React.useState<Set<string>>(() => new Set())
  const [pendingAction, setPendingAction] = React.useState<PendingAction>(null)
  const [runningAction, setRunningAction] = React.useState(false)
  const tasks = React.useMemo(() => visibleTasks(sessions, query, sortMode), [query, sessions, sortMode])
  const eligibleTasks = React.useMemo(
    () => tasks.filter((session) => !isSessionRunning(session.id)),
    [isSessionRunning, tasks],
  )
  const selectedSessions = React.useMemo(
    () => sessions.filter((session) => selectedIds.has(session.id)),
    [selectedIds, sessions],
  )
  const allVisibleSelected = eligibleTasks.length > 0 && eligibleTasks.every((session) => selectedIds.has(session.id))

  React.useEffect(() => {
    const availableIds = new Set(sessions.map((session) => session.id))
    setSelectedIds((current) => new Set([...current].filter((id) => availableIds.has(id) && !isSessionRunning(id))))
  }, [isSessionRunning, sessions])

  React.useEffect(() => {
    if (open) return
    setQuery("")
    setSelectedIds(new Set())
    setPendingAction(null)
  }, [open])

  const toggleSession = (id: string): void => {
    setSelectedIds((current) => {
      const next = new Set(current)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const toggleAllVisible = (): void => {
    setSelectedIds((current) => {
      const next = new Set(current)
      if (allVisibleSelected) {
        for (const session of eligibleTasks) next.delete(session.id)
      } else {
        for (const session of eligibleTasks) next.add(session.id)
      }
      return next
    })
  }

  const runAction = async (): Promise<void> => {
    if (!pendingAction || selectedIds.size === 0) return
    setRunningAction(true)
    try {
      const ids = [...selectedIds].filter((id) => !isSessionRunning(id))
      if (ids.length === 0) {
        setSelectedIds(new Set())
        setPendingAction(null)
        return
      }
      const result = pendingAction === "archive" ? await archiveSessions(ids) : await removeSessions(ids)
      setSelectedIds(new Set(result.failures.map((failure) => failure.id)))
      if (result.succeededIds.length > 0) {
        toast.success(
          t(pendingAction === "archive" ? "tasks.archivedToast" : "tasks.deletedToast", {
            count: result.succeededIds.length,
          }),
        )
      }
      if (result.failures.length > 0) {
        toast.error(t("tasks.partialFailureToast", { count: result.failures.length }))
      }
      setPendingAction(null)
    } catch (cause) {
      const notice = resolveUserFacingError(cause, { area: "session" })
      toast.error(userFacingErrorDescription(notice, t))
    } finally {
      setRunningAction(false)
    }
  }

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={t("tasks.manageTitle")}
      description={
        <>
          {t("tasks.manageDescription")}
          <span className="mx-1.5 text-muted-foreground/45">·</span>
          {t("tasks.totalCount", { count: sessions.length })}
        </>
      }
      closeLabel={t("common.close")}
      className="h-[min(78vh,48rem)] max-w-5xl"
      contentClassName="flex flex-col overflow-hidden p-0"
    >
      <div className="flex min-h-0 flex-1 flex-col">
        <section className="flex min-h-0 flex-1 flex-col overflow-hidden bg-background">
          <div className="grid grid-cols-[minmax(16rem,1fr)_auto] gap-3 border-b border-[var(--oo-divider)] p-3">
            <div className="flex h-10 min-w-0 items-center gap-2 rounded-md bg-muted/70 px-3">
              <SearchIcon className="size-4 shrink-0 text-muted-foreground" />
              <Input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder={t("tasks.searchPlaceholder")}
                aria-label={t("tasks.searchPlaceholder")}
                className="h-8 min-w-0 flex-1 border-0 bg-transparent px-0 shadow-none focus-visible:ring-0"
              />
            </div>
            <Select value={sortMode} onValueChange={(value) => onSortModeChange(value as SidebarTaskSortMode)}>
              <SelectTrigger className="h-10 min-w-44 bg-muted/70" aria-label={t("tasks.sortLabel")}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent align="end">
                <SelectItem value="updatedAt">{t("tasks.sortUpdated")}</SelectItem>
                <SelectItem value="createdAt">{t("tasks.sortCreated")}</SelectItem>
                <SelectItem value="title">{t("tasks.sortTitle")}</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="grid grid-cols-[2.5rem_minmax(0,1fr)_8rem_7rem] items-center gap-3 border-b border-[var(--oo-divider)] bg-muted/30 px-4 py-2">
            <input
              type="checkbox"
              checked={allVisibleSelected}
              aria-label={t("tasks.selectAll")}
              onChange={toggleAllVisible}
              className="size-4 accent-primary"
            />
            <span className="oo-text-caption text-muted-foreground">{t("tasks.columnTitle")}</span>
            <span className="oo-text-caption text-muted-foreground">{t("tasks.columnUpdated")}</span>
            <span className="oo-text-caption text-muted-foreground">{t("tasks.columnStatus")}</span>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto">
            {tasks.length > 0 ? (
              <div className="divide-y divide-[var(--oo-divider)]">
                {tasks.map((session) => {
                  const running = isSessionRunning(session.id)
                  return (
                    <label
                      key={session.id}
                      className={cn(
                        "grid grid-cols-[2.5rem_minmax(0,1fr)_8rem_7rem] items-center gap-3 px-4 py-3",
                        running ? "cursor-not-allowed opacity-55" : "cursor-pointer hover:bg-muted/35",
                      )}
                    >
                      <input
                        type="checkbox"
                        checked={selectedIds.has(session.id)}
                        disabled={running}
                        aria-label={t("tasks.selectTask", { title: session.title })}
                        onChange={() => toggleSession(session.id)}
                        className="size-4 accent-primary"
                      />
                      <span className="oo-text-label truncate" title={session.title}>
                        {session.title}
                      </span>
                      <span className="oo-text-caption text-muted-foreground">
                        {new Intl.DateTimeFormat(locale, { month: "short", day: "numeric" }).format(session.updatedAt)}
                      </span>
                      <span className="oo-text-caption text-muted-foreground">
                        {t(running ? "tasks.statusRunning" : "tasks.statusReady")}
                      </span>
                    </label>
                  )
                })}
              </div>
            ) : (
              <div className="oo-text-body px-6 py-14 text-center text-muted-foreground">
                {t(query.trim() ? "tasks.searchEmpty" : "tasks.empty")}
              </div>
            )}
          </div>
        </section>

        {selectedIds.size > 0 ? (
          <div className="flex items-center gap-3 border-t border-[var(--oo-divider)] bg-background px-4 py-3">
            <span className="oo-text-control mr-auto">{t("tasks.selectedCount", { count: selectedIds.size })}</span>
            <Button type="button" variant="outline" onClick={() => setSelectedIds(new Set())}>
              {t("common.cancel")}
            </Button>
            <Button type="button" variant="outline" onClick={() => setPendingAction("archive")}>
              <ArchiveIcon className="size-4" />
              {t("tasks.archive")}
            </Button>
            <Button type="button" variant="destructive" onClick={() => setPendingAction("remove")}>
              <Trash2Icon className="size-4" />
              {t("tasks.delete")}
            </Button>
          </div>
        ) : null}
      </div>

      <ConfirmDialog open={pendingAction !== null} onOpenChange={(open) => !open && setPendingAction(null)}>
        <ConfirmDialogContent>
          <ConfirmDialogHeader>
            <ConfirmDialogTitle>
              {t(pendingAction === "remove" ? "tasks.deleteConfirmTitle" : "tasks.archiveConfirmTitle", {
                count: selectedIds.size,
              })}
            </ConfirmDialogTitle>
            <ConfirmDialogDescription>
              {t(pendingAction === "remove" ? "tasks.deleteConfirmDescription" : "tasks.archiveConfirmDescription")}
            </ConfirmDialogDescription>
          </ConfirmDialogHeader>
          <div className="grid max-h-32 gap-1 overflow-y-auto rounded-md bg-muted/55 px-3 py-2">
            {selectedSessions.slice(0, 5).map((session) => (
              <div key={session.id} className="oo-text-caption truncate">
                {session.title}
              </div>
            ))}
            {selectedSessions.length > 5 ? (
              <div className="oo-text-caption text-muted-foreground">
                {t("tasks.andMore", { count: selectedSessions.length - 5 })}
              </div>
            ) : null}
          </div>
          <ConfirmDialogFooter>
            <ConfirmDialogCancel disabled={runningAction}>{t("common.cancel")}</ConfirmDialogCancel>
            <ConfirmDialogAction
              disabled={runningAction}
              variant={pendingAction === "remove" ? "destructive" : "default"}
              onClick={() => void runAction()}
            >
              {runningAction
                ? t("tasks.processing")
                : t(pendingAction === "remove" ? "tasks.deleteCount" : "tasks.archiveCount", {
                    count: selectedIds.size,
                  })}
            </ConfirmDialogAction>
          </ConfirmDialogFooter>
        </ConfirmDialogContent>
      </ConfirmDialog>
    </Dialog>
  )
}
