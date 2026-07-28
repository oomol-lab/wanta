import type { KnowledgeBaseSummary, KnowledgeChapterNode } from "../../../electron/knowledge/common.ts"
import type { UseKnowledgeBases } from "@/hooks/useKnowledgeBases"
import type { LucideIcon } from "lucide-react"

import {
  AlignLeft,
  ArrowLeft,
  ChevronDown,
  Folder,
  FolderPlus,
  FolderOpen,
  FolderX,
  GitBranch,
  LibraryBig,
  MessageSquarePlus,
  MoreHorizontal,
  MoveRight,
  Network,
  Pencil,
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
  knowledgeArchiveDisplayName,
  knowledgePathBaseName,
  knowledgePathDirectory,
  knowledgePathExists,
  normalizeKnowledgePath,
  stripWikiGraphExtension,
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
import { Dialog } from "@/components/ui/dialog"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
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
  id: "move" | "refresh" | "remove" | "rename" | "reveal" | "start-chat"
  label: string
  icon: LucideIcon
  disabled: boolean
  destructive?: boolean
  loading?: boolean
  separatorBefore?: boolean
  onSelect: () => void
}

type PendingKnowledgeImport = {
  directory: string
  fileName: string
  id: string
}

function knowledgeActions({
  busy,
  item,
  onMove,
  onRefresh,
  onRemove,
  onRename,
  onReveal,
  onStartChat,
  t,
}: {
  busy: UseKnowledgeBases["busy"]
  item: KnowledgeBaseSummary
  onMove: (item: KnowledgeBaseSummary) => void
  onRefresh: (id: string) => void
  onRemove: (item: KnowledgeBaseSummary) => void
  onRename: (item: KnowledgeBaseSummary) => void
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
      id: "rename",
      label: t("knowledge.rename"),
      icon: Pencil,
      disabled,
      loading: busy === "rename",
      onSelect: () => onRename(item),
    },
    {
      id: "move",
      label: t("knowledge.move"),
      icon: MoveRight,
      disabled,
      loading: busy === "move",
      onSelect: () => onMove(item),
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

type KnowledgeCoverageKind = "knowledgeGraph" | "readingGraph" | "summary"
type KnowledgeCoverage = NonNullable<KnowledgeBaseSummary["coverage"]>
interface KnowledgeRenameDraft {
  authors: string
  fileName: string
  title: string
}

const knowledgeCoverageSpecs: Array<{
  icon: LucideIcon
  key: KnowledgeCoverageKind
  labelKey: "knowledge.inspect.knowledgeGraph" | "knowledge.inspect.readingGraph" | "knowledge.inspect.summary"
}> = [
  { icon: GitBranch, key: "readingGraph", labelKey: "knowledge.inspect.readingGraph" },
  { icon: Network, key: "knowledgeGraph", labelKey: "knowledge.inspect.knowledgeGraph" },
  { icon: AlignLeft, key: "summary", labelKey: "knowledge.inspect.summary" },
]

function knowledgeCoveragePercent(metric: KnowledgeCoverage[KnowledgeCoverageKind] | undefined): number {
  const coveredWords =
    typeof metric?.coveredWords === "number" && Number.isFinite(metric.coveredWords) ? metric.coveredWords : 0
  const totalWords =
    typeof metric?.totalWords === "number" && Number.isFinite(metric.totalWords) ? metric.totalWords : 0
  if (totalWords <= 0) return 0
  return Math.max(0, Math.min(100, Math.round((coveredWords / totalWords) * 100)))
}

function knowledgeCoverageTone(percent: number): string {
  if (percent <= 0) return "text-muted-foreground/45"
  if (percent < 20) return "text-rose-500"
  if (percent < 40) return "text-orange-500"
  if (percent < 60) return "text-amber-500"
  if (percent < 80) return "text-sky-500"
  if (percent < 100) return "text-blue-600"
  return "text-emerald-600"
}

function parseKnowledgeAuthors(value: string): string[] {
  return value
    .split(/[、,，]/u)
    .map((author) => author.trim())
    .filter(Boolean)
}

function isValidKnowledgeFileName(value: string): boolean {
  const fileName = stripWikiGraphExtension(value)
  return Boolean(fileName && fileName !== "." && fileName !== ".." && !/[/:\\]/u.test(fileName))
}

function summarizeKnowledgeCoverage(items: KnowledgeBaseSummary[]): KnowledgeCoverage {
  const summary: KnowledgeCoverage = {}
  for (const spec of knowledgeCoverageSpecs) {
    let coveredWords = 0
    let totalWords = 0
    for (const item of items) {
      const metric = item.coverage?.[spec.key]
      const covered =
        typeof metric?.coveredWords === "number" && Number.isFinite(metric.coveredWords) ? metric.coveredWords : 0
      const total = typeof metric?.totalWords === "number" && Number.isFinite(metric.totalWords) ? metric.totalWords : 0
      if (total <= 0) continue
      coveredWords += Math.max(0, covered)
      totalWords += total
    }
    summary[spec.key] = { coveredWords, totalWords }
  }
  return summary
}

function KnowledgeInspectBadges({
  className,
  coverage,
  size = "row",
  t,
}: {
  className?: string
  coverage: KnowledgeCoverage | undefined
  size?: "breadcrumb" | "detail" | "row"
  t: ReturnType<typeof useT>
}) {
  return (
    <div
      className={cn(
        "flex min-w-0 flex-wrap items-center gap-1",
        size === "breadcrumb" && "shrink-0 justify-end",
        size === "detail" && "flex-wrap",
        className,
      )}
    >
      {knowledgeCoverageSpecs.map((spec) => {
        const Icon = spec.icon
        const percent = knowledgeCoveragePercent(coverage?.[spec.key])
        const label = t(spec.labelKey)
        return (
          <span
            key={spec.key}
            aria-label={t("knowledge.inspect.coverageLabel", { label, percent })}
            title={t("knowledge.inspect.coverageLabel", { label, percent })}
            className={cn(
              "inline-flex h-5 items-center gap-0.5 rounded border border-border/60 bg-muted/25 px-1.5 text-[10px] leading-none font-medium text-muted-foreground tabular-nums",
              size === "breadcrumb" && "h-6 px-1.5 text-[11px]",
              size === "detail" && "h-6 px-2 text-[11px]",
            )}
          >
            <Icon className={cn("size-3", size !== "row" && "size-3.5", knowledgeCoverageTone(percent))} />
            <span>{percent}%</span>
          </span>
        )
      })}
    </div>
  )
}

function KnowledgeDetailInspectRows({
  coverage,
  t,
}: {
  coverage: KnowledgeCoverage | undefined
  t: ReturnType<typeof useT>
}) {
  return (
    <div className="grid gap-3">
      {knowledgeCoverageSpecs.map((spec) => {
        const Icon = spec.icon
        const metric = coverage?.[spec.key]
        const coveredWords =
          typeof metric?.coveredWords === "number" && Number.isFinite(metric.coveredWords) ? metric.coveredWords : 0
        const percent = knowledgeCoveragePercent(metric)
        const label = t(spec.labelKey)
        return (
          <div key={spec.key} className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-2">
            <Icon className={cn("size-4", knowledgeCoverageTone(percent))} />
            <div className="min-w-0">
              <div className="oo-text-control truncate font-medium text-foreground">{label}</div>
              <div className="oo-text-caption truncate text-muted-foreground">
                {t("knowledge.inspect.coverageWords", {
                  covered: coveredWords.toLocaleString(),
                })}
              </div>
            </div>
            <div className="text-sm font-medium text-foreground tabular-nums">{percent}%</div>
          </div>
        )
      })}
    </div>
  )
}

function KnowledgeChapterTree({ chapters, depth = 0 }: { chapters: KnowledgeChapterNode[]; depth?: number }) {
  if (chapters.length === 0) return null
  return (
    <ol className={cn("grid gap-0.5", depth > 0 && "border-l border-border/80 pl-4")}>
      {chapters.map((chapter, index) => (
        <li key={`${depth}:${index}:${chapter.title}`} className="min-w-0">
          <div className="grid min-h-8 grid-cols-[1.25rem_minmax(0,1fr)] items-center gap-1">
            {chapter.children?.length ? (
              <ChevronDown className="size-4 text-muted-foreground" />
            ) : (
              <span className="size-4" aria-hidden="true" />
            )}
            <span className="min-w-0 text-sm leading-6 text-foreground">{chapter.title}</span>
          </div>
          {chapter.children?.length ? (
            <div className="ml-[0.6rem]">
              <KnowledgeChapterTree chapters={chapter.children} depth={depth + 1} />
            </div>
          ) : null}
        </li>
      ))}
    </ol>
  )
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
        <div className="grid size-full place-items-center bg-gradient-to-br from-muted/30 to-muted">
          <LibraryBig className="size-6 text-muted-foreground/65" />
        </div>
      )}
    </div>
  )
}

