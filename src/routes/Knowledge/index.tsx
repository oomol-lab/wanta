import type { KnowledgeBaseSummary } from "../../../electron/knowledge/common.ts"
import type { UseKnowledgeBases } from "@/hooks/useKnowledgeBases"
import type { LucideIcon } from "lucide-react"

import {
  ArrowLeft,
  Check,
  ChevronRight,
  FileText,
  Folder,
  FolderOpen,
  Home,
  LibraryBig,
  MessageSquarePlus,
  MoreHorizontal,
  PanelRightClose,
  Plus,
  RefreshCw,
  Trash2,
  Upload,
} from "lucide-react"
import { ContextMenu as ContextMenuPrimitive } from "radix-ui"
import * as React from "react"
import { toast } from "sonner"
import {
  buildKnowledgeLibraryView,
  isWikiGraphFileName,
  knowledgePathDirectory,
  normalizeKnowledgePath,
  wikiGraphDropCandidates,
} from "./knowledge-route-model.ts"
import { ErrorNotice } from "@/components/ErrorNotice"
import { SearchField } from "@/components/SearchField"
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  SplitViewBody,
  SplitViewDesktopDetailPane,
  SplitViewHeader,
  SplitViewListPane,
  SplitViewMobileDetailPane,
  SplitViewRoot,
} from "@/components/ui/split-view"
import { useT } from "@/i18n/i18n"
import { cn } from "@/lib/utils"

type KnowledgeAction = {
  id: "start-chat" | "reveal" | "refresh" | "remove"
  label: string
  icon: LucideIcon
  disabled: boolean
  destructive?: boolean
  loading?: boolean
  separatorBefore?: boolean
  onSelect: () => void
}

function knowledgeStatus(item: KnowledgeBaseSummary, t: ReturnType<typeof useT>): string {
  if (item.capabilities.knowledgeGraph) return t("knowledge.statusGraph")
  if (item.capabilities.fullTextSearch) return t("knowledge.statusSearch")
  return t("knowledge.statusLimited")
}

function knowledgeActions({
  busy,
  item,
  onRefresh,
  onRemove,
  onReveal,
  onStartChat,
  t,
}: {
  busy: UseKnowledgeBases["busy"]
  item: KnowledgeBaseSummary
  onRefresh: (id: string) => void
  onRemove: (item: KnowledgeBaseSummary) => void
  onReveal: (id: string) => void
  onStartChat: (item: KnowledgeBaseSummary) => void
  t: ReturnType<typeof useT>
}): KnowledgeAction[] {
  const disabled = busy !== null
  return [
    {
      id: "start-chat",
      label: t("knowledge.startChat"),
      icon: MessageSquarePlus,
      disabled,
      onSelect: () => onStartChat(item),
    },
    {
      id: "reveal",
      label: t("knowledge.reveal"),
      icon: FolderOpen,
      disabled,
      onSelect: () => onReveal(item.id),
    },
    {
      id: "refresh",
      label: t("knowledge.refresh"),
      icon: RefreshCw,
      disabled,
      loading: busy === "refresh",
      onSelect: () => onRefresh(item.id),
    },
    {
      id: "remove",
      label: t("knowledge.remove"),
      icon: Trash2,
      disabled,
      destructive: true,
      separatorBefore: true,
      onSelect: () => onRemove(item),
    },
  ]
}

function KnowledgeActionIcon({ action }: { action: KnowledgeAction }) {
  const Icon = action.icon
  return <Icon className={cn("size-4", action.loading && "animate-spin")} />
}