function KnowledgeArchiveRow({
  archive,
  compact,
  selected,
  busy,
  onMove,
  onRemove,
  onRename,
  onReveal,
  onSelect,
  onStartChat,
  onRefresh,
  t,
}: {
  archive: KnowledgeBaseSummary
  compact: boolean
  selected: boolean
  busy: UseKnowledgeBases["busy"]
  onMove: (item: KnowledgeBaseSummary) => void
  onRemove: (item: KnowledgeBaseSummary) => void
  onRename: (item: KnowledgeBaseSummary) => void
  onRefresh: (id: string) => void
  onReveal: (id: string) => void
  onSelect: (item: KnowledgeBaseSummary) => void
  onStartChat: (item: KnowledgeBaseSummary) => void
  t: ReturnType<typeof useT>
}) {
  const actions = knowledgeActions({
    busy,
    item: archive,
    onMove,
    onRefresh,
    onRemove,
    onRename,
    onReveal,
    onStartChat,
    t,
  })
  const parentPath = knowledgePathDirectory(archive.relativePath)
  const fileDisplayName = knowledgeArchiveDisplayName(archive.relativePath || archive.sourceFileName)
  const fileTitle = parentPath ? `${parentPath} / ${archive.sourceFileName}` : archive.sourceFileName
  return (
    <KnowledgeContextMenu actions={actions}>
      <div
        className={cn(
          "grid w-full grid-cols-[minmax(0,1fr)_auto] items-center rounded-lg border border-transparent transition-colors focus-within:ring-[3px] focus-within:ring-ring/40 hover:bg-[var(--oo-row-hover)]",
          !compact && "min-[760px]:grid-cols-[minmax(0,1fr)_minmax(5rem,12rem)_auto]",
          selected && "border-[var(--accent-ring)] bg-[var(--accent-soft)]",
        )}
      >
        <button
          type="button"
          aria-pressed={selected}
          onClick={() => onSelect(archive)}
          className="grid min-w-0 grid-cols-[5.25rem_minmax(0,1fr)] items-center gap-3 px-2.5 py-3 text-left outline-none"
        >
          <KnowledgeCover item={archive} className="w-full" />
          <div className="min-w-0">
            <div className="oo-text-control truncate font-medium text-foreground">{archive.title}</div>
            {archive.authors.length > 0 ? (
              <div className="oo-text-caption mt-0.5 truncate">{archive.authors.join("、")}</div>
            ) : null}
            {compact ? (
              <div className="oo-text-caption mt-0.5 truncate text-muted-foreground" title={fileTitle}>
                {fileDisplayName}
              </div>
            ) : null}
            <KnowledgeInspectBadges coverage={archive.coverage} className="mt-2" t={t} />
          </div>
        </button>
        <div
          className={cn(
            "oo-text-caption hidden min-w-0 truncate px-2 text-right text-muted-foreground",
            !compact && "min-[760px]:block",
          )}
          title={fileTitle}
        >
          {fileDisplayName}
        </div>
        <div className="flex items-center gap-1 pr-2 text-muted-foreground">
          <KnowledgeActionsDropdown actions={actions} className="opacity-70" />
        </div>
      </div>
    </KnowledgeContextMenu>
  )
}

function PendingKnowledgeArchiveRow({
  compact,
  item,
  t,
}: {
  compact: boolean
  item: PendingKnowledgeImport
  t: ReturnType<typeof useT>
}) {
  const fileDisplayName = knowledgeArchiveDisplayName(item.fileName)
  return (
    <div
      className={cn(
        "grid w-full grid-cols-[minmax(0,1fr)_auto] items-center rounded-lg border border-dashed border-border/80 bg-muted/20 opacity-85",
        !compact && "min-[760px]:grid-cols-[minmax(0,1fr)_minmax(5rem,12rem)_auto]",
      )}
    >
      <div className="grid min-w-0 grid-cols-[5.25rem_minmax(0,1fr)] items-center gap-3 px-2.5 py-3 text-left">
        <div className="relative flex aspect-[3/4] w-full items-center justify-center overflow-hidden rounded-md border border-border/70 bg-muted/45">
          <LibraryBig className="size-5 text-muted-foreground/55" />
        </div>
        <div className="min-w-0">
          <div className="oo-text-control truncate font-medium text-foreground">{fileDisplayName}</div>
          <div className="oo-text-caption mt-0.5 truncate text-muted-foreground">{t("knowledge.importPending")}</div>
          {compact ? (
            <div className="oo-text-caption mt-0.5 truncate text-muted-foreground" title={item.fileName}>
              {fileDisplayName}
            </div>
          ) : null}
          <div className="mt-2 flex flex-wrap items-center gap-1" aria-hidden="true">
            {Array.from({ length: 3 }, (_, index) => (
              <span key={index} className="h-5 w-14 animate-pulse rounded border border-border/60 bg-muted/45" />
            ))}
          </div>
        </div>
      </div>
      <div
        className={cn(
          "oo-text-caption hidden min-w-0 truncate px-2 text-right text-muted-foreground",
          !compact && "min-[760px]:block",
        )}
        title={item.fileName}
      >
        {fileDisplayName}
      </div>
      <div className="flex items-center gap-1 pr-2 text-muted-foreground">
        <RefreshCw className="size-4 animate-spin opacity-65" />
      </div>
    </div>
  )
}