function KnowledgeActionsDropdown({ actions, className }: { actions: KnowledgeAction[]; className?: string }) {
  const t = useT()
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className={cn("size-7", className)}
          aria-label={t("knowledge.actions")}
          title={t("knowledge.actions")}
        >
          <MoreHorizontal className="size-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {actions.map((action) => (
          <React.Fragment key={action.id}>
            {action.separatorBefore ? <DropdownMenuSeparator /> : null}
            <DropdownMenuItem
              variant={action.destructive ? "destructive" : "default"}
              disabled={action.disabled}
              onSelect={action.onSelect}
            >
              <KnowledgeActionIcon action={action} />
              {action.label}
            </DropdownMenuItem>
          </React.Fragment>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function KnowledgeContextMenu({ actions, children }: { actions: KnowledgeAction[]; children: React.ReactElement }) {
  return (
    <ContextMenuPrimitive.Root>
      <ContextMenuPrimitive.Trigger asChild>{children}</ContextMenuPrimitive.Trigger>
      <ContextMenuPrimitive.Portal>
        <ContextMenuPrimitive.Content className="z-[140] min-w-48 rounded-md border bg-popover p-1 text-popover-foreground shadow-md outline-hidden">
          {actions.map((action) => (
            <React.Fragment key={action.id}>
              {action.separatorBefore ? <ContextMenuPrimitive.Separator className="-mx-1 my-1 h-px bg-border" /> : null}
              <ContextMenuPrimitive.Item
                disabled={action.disabled}
                onSelect={action.onSelect}
                className={cn(
                  "relative flex cursor-default items-center gap-2 rounded-sm px-2 py-1.5 text-sm outline-hidden select-none data-[disabled]:pointer-events-none data-[disabled]:opacity-50 data-[highlighted]:bg-accent data-[highlighted]:text-accent-foreground [&_svg]:shrink-0",
                  action.destructive &&
                    "text-destructive data-[highlighted]:bg-destructive/10 data-[highlighted]:text-destructive",
                )}
              >
                <KnowledgeActionIcon action={action} />
                {action.label}
              </ContextMenuPrimitive.Item>
            </React.Fragment>
          ))}
        </ContextMenuPrimitive.Content>
      </ContextMenuPrimitive.Portal>
    </ContextMenuPrimitive.Root>
  )
}

function KnowledgeCover({ item, className }: { item: KnowledgeBaseSummary; className?: string }) {
  return (
    <div
      className={cn(
        "relative flex aspect-[3/4] items-center justify-center overflow-hidden rounded-md border border-border/70 bg-muted/35",
        className,
      )}
    >
      {item.coverDataUrl ? (
        <img src={item.coverDataUrl} alt="" draggable={false} className="size-full object-contain" />
      ) : (
        <div className="flex size-full flex-col items-center justify-center gap-2 bg-gradient-to-br from-muted/30 to-muted px-3 text-center">
          <LibraryBig className="size-5 text-muted-foreground/65" />
          <span className="oo-text-caption line-clamp-3 font-medium text-foreground/80">{item.title}</span>
        </div>
      )}
    </div>
  )
}

function KnowledgeArchiveRow({
  archive,
  selected,
  busy,
  onRemove,
  onReveal,
  onSelect,
  onStartChat,
  onRefresh,
  t,
}: {
  archive: KnowledgeBaseSummary
  selected: boolean
  busy: UseKnowledgeBases["busy"]
  onRemove: (item: KnowledgeBaseSummary) => void
  onRefresh: (id: string) => void
  onReveal: (id: string) => void
  onSelect: (item: KnowledgeBaseSummary) => void
  onStartChat: (item: KnowledgeBaseSummary) => void
  t: ReturnType<typeof useT>
}) {
  const actions = knowledgeActions({ busy, item: archive, onRefresh, onRemove, onReveal, onStartChat, t })
  const parentPath = knowledgePathDirectory(archive.relativePath)
  return (
    <KnowledgeContextMenu actions={actions}>
      <button
        type="button"
        aria-pressed={selected}
        onClick={() => onSelect(archive)}
        className={cn(
          "grid w-full grid-cols-[3.5rem_minmax(0,1fr)_auto] items-center gap-3 rounded-lg border border-transparent px-2.5 py-2 text-left transition-colors outline-none hover:bg-[var(--oo-row-hover)] focus-visible:ring-[3px] focus-visible:ring-ring/40",
          selected && "border-[var(--accent-ring)] bg-[var(--accent-soft)]",
        )}
      >
        <KnowledgeCover item={archive} className="w-full" />
        <div className="min-w-0">
          <div className="flex items-center gap-1.5 text-foreground">
            <FileText className="size-3.5 shrink-0 text-muted-foreground" />
            <span className="oo-text-control truncate font-medium">{archive.title}</span>
          </div>
          <div className="oo-text-caption mt-0.5 truncate">
            {archive.authors.join("、") || knowledgeStatus(archive, t)}
          </div>
          <div className="oo-text-caption mt-0.5 truncate text-muted-foreground">
            {parentPath ? `${parentPath} / ${archive.sourceFileName}` : archive.sourceFileName}
          </div>
        </div>
        <div className="flex items-center gap-1 text-muted-foreground">
          {selected ? <Check className="size-4 text-emerald-600" /> : null}
        </div>
      </button>
    </KnowledgeContextMenu>
  )
}

function KnowledgeFolderRow({
  folder,
  onEnter,
  t,
}: {
  folder: { archiveCount: number; name: string; path: string }
  onEnter: (path: string) => void
  t: ReturnType<typeof useT>
}) {
  return (
    <button
      type="button"
      className="grid w-full grid-cols-[2rem_minmax(0,1fr)_auto] items-center gap-3 rounded-lg border border-transparent px-2.5 py-2 text-left transition-colors outline-none hover:bg-[var(--oo-row-hover)] focus-visible:ring-[3px] focus-visible:ring-ring/40"
      onClick={() => onEnter(folder.path)}
    >
      <div className="grid size-8 place-items-center rounded-md bg-muted/50 text-muted-foreground">
        <Folder className="size-4" />
      </div>
      <div className="min-w-0">
        <div className="oo-text-control truncate font-medium text-foreground">{folder.name}</div>
        <div className="oo-text-caption truncate text-muted-foreground">
          {t("knowledge.folderCount", { count: folder.archiveCount })}
        </div>
      </div>
      <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
    </button>
  )
}

function KnowledgeBreadcrumbs({
  breadcrumbs,
  onNavigate,
  t,
}: {
  breadcrumbs: Array<{ label: string; path: string }>
  onNavigate: (path: string) => void
  t: ReturnType<typeof useT>
}) {
  return (
    <div className="flex min-w-0 flex-wrap items-center gap-1 text-sm text-muted-foreground">
      {breadcrumbs.map((breadcrumb, index) => (
        <React.Fragment key={`${breadcrumb.path}:${index}`}>
          {index > 0 ? <ChevronRight className="size-3.5 shrink-0" /> : null}
          <button
            type="button"
            className={cn(
              "max-w-full truncate rounded px-1.5 py-0.5 text-left transition-colors hover:bg-muted/60 hover:text-foreground",
              index === breadcrumbs.length - 1 && "font-medium text-foreground",
            )}
            title={breadcrumb.path || t("knowledge.rootDirectory")}
            onClick={() => onNavigate(breadcrumb.path)}
          >
            {index === 0 && breadcrumb.path === "" ? (
              <span className="inline-flex items-center gap-1.5">
                <Home className="size-3.5" />
                {breadcrumb.label}
              </span>
            ) : (
              breadcrumb.label
            )}
          </button>
        </React.Fragment>
      ))}
    </div>
  )
}

export function KnowledgeRoute({
  knowledge,
  onStartChat,
}: {
  knowledge: UseKnowledgeBases
  onStartChat: (item: KnowledgeBaseSummary) => void
}) {
  const t = useT()
  const [query, setQuery] = React.useState("")
  const [currentDirectory, setCurrentDirectory] = React.useState("")
  const [selectedId, setSelectedId] = React.useState<string | null>(null)
  const [removeTarget, setRemoveTarget] = React.useState<KnowledgeBaseSummary | null>(null)
  const [dragActive, setDragActive] = React.useState(false)
  const dragDepthRef = React.useRef(0)
  const deferredQuery = React.useDeferredValue(query)

  const view = React.useMemo(
    () => buildKnowledgeLibraryView(knowledge.items, currentDirectory, deferredQuery, t("knowledge.rootDirectory")),
    [currentDirectory, deferredQuery, knowledge.items, t],
  )
  const selected = knowledge.items.find((item) => item.id === selectedId) ?? null
  const narrowPane = selected ? "detail" : "list"
  const activeLabel = view.searchMode
    ? t("knowledge.searchResults")
    : view.currentDirectory || t("knowledge.rootDirectory")

  React.useEffect(() => {
    if (selectedId && !knowledge.items.some((item) => item.id === selectedId)) {
      setSelectedId(null)
    }
  }, [knowledge.items, selectedId])

  React.useEffect(() => {
    if (!selectedId) return
    const closeOnEscape = (event: KeyboardEvent): void => {
      if (event.key === "Escape") setSelectedId(null)
    }
    window.addEventListener("keydown", closeOnEscape)
    return () => window.removeEventListener("keydown", closeOnEscape)
  }, [selectedId])

  const handleImport = async (sourcePath?: string, targetDirectory?: string): Promise<KnowledgeBaseSummary | null> => {
    const imported = await knowledge.importKnowledgeBase(sourcePath, targetDirectory ?? currentDirectory)
    if (imported) {
      setSelectedId(imported.id)
      setCurrentDirectory(imported.relativePath ? knowledgePathDirectory(imported.relativePath) : currentDirectory)
    }
    return imported
  }

  const handleDrop = async (event: React.DragEvent<HTMLDivElement>): Promise<void> => {
    event.preventDefault()
    dragDepthRef.current = 0
    setDragActive(false)
    const files = wikiGraphDropCandidates(event.dataTransfer.files)
    if (files.length === 0) {
      toast.error(t("knowledge.dropInvalid"))
      return
    }

    let lastImported: KnowledgeBaseSummary | null = null
    for (const file of files) {
      const selectedPath = await window.wanta.selectedAttachmentPathForFile(file)
      if (!selectedPath || selectedPath.kind !== "file" || !isWikiGraphFileName(selectedPath.name)) {
        toast.error(t("knowledge.dropUnavailable", { name: file.name }))
        continue
      }
      try {
        lastImported = await handleImport(selectedPath.path, currentDirectory)
      } finally {
        await window.wanta
          .releaseAttachmentPaths([selectedPath.path, selectedPath.agentPath ?? ""])
          .catch(() => undefined)
      }
    }
    if (lastImported) setSelectedId(lastImported.id)
  }

  const handleRemove = async (): Promise<void> => {
    if (!removeTarget) return
    const removedId = removeTarget.id
    const removed = await knowledge.remove(removedId)
    if (removed && selectedId === removedId) setSelectedId(null)
    setRemoveTarget(null)
  }

  const handleNavigate = (path: string): void => {
    setCurrentDirectory(normalizeKnowledgePath(path))
    setSelectedId(null)
  }

  return (
    <div
      className="relative h-full min-h-0"
      onDragEnter={(event) => {
        if (!event.dataTransfer.types.includes("Files")) return
        event.preventDefault()
        dragDepthRef.current += 1
        setDragActive(true)
      }}
      onDragOver={(event) => {
        if (!event.dataTransfer.types.includes("Files")) return
        event.preventDefault()
        event.dataTransfer.dropEffect = "copy"
      }}
      onDragLeave={(event) => {
        if (!event.dataTransfer.types.includes("Files")) return
        dragDepthRef.current = Math.max(0, dragDepthRef.current - 1)
        if (dragDepthRef.current === 0) setDragActive(false)
      }}
      onDrop={(event) => void handleDrop(event)}
    >
      <SplitViewRoot narrowPane={narrowPane}>
        <SplitViewHeader narrowPane={narrowPane} className="oo-border-divider border-b sm:grid-cols-1">
          <div className="flex min-w-0 flex-1 flex-col gap-2">
            <div className="flex min-w-0 items-center gap-2">
              <SearchField
                className="max-w-sm flex-1"
                disabled={knowledge.items.length === 0}
                placeholder={t("knowledge.search")}
                value={query}
                onChange={(event) => setQuery(event.currentTarget.value)}
              />
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={knowledge.busy !== null || view.searchMode || !view.currentDirectory}
                onClick={() => {
                  setSelectedId(null)
                  setCurrentDirectory(knowledgePathDirectory(currentDirectory))
                }}
              >
                <ArrowLeft />
                {t("knowledge.goUp")}
              </Button>
              <Button
                type="button"
                size="sm"
                className="ml-auto"
                disabled={knowledge.busy !== null}
                onClick={() => void handleImport()}
              >
                <Plus />
                {knowledge.busy === "import"
                  ? t("knowledge.importing")
                  : view.currentDirectory
                    ? t("knowledge.importToCurrent")
                    : t("knowledge.import")}
              </Button>
            </div>
            <KnowledgeBreadcrumbs breadcrumbs={view.breadcrumbs} onNavigate={handleNavigate} t={t} />
          </div>
        </SplitViewHeader>

        <SplitViewBody
          desktopLayout={selected ? "compact-detail" : "single"}
          className="motion-reduce:transition-none min-[960px]:transition-[grid-template-columns] min-[960px]:duration-200 min-[960px]:ease-out"
        >
          <SplitViewListPane narrowPane={narrowPane} className="pt-3">
            <KnowledgeLibraryContent
              activeLabel={activeLabel}
              busy={knowledge.busy}
              error={knowledge.error}
              loading={knowledge.loading}
              onEnterDirectory={handleNavigate}
              onImport={() => void handleImport()}
              onRefresh={(id) => void knowledge.refresh(id)}
              onRemove={setRemoveTarget}
              onReveal={(id) => void knowledge.reveal(id)}
              onSelectArchive={(item) => setSelectedId(item.id)}
              onStartChat={onStartChat}
              query={deferredQuery}
              selectedId={selectedId}
              t={t}
              view={view}
            />
          </SplitViewListPane>

          {selected ? (
            <SplitViewMobileDetailPane narrowPane={narrowPane}>
              <Button variant="ghost" size="sm" className="mb-2" onClick={() => setSelectedId(null)}>
                <ArrowLeft />
                {t("knowledge.back")}
              </Button>
              <KnowledgeDetail
                busy={knowledge.busy}
                item={selected}
                onClose={() => setSelectedId(null)}
                onRefresh={(id) => void knowledge.refresh(id)}
                onRemove={setRemoveTarget}
                onReveal={(id) => void knowledge.reveal(id)}
                onStartChat={onStartChat}
              />
            </SplitViewMobileDetailPane>
          ) : null}

          {selected ? (
            <SplitViewDesktopDetailPane className="animate-in pt-3 duration-150 fade-in-0 slide-in-from-right-2 motion-reduce:animate-none">
              <KnowledgeDetail
                busy={knowledge.busy}
                item={selected}
                onClose={() => setSelectedId(null)}
                onRefresh={(id) => void knowledge.refresh(id)}
                onRemove={setRemoveTarget}
                onReveal={(id) => void knowledge.reveal(id)}
                onStartChat={onStartChat}
              />
            </SplitViewDesktopDetailPane>
          ) : null}
        </SplitViewBody>
      </SplitViewRoot>

      {dragActive ? (
        <div className="pointer-events-none absolute inset-2 z-50 grid place-items-center rounded-lg border-2 border-dashed border-[var(--accent-ring)] bg-background/92 backdrop-blur-sm">
          <div className="grid max-w-sm justify-items-center gap-2 px-6 text-center">
            <span className="grid size-10 place-items-center rounded-md bg-[var(--accent-soft)] text-[var(--accent-strong)]">
              <Upload className="size-5" />
            </span>
            <div className="oo-text-title">{t("knowledge.dropTitle")}</div>
            <div className="oo-text-caption">{t("knowledge.dropDescription")}</div>
          </div>
        </div>
      ) : null}

      <ConfirmDialog
        open={removeTarget !== null}
        onOpenChange={(open) => {
          if (!open && knowledge.busy !== "remove") setRemoveTarget(null)
        }}
      >
        <ConfirmDialogContent>
          <ConfirmDialogHeader>
            <ConfirmDialogTitle>{t("knowledge.removeConfirmTitle")}</ConfirmDialogTitle>
            <ConfirmDialogDescription>
              {removeTarget ? t("knowledge.removeConfirm", { title: removeTarget.title }) : ""}
            </ConfirmDialogDescription>
          </ConfirmDialogHeader>
          <ConfirmDialogFooter>
            <ConfirmDialogCancel disabled={knowledge.busy === "remove"}>{t("common.cancel")}</ConfirmDialogCancel>
            <ConfirmDialogAction disabled={knowledge.busy === "remove"} onClick={() => void handleRemove()}>
              {t("knowledge.remove")}
            </ConfirmDialogAction>
          </ConfirmDialogFooter>
        </ConfirmDialogContent>
      </ConfirmDialog>
    </div>
  )
}

function KnowledgeLibraryContent({
  activeLabel,
  busy,
  error,
  loading,
  onEnterDirectory,
  onImport,
  onRefresh,
  onRemove,
  onReveal,
  onSelectArchive,
  onStartChat,
  query,
  selectedId,
  t,
  view,
}: {
  activeLabel: string
  busy: UseKnowledgeBases["busy"]
  error: UseKnowledgeBases["error"]
  loading: boolean
  onEnterDirectory: (path: string) => void
  onImport: () => void
  onRefresh: (id: string) => void
  onRemove: (item: KnowledgeBaseSummary) => void
  onReveal: (id: string) => void
  onSelectArchive: (item: KnowledgeBaseSummary) => void
  onStartChat: (item: KnowledgeBaseSummary) => void
  query: string
  selectedId: string | null
  t: ReturnType<typeof useT>
  view: ReturnType<typeof buildKnowledgeLibraryView>
}) {
  if (loading) {
    return <KnowledgeGridSkeleton />
  }

  const noItems = view.directories.length === 0 && view.archives.length === 0
  if (noItems && !query.trim()) {
    return (
      <div className="flex min-h-72 items-center justify-center py-10">
        <div className="max-w-sm text-center">
          <div className="mx-auto grid size-10 place-items-center rounded-md border border-border bg-muted/35">
            <LibraryBig className="size-4 text-muted-foreground" />
          </div>
          <h2 className="oo-text-title mt-3">{t("knowledge.emptyTitle")}</h2>
          <p className="oo-text-caption mt-1.5">{t("knowledge.emptyDescription")}</p>
          <Button type="button" variant="outline" size="sm" className="mt-4" onClick={onImport}>
            <Plus />
            {t("knowledge.import")}
          </Button>
          {error ? <ErrorNotice error={error} compact className="mt-3 text-left" /> : null}
        </div>
      </div>
    )
  }

  if (noItems && query.trim()) {
    return <div className="oo-text-control py-12 text-center text-muted-foreground">{t("knowledge.noResults")}</div>
  }

  if (noItems) {
    return (
      <div className="py-12 text-center">
        <div className="oo-text-title">{t("knowledge.emptyFolderTitle")}</div>
        <div className="oo-text-caption mt-1.5">{t("knowledge.emptyFolderDescription", { label: activeLabel })}</div>
        <Button type="button" variant="outline" size="sm" className="mt-4" onClick={onImport}>
          <Plus />
          {t("knowledge.importToCurrent")}
        </Button>
        {error ? <ErrorNotice error={error} compact className="mt-3 text-left" /> : null}
      </div>
    )
  }

  return (
    <div className="grid gap-3">
      <div className="flex items-center justify-between gap-3 px-1 text-sm text-muted-foreground">
        <div className="flex min-w-0 items-center gap-2">
          <FolderOpen className="size-4" />
          <span className="truncate">{activeLabel}</span>
        </div>
        <div className="shrink-0">
          {view.searchMode
            ? t("knowledge.searchResultCount", { count: view.archives.length })
            : t("knowledge.folderSummary", {
                archives: view.archives.length,
                folders: view.directories.length,
              })}
        </div>
      </div>

      <div className="grid gap-2">
        {view.directories.map((folder) => (
          <KnowledgeFolderRow key={folder.path} folder={folder} onEnter={onEnterDirectory} t={t} />
        ))}
        {view.archives.map((archive) => (
          <KnowledgeArchiveRow
            key={archive.item.id}
            archive={archive.item}
            busy={busy}
            selected={selectedId === archive.item.id}
            onRefresh={onRefresh}
            onRemove={onRemove}
            onReveal={onReveal}
            onSelect={onSelectArchive}
            onStartChat={onStartChat}
            t={t}
          />
        ))}
      </div>
      {error ? <ErrorNotice error={error} compact className="mt-1" /> : null}
    </div>
  )
}

function KnowledgeGridSkeleton() {
  return (
    <div className="grid gap-2" aria-hidden="true">
      {Array.from({ length: 8 }, (_, index) => (
        <div key={index} className="grid grid-cols-[2rem_minmax(0,1fr)] items-center gap-3 rounded-lg px-2.5 py-2">
          <div className="size-8 animate-pulse rounded-md bg-muted" />
          <div className="grid gap-2">
            <div className="h-4 w-48 animate-pulse rounded-sm bg-muted" />
            <div className="h-3 w-72 animate-pulse rounded-sm bg-muted" />
          </div>
        </div>
      ))}
    </div>
  )
}

function KnowledgeDetail({
  busy,
  item,
  onClose,
  onStartChat,
  onRefresh,
  onRemove,
  onReveal,
}: {
  busy: UseKnowledgeBases["busy"]
  item: KnowledgeBaseSummary
  onClose: () => void
  onStartChat: (item: KnowledgeBaseSummary) => void
  onRefresh: (id: string) => void
  onRemove: (item: KnowledgeBaseSummary) => void
  onReveal: (id: string) => void
}) {
  const t = useT()
  const disabled = busy !== null
  const statistics = [
    item.statistics.contentChapters ? t("knowledge.chapterCount", { count: item.statistics.contentChapters }) : null,
    item.statistics.sourceWords
      ? t("knowledge.wordCount", { count: item.statistics.sourceWords.toLocaleString() })
      : null,
  ].filter((value): value is string => Boolean(value))
  const actions = knowledgeActions({ busy, item, onRefresh, onRemove, onReveal, onStartChat, t })

  return (
    <KnowledgeContextMenu actions={actions}>
      <div className="relative grid gap-4">
        <div className="absolute -top-1 -right-1 z-10 flex items-center gap-0.5">
          <KnowledgeActionsDropdown actions={actions} />
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-7"
            aria-label={t("knowledge.collapseDetails")}
            title={t("knowledge.collapseDetails")}
            onClick={onClose}
          >
            <PanelRightClose className="size-3.5" />
          </Button>
        </div>

        <div className="grid grid-cols-[5.5rem_minmax(0,1fr)] items-start gap-3 pr-16">
          <KnowledgeCover item={item} className="w-[5.5rem] shadow-xs" />
          <div className="min-w-0">
            <div className="oo-text-label line-clamp-3 text-foreground">{item.title}</div>
            {item.authors.length > 0 ? (
              <p className="oo-text-caption mt-1 truncate">{item.authors.join("、")}</p>
            ) : null}
            {item.publisher ? <p className="oo-text-caption truncate">{item.publisher}</p> : null}
            <p className="oo-text-caption mt-1 truncate text-muted-foreground">
              {item.relativePath || item.sourceFileName}
            </p>
            <div className="oo-text-control mt-3 flex items-center gap-1.5 text-foreground">
              <Check className="size-3.5 text-emerald-600" />
              <span>{knowledgeStatus(item, t)}</span>
            </div>
          </div>
        </div>

        {statistics.length > 0 ? (
          <div className="oo-text-caption border-y border-[var(--oo-divider)] py-2.5">{statistics.join(" · ")}</div>
        ) : null}

        <div className="grid gap-2">
          <Button type="button" disabled={disabled} onClick={() => onStartChat(item)}>
            <MessageSquarePlus />
            {t("knowledge.startChat")}
          </Button>
          <div className="grid grid-cols-2 gap-2">
            <Button type="button" variant="outline" size="sm" disabled={disabled} onClick={() => onReveal(item.id)}>
              <FolderOpen />
              {t("knowledge.reveal")}
            </Button>
            <Button type="button" variant="outline" size="sm" disabled={disabled} onClick={() => onRefresh(item.id)}>
              <RefreshCw className={cn(busy === "refresh" && "animate-spin")} />
              {t("knowledge.refresh")}
            </Button>
          </div>
        </div>
      </div>
    </KnowledgeContextMenu>
  )
}