function KnowledgeFolderRow({
  busy,
  folder,
  onEnter,
  onRemove,
  t,
}: {
  busy: UseKnowledgeBases["busy"]
  folder: { archiveCount: number; name: string; path: string }
  onEnter: (path: string) => void
  onRemove: (folder: { archiveCount: number; name: string; path: string }) => void
  t: ReturnType<typeof useT>
}) {
  const disabled = busy !== null
  const actions: KnowledgeAction[] = [
    {
      id: "remove",
      label: t("knowledge.removeFolder"),
      icon: FolderX,
      disabled,
      destructive: true,
      loading: busy === "remove-folder",
      onSelect: () => onRemove(folder),
    },
  ]
  return (
    <KnowledgeContextMenu actions={actions}>
      <div className="grid w-full grid-cols-[minmax(0,1fr)_auto] items-center rounded-lg border border-transparent transition-colors focus-within:ring-[3px] focus-within:ring-ring/40 hover:bg-[var(--oo-row-hover)]">
        <button
          type="button"
          className="grid min-w-0 grid-cols-[2rem_minmax(0,1fr)] items-center gap-3 px-2.5 py-2 text-left outline-none"
          onClick={() => onEnter(folder.path)}
        >
          <div className="grid size-8 place-items-center rounded-md bg-muted/50 text-muted-foreground">
            <Folder className="size-4" />
          </div>
          <div className="min-w-0">
            <div className="oo-text-control truncate font-medium text-foreground">{folder.name}</div>
          </div>
        </button>
        <div className="flex items-center gap-1 pr-2 text-muted-foreground">
          <KnowledgeActionsDropdown actions={actions} className="opacity-70" />
        </div>
      </div>
    </KnowledgeContextMenu>
  )
}

export function KnowledgeRoute({
  currentDirectory,
  knowledge,
  titlebarNavigationVersion,
  onCurrentDirectoryChange,
  onStartChat,
}: {
  currentDirectory: string
  knowledge: UseKnowledgeBases
  titlebarNavigationVersion: number
  onCurrentDirectoryChange: (directory: string) => void
  onStartChat: (item: KnowledgeBaseSummary) => void
}) {
  const t = useT()
  const [query, setQuery] = React.useState("")
  const [selectedId, setSelectedId] = React.useState<string | null>(null)
  const [removeTarget, setRemoveTarget] = React.useState<KnowledgeBaseSummary | null>(null)
  const [renameTarget, setRenameTarget] = React.useState<KnowledgeBaseSummary | null>(null)
  const [renameDraft, setRenameDraft] = React.useState<KnowledgeRenameDraft>({ authors: "", fileName: "", title: "" })
  const [moveTarget, setMoveTarget] = React.useState<KnowledgeBaseSummary | null>(null)
  const [moveDirectory, setMoveDirectory] = React.useState("")
  const [createFolderOpen, setCreateFolderOpen] = React.useState(false)
  const [createFolderName, setCreateFolderName] = React.useState("")
  const [removeFolderTarget, setRemoveFolderTarget] = React.useState<{
    archiveCount: number
    name: string
    path: string
  } | null>(null)
  const [dragActive, setDragActive] = React.useState(false)
  const [pendingImports, setPendingImports] = React.useState<PendingKnowledgeImport[]>([])
  const dragDepthRef = React.useRef(0)
  const previousTitlebarNavigationVersionRef = React.useRef(titlebarNavigationVersion)
  const deferredQuery = React.useDeferredValue(query)

  const view = React.useMemo(
    () =>
      buildKnowledgeLibraryView(
        knowledge.items,
        currentDirectory,
        deferredQuery,
        t("knowledge.rootDirectory"),
        knowledge.folders,
      ),
    [currentDirectory, deferredQuery, knowledge.folders, knowledge.items, t],
  )
  const selected = knowledge.items.find((item) => item.id === selectedId) ?? null
  const narrowPane = selected ? "detail" : "list"
  const activeLabel = view.searchMode
    ? t("knowledge.searchResults")
    : view.currentDirectory || t("knowledge.rootDirectory")
  const visibleCoverage = React.useMemo(
    () => summarizeKnowledgeCoverage(view.archives.map((archive) => archive.item)),
    [view.archives],
  )
  const visiblePendingImports = React.useMemo(() => {
    if (view.searchMode) return []
    return pendingImports.filter((item) => item.directory === view.currentDirectory)
  }, [pendingImports, view.currentDirectory, view.searchMode])
  const folderOptions = React.useMemo(() => ["", ...knowledge.folders], [knowledge.folders])

  React.useEffect(() => {
    if (selectedId && !knowledge.items.some((item) => item.id === selectedId)) {
      setSelectedId(null)
    }
  }, [knowledge.items, selectedId])

  React.useEffect(() => {
    if (previousTitlebarNavigationVersionRef.current === titlebarNavigationVersion) return
    previousTitlebarNavigationVersionRef.current = titlebarNavigationVersion
    setSelectedId(null)
  }, [titlebarNavigationVersion])

  React.useEffect(() => {
    if (!selectedId) return
    const closeOnEscape = (event: KeyboardEvent): void => {
      if (event.key === "Escape") setSelectedId(null)
    }
    window.addEventListener("keydown", closeOnEscape)
    return () => window.removeEventListener("keydown", closeOnEscape)
  }, [selectedId])

  React.useEffect(() => {
    if (!selected || selected.chapters) return
    void knowledge.loadChapters(selected.id)
  }, [knowledge.loadChapters, selected?.chapters, selected?.id])

  const handleImport = async (sourcePath?: string, targetDirectory?: string): Promise<KnowledgeBaseSummary | null> => {
    const imported = await knowledge.importKnowledgeBase(sourcePath, targetDirectory ?? currentDirectory)
    if (imported) {
      setSelectedId(imported.id)
      onCurrentDirectoryChange(imported.relativePath ? knowledgePathDirectory(imported.relativePath) : currentDirectory)
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
      const pendingId = `${selectedPath.path}:${Date.now()}:${Math.random().toString(36).slice(2)}`
      const pendingImport: PendingKnowledgeImport = {
        directory: normalizeKnowledgePath(currentDirectory),
        fileName: selectedPath.name,
        id: pendingId,
      }
      setPendingImports((current) => [...current, pendingImport])
      try {
        lastImported = await handleImport(selectedPath.path, currentDirectory)
      } finally {
        setPendingImports((current) => current.filter((item) => item.id !== pendingId))
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

  const openRenameDialog = (item: KnowledgeBaseSummary): void => {
    setRenameTarget(item)
    setRenameDraft({
      authors: item.authors.join("、"),
      fileName: knowledgeArchiveDisplayName(item.relativePath || item.sourceFileName),
      title: item.title,
    })
  }

  const openMoveDialog = (item: KnowledgeBaseSummary): void => {
    setMoveTarget(item)
    setMoveDirectory(knowledgePathDirectory(item.relativePath))
  }

  const handleCreateFolder = async (): Promise<void> => {
    const folderName = createFolderName.trim()
    const targetPath = normalizeKnowledgePath(currentDirectory ? `${currentDirectory}/${folderName}` : folderName)
    if (!folderName || !targetPath) {
      toast.error(t("knowledge.folderNameRequired"))
      return
    }
    if (knowledgePathExists(knowledge.items, knowledge.folders, targetPath)) {
      toast.error(t("knowledge.pathConflict"))
      return
    }
    const created = await knowledge.createFolder(targetPath)
    if (created) {
      setCreateFolderOpen(false)
      setCreateFolderName("")
      onCurrentDirectoryChange(created)
      setSelectedId(null)
    }
  }

  const handleRename = async (): Promise<void> => {
    if (!renameTarget) return
    const title = renameDraft.title.trim()
    if (!title) {
      toast.error(t("knowledge.archiveTitleRequired"))
      return
    }
    if (!isValidKnowledgeFileName(renameDraft.fileName)) {
      toast.error(t("knowledge.fileNameInvalid"))
      return
    }
    const fileName = stripWikiGraphExtension(renameDraft.fileName)
    const currentFileName = knowledgeArchiveDisplayName(renameTarget.relativePath || renameTarget.sourceFileName)
    const parentPath = knowledgePathDirectory(renameTarget.relativePath)
    const nextFileName = `${fileName}.wikg`
    const nextPath = parentPath ? `${parentPath}/${nextFileName}` : nextFileName
    const fileNameChanged = fileName !== currentFileName
    if (fileNameChanged && knowledgePathExists(knowledge.items, knowledge.folders, nextPath, renameTarget.id)) {
      toast.error(t("knowledge.pathConflict"))
      return
    }
    const renamed = await knowledge.rename(renameTarget.id, {
      authors: parseKnowledgeAuthors(renameDraft.authors),
      ...(fileNameChanged ? { fileName } : {}),
      title,
    })
    if (renamed) {
      setRenameTarget(null)
      setRenameDraft({ authors: "", fileName: "", title: "" })
      setSelectedId(renamed.id)
      onCurrentDirectoryChange(knowledgePathDirectory(renamed.relativePath))
    }
  }

  const handleMove = async (): Promise<void> => {
    if (!moveTarget) return
    const targetDirectory = normalizeKnowledgePath(moveDirectory)
    const fileName = knowledgePathBaseName(moveTarget.relativePath || moveTarget.sourceFileName)
    const nextPath = targetDirectory ? `${targetDirectory}/${fileName}` : fileName
    if (targetDirectory === knowledgePathDirectory(moveTarget.relativePath)) {
      toast.error(t("knowledge.moveSameFolder"))
      return
    }
    if (knowledgePathExists(knowledge.items, knowledge.folders, nextPath, moveTarget.id)) {
      toast.error(t("knowledge.pathConflict"))
      return
    }
    const moved = await knowledge.move(moveTarget.id, targetDirectory)
    if (moved) {
      setMoveTarget(null)
      setMoveDirectory("")
      setSelectedId(moved.id)
      onCurrentDirectoryChange(knowledgePathDirectory(moved.relativePath))
    }
  }

  const handleRemoveFolder = async (): Promise<void> => {
    if (!removeFolderTarget) return
    if (removeFolderTarget.archiveCount > 0) {
      toast.error(t("knowledge.removeFolderNotEmpty"))
      setRemoveFolderTarget(null)
      return
    }
    const removed = await knowledge.removeFolder(removeFolderTarget.path)
    if (removed) {
      if (
        view.currentDirectory === removeFolderTarget.path ||
        view.currentDirectory.startsWith(`${removeFolderTarget.path}/`)
      ) {
        onCurrentDirectoryChange(knowledgePathDirectory(removeFolderTarget.path))
      }
      setRemoveFolderTarget(null)
    }
  }

  const handleNavigate = (path: string): void => {
    onCurrentDirectoryChange(normalizeKnowledgePath(path))
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
        <SplitViewHeader narrowPane={narrowPane} className="oo-border-divider flex items-center border-b">
          <SearchField
            className="max-w-sm min-w-0 flex-1"
            disabled={knowledge.items.length === 0}
            placeholder={
              view.currentDirectory
                ? t("knowledge.searchCurrentDirectory", { directory: knowledgePathBaseName(view.currentDirectory) })
                : t("knowledge.search")
            }
            value={query}
            onChange={(event) => setQuery(event.currentTarget.value)}
          />
          <KnowledgeInspectBadges coverage={visibleCoverage} size="breadcrumb" t={t} />
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="ml-auto"
            disabled={knowledge.busy !== null || view.searchMode}
            onClick={() => setCreateFolderOpen(true)}
          >
            <FolderPlus />
            {knowledge.busy === "create-folder" ? t("knowledge.creatingFolder") : t("knowledge.newFolder")}
          </Button>
          <Button type="button" size="sm" disabled={knowledge.busy !== null} onClick={() => void handleImport()}>
            <Plus />
            {knowledge.busy === "import"
              ? t("knowledge.importing")
              : view.currentDirectory
                ? t("knowledge.importToCurrent")
                : t("knowledge.import")}
          </Button>
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
              onMove={openMoveDialog}
              onRefresh={(id) => void knowledge.refresh(id)}
              onRemove={setRemoveTarget}
              onRemoveFolder={setRemoveFolderTarget}
              onRename={openRenameDialog}
              onReveal={(id) => void knowledge.reveal(id)}
              onSelectArchive={(item) => setSelectedId(item.id)}
              onStartChat={onStartChat}
              pendingImports={visiblePendingImports}
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
                onMove={openMoveDialog}
                onRefresh={(id) => void knowledge.refresh(id)}
                onRemove={setRemoveTarget}
                onRename={openRenameDialog}
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
                onMove={openMoveDialog}
                onRefresh={(id) => void knowledge.refresh(id)}
                onRemove={setRemoveTarget}
                onRename={openRenameDialog}
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

      <ConfirmDialog
        open={removeFolderTarget !== null}
        onOpenChange={(open) => {
          if (!open && knowledge.busy !== "remove-folder") setRemoveFolderTarget(null)
        }}
      >
        <ConfirmDialogContent>
          <ConfirmDialogHeader>
            <ConfirmDialogTitle>{t("knowledge.removeFolderConfirmTitle")}</ConfirmDialogTitle>
            <ConfirmDialogDescription>
              {removeFolderTarget
                ? removeFolderTarget.archiveCount > 0
                  ? t("knowledge.removeFolderBlocked", { name: removeFolderTarget.name })
                  : t("knowledge.removeFolderConfirm", { name: removeFolderTarget.name })
                : ""}
            </ConfirmDialogDescription>
          </ConfirmDialogHeader>
          <ConfirmDialogFooter>
            <ConfirmDialogCancel disabled={knowledge.busy === "remove-folder"}>
              {t("common.cancel")}
            </ConfirmDialogCancel>
            <ConfirmDialogAction
              disabled={knowledge.busy === "remove-folder" || (removeFolderTarget?.archiveCount ?? 0) > 0}
              onClick={() => void handleRemoveFolder()}
            >
              {t("knowledge.removeFolder")}
            </ConfirmDialogAction>
          </ConfirmDialogFooter>
        </ConfirmDialogContent>
      </ConfirmDialog>

      <KnowledgeTextDialog
        busy={knowledge.busy === "create-folder"}
        description={t("knowledge.newFolderDescription", {
          directory: view.currentDirectory || t("knowledge.rootDirectory"),
        })}
        label={t("knowledge.folderName")}
        open={createFolderOpen}
        title={t("knowledge.newFolder")}
        value={createFolderName}
        onClose={() => {
          if (knowledge.busy !== "create-folder") setCreateFolderOpen(false)
        }}
        onSubmit={() => void handleCreateFolder()}
        onValueChange={setCreateFolderName}
      />

      <KnowledgeArchiveRenameDialog
        busy={knowledge.busy === "rename"}
        draft={renameDraft}
        open={renameTarget !== null}
        target={renameTarget}
        onClose={() => {
          if (knowledge.busy !== "rename") setRenameTarget(null)
        }}
        onSubmit={() => void handleRename()}
        onDraftChange={setRenameDraft}
      />

      <Dialog
        open={moveTarget !== null}
        title={t("knowledge.move")}
        description={moveTarget ? t("knowledge.moveDescription", { title: moveTarget.title }) : ""}
        onClose={() => {
          if (knowledge.busy !== "move") setMoveTarget(null)
        }}
        footer={
          <div className="flex justify-end gap-2">
            <Button
              type="button"
              variant="ghost"
              disabled={knowledge.busy === "move"}
              onClick={() => setMoveTarget(null)}
            >
              {t("common.cancel")}
            </Button>
            <Button type="button" disabled={knowledge.busy === "move"} onClick={() => void handleMove()}>
              {t("knowledge.move")}
            </Button>
          </div>
        }
      >
        <div className="grid gap-2 px-5 pb-5">
          <Label htmlFor="knowledge-move-target">{t("knowledge.targetFolder")}</Label>
          <select
            id="knowledge-move-target"
            className="h-9 rounded-md border border-input bg-background px-3 text-sm"
            disabled={knowledge.busy === "move"}
            value={moveDirectory}
            onChange={(event) => setMoveDirectory(event.currentTarget.value)}
          >
            {folderOptions.map((folder) => (
              <option key={folder || "__root__"} value={folder}>
                {folder || t("knowledge.rootDirectory")}
              </option>
            ))}
          </select>
        </div>
      </Dialog>
    </div>
  )
}

function KnowledgeTextDialog({
  busy,
  description,
  label,
  open,
  title,
  value,
  onClose,
  onSubmit,
  onValueChange,
}: {
  busy: boolean
  description: string
  label: string
  open: boolean
  title: string
  value: string
  onClose: () => void
  onSubmit: () => void
  onValueChange: (value: string) => void
}) {
  const t = useT()
  const inputId = React.useId()
  return (
    <Dialog
      open={open}
      title={title}
      description={description}
      onClose={onClose}
      footer={
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" disabled={busy} onClick={onClose}>
            {t("common.cancel")}
          </Button>
          <Button type="button" disabled={busy} onClick={onSubmit}>
            {title}
          </Button>
        </div>
      }
    >
      <form
        className="grid gap-2 px-5 pb-5"
        onSubmit={(event) => {
          event.preventDefault()
          onSubmit()
        }}
      >
        <Label htmlFor={inputId}>{label}</Label>
        <Input
          id={inputId}
          disabled={busy}
          value={value}
          onChange={(event) => onValueChange(event.currentTarget.value)}
        />
      </form>
    </Dialog>
  )
}

function KnowledgeArchiveRenameDialog({
  busy,
  draft,
  open,
  target,
  onClose,
  onDraftChange,
  onSubmit,
}: {
  busy: boolean
  draft: KnowledgeRenameDraft
  open: boolean
  target: KnowledgeBaseSummary | null
  onClose: () => void
  onDraftChange: (draft: KnowledgeRenameDraft) => void
  onSubmit: () => void
}) {
  const t = useT()
  const titleId = React.useId()
  const authorsId = React.useId()
  const fileNameId = React.useId()
  const setDraftField = (field: keyof KnowledgeRenameDraft) => (event: React.ChangeEvent<HTMLInputElement>) => {
    onDraftChange({ ...draft, [field]: event.currentTarget.value })
  }
  return (
    <Dialog
      open={open}
      title={t("knowledge.rename")}
      description={target ? t("knowledge.renameDescription", { title: target.title }) : ""}
      className="max-w-2xl"
      onClose={onClose}
      footer={
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" disabled={busy} onClick={onClose}>
            {t("common.cancel")}
          </Button>
          <Button type="button" disabled={busy} onClick={onSubmit}>
            {t("common.save")}
          </Button>
        </div>
      }
    >
      <form
        className="grid gap-5 px-5 pb-5 sm:grid-cols-[7rem_minmax(0,1fr)]"
        onSubmit={(event) => {
          event.preventDefault()
          onSubmit()
        }}
      >
        <div className="mx-auto w-24 sm:mx-0">
          {target ? <KnowledgeCover item={target} className="w-full shadow-xs" /> : null}
        </div>
        <div className="grid min-w-0 gap-3">
          <div className="grid gap-1.5">
            <Label htmlFor={titleId}>{t("knowledge.archiveTitle")}</Label>
            <Input id={titleId} disabled={busy} value={draft.title} onChange={setDraftField("title")} />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor={authorsId}>{t("knowledge.authors")}</Label>
            <Input id={authorsId} disabled={busy} value={draft.authors} onChange={setDraftField("authors")} />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor={fileNameId}>{t("knowledge.fileName")}</Label>
            <Input id={fileNameId} disabled={busy} value={draft.fileName} onChange={setDraftField("fileName")} />
          </div>
        </div>
      </form>
    </Dialog>
  )
}

function KnowledgeLibraryContent({
  activeLabel,
  busy,
  error,
  loading,
  onEnterDirectory,
  onImport,
  onMove,
  onRefresh,
  onRemove,
  onRemoveFolder,
  onRename,
  onReveal,
  onSelectArchive,
  onStartChat,
  pendingImports,
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
  onMove: (item: KnowledgeBaseSummary) => void
  onRefresh: (id: string) => void
  onRemove: (item: KnowledgeBaseSummary) => void
  onRemoveFolder: (folder: { archiveCount: number; name: string; path: string }) => void
  onRename: (item: KnowledgeBaseSummary) => void
  onReveal: (id: string) => void
  onSelectArchive: (item: KnowledgeBaseSummary) => void
  onStartChat: (item: KnowledgeBaseSummary) => void
  pendingImports: PendingKnowledgeImport[]
  query: string
  selectedId: string | null
  t: ReturnType<typeof useT>
  view: ReturnType<typeof buildKnowledgeLibraryView>
}) {
  if (loading) {
    return <KnowledgeGridSkeleton />
  }

  const noItems = view.directories.length === 0 && view.archives.length === 0 && pendingImports.length === 0
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

  const compactRows = selectedId !== null

  return (
    <div className="grid gap-3">
      <div className="grid gap-2">
        {pendingImports.map((item) => (
          <PendingKnowledgeArchiveRow key={item.id} compact={compactRows} item={item} t={t} />
        ))}
        {view.directories.map((folder) => (
          <KnowledgeFolderRow
            key={folder.path}
            busy={busy}
            folder={folder}
            onEnter={onEnterDirectory}
            onRemove={onRemoveFolder}
            t={t}
          />
        ))}
        {view.archives.map((archive) => (
          <KnowledgeArchiveRow
            key={archive.item.id}
            archive={archive.item}
            busy={busy}
            compact={compactRows}
            selected={selectedId === archive.item.id}
            onMove={onMove}
            onRefresh={onRefresh}
            onRemove={onRemove}
            onRename={onRename}
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
  onMove,
  onStartChat,
  onRefresh,
  onRemove,
  onRename,
  onReveal,
}: {
  busy: UseKnowledgeBases["busy"]
  item: KnowledgeBaseSummary
  onClose: () => void
  onMove: (item: KnowledgeBaseSummary) => void
  onStartChat: (item: KnowledgeBaseSummary) => void
  onRefresh: (id: string) => void
  onRemove: (item: KnowledgeBaseSummary) => void
  onRename: (item: KnowledgeBaseSummary) => void
  onReveal: (id: string) => void
}) {
  const t = useT()
  const disabled = busy !== null
  const actions = knowledgeActions({ busy, item, onMove, onRefresh, onRemove, onRename, onReveal, onStartChat, t })
  const fileDisplayName = knowledgeArchiveDisplayName(item.relativePath || item.sourceFileName)

  return (
    <KnowledgeContextMenu actions={actions}>
      <div className="relative flex h-full min-h-0 flex-col">
        <div className="absolute -top-1 -right-1 z-10 flex items-center gap-0.5">
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

        <div className="min-h-0 flex-1 overflow-y-auto pr-1">
          <div className="pr-8">
            <div className="min-w-0">
              <div className="oo-text-label line-clamp-3 text-foreground">{item.title}</div>
              {item.authors.length > 0 ? (
                <p className="oo-text-caption mt-1 truncate">{item.authors.join("、")}</p>
              ) : null}
              {item.publisher ? <p className="oo-text-caption truncate">{item.publisher}</p> : null}
              <p className="oo-text-caption mt-1 truncate text-muted-foreground">{fileDisplayName}</p>
              {item.statistics.sourceWords ? (
                <p className="oo-text-caption mt-1 truncate text-muted-foreground">
                  {t("knowledge.wordCount", { count: item.statistics.sourceWords.toLocaleString() })}
                </p>
              ) : null}
            </div>

            <div className="mt-5">
              <KnowledgeDetailInspectRows coverage={item.coverage} t={t} />
            </div>
          </div>

          {item.chapters?.length ? (
            <div className="mt-4 border-t border-[var(--oo-divider)] pt-3">
              <div className="rounded-md bg-[radial-gradient(circle,var(--oo-divider)_1px,transparent_1px)] bg-[length:2rem_2rem] px-2 py-1">
                <KnowledgeChapterTree chapters={item.chapters} />
              </div>
            </div>
          ) : null}
        </div>

        <div className="shrink-0 pt-3">
          <Button type="button" className="w-full" disabled={disabled} onClick={() => onStartChat(item)}>
            <MessageSquarePlus />
            {t("knowledge.startChat")}
          </Button>
        </div>
      </div>
    </KnowledgeContextMenu>
  )
}
