import type {
  ChatMessage,
  TurnFileDiffResult,
  TurnOutputFile,
  TurnOutputRecord,
  TurnOutputFileRole,
} from "../../../electron/chat/common.ts"
import type { ChangeData, FileData, ViewType } from "react-diff-view"

import {
  CheckIcon,
  ChevronDown,
  ChevronRight,
  CopyIcon,
  ExternalLink,
  FileCode2,
  FileDiff,
  FolderOpen,
  Maximize2,
  Minimize2,
  PanelRightClose,
} from "lucide-react"
import * as React from "react"
import { Diff as ReactDiff, Hunk, parseDiff } from "react-diff-view"
import "react-diff-view/style/index.css"

import { toast } from "sonner"
import { useChatService } from "@/components/AppContext"
import { useT } from "@/i18n/i18n"
import { writeClipboardText } from "@/lib/clipboard"
import { reportRendererHandledError } from "@/lib/renderer-diagnostics"
import { resolveUserFacingError, userFacingErrorDescription } from "@/lib/user-facing-error"
import { cn } from "@/lib/utils"
import { FileKindTile } from "@/routes/Chat/file-type-icons"

export interface TurnOutputSelection {
  initialRole?: Exclude<TurnOutputFileRole, "artifact">
  record: TurnOutputRecord
  selectedPath?: string
}

interface GeneratedTurnOutputsProps {
  isGenerating: boolean
  messages: ChatMessage[]
  onAvailable: (selection: TurnOutputSelection) => void
  onOpen: (selection: TurnOutputSelection) => void
  sessionId: string | null
}

interface TurnOutputsPanelProps {
  maximized: boolean
  onCollapse: () => void
  onToggleMaximized: () => void
  selection: TurnOutputSelection | null
}

function assistantMessageIds(messages: ChatMessage[]): string[] {
  return messages.filter((message) => message.role === "assistant").map((message) => message.id)
}

function visibleRecords(records: TurnOutputRecord[]): TurnOutputRecord[] {
  return records.filter((record) => record.summary.changedFileCount > 0 || record.summary.processFileCount > 0)
}

function recordSortValue(record: TurnOutputRecord): number {
  return record.completedAt ?? record.createdAt
}

function roleFiles(record: TurnOutputRecord, role: Exclude<TurnOutputFileRole, "artifact">): TurnOutputFile[] {
  return record.files.filter((file) => file.role === role)
}

function ChangeCountLabel({
  additions,
  className,
  deletions,
}: {
  additions: number
  className?: string
  deletions: number
}) {
  if (additions === 0 && deletions === 0) {
    return null
  }
  return (
    <span className={cn("oo-text-caption-compact inline-flex min-w-0 items-center gap-1", className)}>
      <span className="font-medium text-[color:var(--success)]">+{additions}</span>
      <span className="font-medium text-[color:var(--destructive)]">-{deletions}</span>
    </span>
  )
}

function useTurnOutputRecords(
  sessionId: string | null,
  messages: ChatMessage[],
  isGenerating: boolean,
): TurnOutputRecord[] {
  const chatService = useChatService()
  const [records, setRecords] = React.useState<TurnOutputRecord[]>([])
  const [refreshToken, setRefreshToken] = React.useState(0)
  const messageIds = React.useMemo(() => assistantMessageIds(messages).slice(-40), [messages])
  const key = messageIds.join("\n")

  React.useEffect(() => {
    return chatService.serverEvents.on("turnOutputUpdated", (event) => {
      if (!sessionId || event.sessionId === sessionId) {
        setRefreshToken((value) => value + 1)
      }
    })
  }, [chatService, sessionId])

  React.useEffect(() => {
    let cancelled = false
    if (!sessionId || isGenerating || messageIds.length === 0) {
      setRecords([])
      return
    }
    void Promise.all(messageIds.map((messageId) => chatService.invoke("getTurnOutput", { sessionId, messageId })))
      .then((results) => {
        if (cancelled) {
          return
        }
        setRecords(
          visibleRecords(results.filter((record): record is TurnOutputRecord => Boolean(record))).sort(
            (a, b) => recordSortValue(a) - recordSortValue(b),
          ),
        )
      })
      .catch(() => {
        if (!cancelled) {
          setRecords([])
        }
      })
    return () => {
      cancelled = true
    }
  }, [chatService, isGenerating, key, messageIds, refreshToken, sessionId])

  return records
}

export function GeneratedTurnOutputs({
  isGenerating,
  messages,
  onAvailable,
  onOpen,
  sessionId,
}: GeneratedTurnOutputsProps) {
  const t = useT()
  const records = useTurnOutputRecords(sessionId, messages, isGenerating)

  React.useEffect(() => {
    const latest = records.at(-1)
    if (latest) {
      const initialRole = latest.summary.changedFileCount > 0 ? "project_change" : "process"
      onAvailable({ record: latest, initialRole })
    }
  }, [onAvailable, records])

  if (records.length === 0) {
    return null
  }

  return (
    <section className="not-prose -mt-1 grid gap-1.5">
      <div className="oo-text-caption-compact font-medium text-muted-foreground">{t("turnOutputs.title")}</div>
      <div className="grid gap-1.5">
        {records.map((record) => (
          <TurnOutputSummaryRow key={`${record.sessionId}:${record.messageId}`} record={record} onOpen={onOpen} />
        ))}
      </div>
    </section>
  )
}

function TurnOutputSummaryRow({
  record,
  onOpen,
}: {
  record: TurnOutputRecord
  onOpen: (selection: TurnOutputSelection) => void
}) {
  const t = useT()
  const hasProjectChanges = record.summary.changedFileCount > 0
  const hasProcessFiles = record.summary.processFileCount > 0
  const splitSummary = hasProjectChanges && hasProcessFiles

  return (
    <div className={cn("grid gap-1.5", splitSummary && "sm:grid-cols-2")}>
      {hasProjectChanges ? (
        <button
          type="button"
          className="oo-border-divider flex min-h-12 min-w-0 items-center gap-2 rounded-md border bg-muted/45 px-3 text-left transition-colors hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
          onClick={() => onOpen({ record, initialRole: "project_change" })}
        >
          <span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-background text-muted-foreground">
            <FileDiff className="size-4" />
          </span>
          <span className="flex min-w-0 flex-1 items-center gap-3">
            <span className="oo-text-label min-w-0 flex-1 truncate text-foreground">
              {t("turnOutputs.changesSummary", { count: record.summary.changedFileCount })}
            </span>
            <ChangeCountLabel
              additions={record.summary.additions}
              className="shrink-0 justify-end"
              deletions={record.summary.deletions}
            />
          </span>
        </button>
      ) : null}
      {hasProcessFiles ? (
        <button
          type="button"
          className="oo-border-divider flex min-h-12 min-w-0 items-center gap-2 rounded-md border bg-muted/45 px-3 text-left transition-colors hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
          onClick={() => onOpen({ record, initialRole: "process" })}
        >
          <span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-background text-muted-foreground">
            <FileCode2 className="size-4" />
          </span>
          <span className="min-w-0 flex-1">
            <span className="oo-text-label block truncate text-foreground">
              {t("turnOutputs.processSummary", { count: record.summary.processFileCount })}
            </span>
            <span className="oo-text-caption-compact block truncate text-muted-foreground">
              {t("turnOutputs.reviewProcessFiles")}
            </span>
          </span>
        </button>
      ) : null}
    </div>
  )
}

function useTurnFileDiff(
  selection: TurnOutputSelection | null,
  selectedPath: string | null,
): TurnFileDiffResult | null {
  const chatService = useChatService()
  const [diff, setDiff] = React.useState<TurnFileDiffResult | null>(null)

  React.useEffect(() => {
    let cancelled = false
    setDiff(null)
    if (!selection || !selectedPath) {
      return
    }
    void chatService
      .invoke("getTurnFileDiff", {
        sessionId: selection.record.sessionId,
        messageId: selection.record.messageId,
        path: selectedPath,
      })
      .then((result) => {
        if (!cancelled) {
          setDiff(result)
        }
      })
      .catch((error: unknown) => {
        reportRendererHandledError("turnOutputs.loadDiff", "Failed to load turn file diff", error)
      })
    return () => {
      cancelled = true
    }
  }, [chatService, selectedPath, selection])

  return diff
}

function useTurnFileActions(): {
  openPath: (filePath: string | undefined) => void
  showInFolder: (filePath: string | undefined) => void
} {
  const t = useT()
  const chatService = useChatService()
  return React.useMemo(
    () => ({
      openPath(filePath) {
        if (!filePath) {
          return
        }
        void chatService.invoke("openLocalPath", { path: filePath }).catch((cause: unknown) => {
          reportRendererHandledError("turnOutputs.openPath", "Failed to open turn output file", cause)
          const error = resolveUserFacingError(cause, { area: "artifact" })
          toast.error(userFacingErrorDescription(error, t))
        })
      },
      showInFolder(filePath) {
        if (!filePath) {
          return
        }
        void chatService.invoke("showLocalPathInFolder", { path: filePath }).catch((cause: unknown) => {
          reportRendererHandledError("turnOutputs.showInFolder", "Failed to reveal turn output file", cause)
          const error = resolveUserFacingError(cause, { area: "artifact" })
          toast.error(userFacingErrorDescription(error, t))
        })
      },
    }),
    [chatService, t],
  )
}

export function TurnOutputsPanel({ maximized, onCollapse, onToggleMaximized, selection }: TurnOutputsPanelProps) {
  const t = useT()
  const MaximizeIcon = maximized ? Minimize2 : Maximize2
  const initialRole = selection?.initialRole ?? "project_change"
  const [viewType, setViewType] = React.useState<ViewType>("split")
  const [collapsedPaths, setCollapsedPaths] = React.useState<Set<string>>(() => new Set())
  const processFiles = React.useMemo(() => (selection ? roleFiles(selection.record, "process") : []), [selection])
  const changeFiles = React.useMemo(() => (selection ? roleFiles(selection.record, "project_change") : []), [selection])
  const activeRole = initialRole === "process" && processFiles.length > 0 ? "process" : "project_change"
  const activeFiles = activeRole === "project_change" ? changeFiles : processFiles
  const { openPath, showInFolder } = useTurnFileActions()
  const allCollapsed = activeFiles.length > 0 && activeFiles.every((file) => collapsedPaths.has(file.path))
  const activeAdditions = activeFiles.reduce((sum, file) => sum + file.additions, 0)
  const activeDeletions = activeFiles.reduce((sum, file) => sum + file.deletions, 0)

  React.useEffect(() => {
    setCollapsedPaths(new Set(activeRole === "process" ? activeFiles.map((file) => file.path) : []))
  }, [activeFiles, activeRole, selection?.record.messageId])

  const togglePath = React.useCallback((path: string) => {
    setCollapsedPaths((current) => {
      const next = new Set(current)
      if (next.has(path)) {
        next.delete(path)
      } else {
        next.add(path)
      }
      return next
    })
  }, [])

  const setAllCollapsed = React.useCallback(
    (collapsed: boolean) => {
      setCollapsedPaths(collapsed ? new Set(activeFiles.map((file) => file.path)) : new Set())
    },
    [activeFiles],
  )

  return (
    <aside
      className={cn(
        "oo-border-divider flex h-full min-h-0 w-full flex-col border-l bg-background",
        maximized && "border-l-0",
      )}
    >
      <header className="oo-titlebar oo-artifacts-titlebar oo-border-divider flex h-[var(--app-titlebar-height)] shrink-0 items-center justify-between gap-3 border-b [-webkit-app-region:drag]">
        <div className="oo-text-title min-w-0 truncate">{t("turnOutputs.panelTitle")}</div>
        <div className="flex shrink-0 items-center gap-1 [-webkit-app-region:no-drag]">
          <button
            type="button"
            title={maximized ? t("artifacts.restore") : t("artifacts.maximize")}
            aria-label={maximized ? t("artifacts.restore") : t("artifacts.maximize")}
            aria-pressed={maximized}
            className="oo-toolbar-button flex size-8 shrink-0 items-center justify-center rounded-md hover:bg-accent hover:text-foreground focus-visible:bg-accent focus-visible:text-foreground"
            onClick={onToggleMaximized}
          >
            <MaximizeIcon className="size-4" />
          </button>
          <button
            type="button"
            title={t("artifacts.collapse")}
            aria-label={t("artifacts.collapse")}
            className="oo-toolbar-button flex size-8 shrink-0 items-center justify-center rounded-md hover:bg-accent hover:text-foreground focus-visible:bg-accent focus-visible:text-foreground"
            onClick={onCollapse}
          >
            <PanelRightClose className="size-4" />
          </button>
        </div>
      </header>

      <div className="oo-turn-review-scroll min-h-0 flex-1 overflow-x-hidden overflow-y-auto">
        <section className="min-w-0 pb-3">
          {activeFiles.length > 0 ? (
            <div className="oo-border-divider sticky top-0 z-20 flex h-12 items-center justify-between gap-3 border-b bg-background/95 px-4 backdrop-blur">
              <div className="flex min-w-0 items-center gap-3">
                <div className="oo-text-label min-w-0 truncate">
                  {activeRole === "project_change"
                    ? t("turnOutputs.changesSummary", { count: activeFiles.length })
                    : t("turnOutputs.processSummary", { count: activeFiles.length })}
                </div>
                <ChangeCountLabel additions={activeAdditions} className="shrink-0" deletions={activeDeletions} />
              </div>
              <div className="flex shrink-0 items-center gap-1.5">
                <DiffViewModeToggle value={viewType} onChange={setViewType} />
                <CopyAllPatchesButton files={activeFiles} selection={selection} />
                <button
                  type="button"
                  title={allCollapsed ? t("turnOutputs.expandAll") : t("turnOutputs.collapseAll")}
                  aria-label={allCollapsed ? t("turnOutputs.expandAll") : t("turnOutputs.collapseAll")}
                  className="oo-toolbar-button flex h-7 shrink-0 items-center rounded-md px-2 hover:bg-accent hover:text-foreground focus-visible:bg-accent focus-visible:text-foreground"
                  onClick={() => setAllCollapsed(!allCollapsed)}
                >
                  <span className="oo-text-caption-compact">
                    {allCollapsed ? t("turnOutputs.expandAll") : t("turnOutputs.collapseAll")}
                  </span>
                </button>
              </div>
            </div>
          ) : null}
          {activeRole === "process" && processFiles.length > 0 ? (
            <div className="oo-text-caption border-b bg-muted/45 px-4 py-1.5 text-muted-foreground">
              {t("turnOutputs.processCaution")}
            </div>
          ) : null}
          {activeFiles.length > 0 ? (
            <div className="oo-turn-diff-stream min-w-0">
              {activeFiles.map((file) => (
                <TurnDiffFileSection
                  key={file.path}
                  collapsed={collapsedPaths.has(file.path)}
                  file={file}
                  onToggle={() => togglePath(file.path)}
                  openPath={openPath}
                  selection={selection}
                  showInFolder={showInFolder}
                  viewType={viewType}
                />
              ))}
            </div>
          ) : (
            <div className="oo-text-body px-2 py-8 text-center text-muted-foreground">{t("turnOutputs.empty")}</div>
          )}
        </section>
      </div>
    </aside>
  )
}

function changeKindLabel(t: ReturnType<typeof useT>, file: TurnOutputFile): string {
  switch (file.changeKind) {
    case "added":
      return t("turnOutputs.added")
    case "deleted":
      return t("turnOutputs.deleted")
    default:
      return t("turnOutputs.modified")
  }
}

function reviewFileDisplayPath(filePath: string): string {
  const normalized = filePath.replaceAll("\\", "/")
  const codeIndex = normalized.indexOf("/code/")
  if (codeIndex >= 0) {
    const fromProject = normalized.slice(codeIndex + "/code/".length)
    if (fromProject) {
      return fromProject
    }
  }
  const parts = normalized.split("/").filter(Boolean)
  return parts.slice(-2).join("/") || filePath
}

function TurnDiffFileSection({
  collapsed,
  file,
  onToggle,
  openPath,
  selection,
  showInFolder,
  viewType,
}: {
  collapsed: boolean
  file: TurnOutputFile
  onToggle: () => void
  openPath: (filePath: string | undefined) => void
  selection: TurnOutputSelection | null
  showInFolder: (filePath: string | undefined) => void
  viewType: ViewType
}) {
  const t = useT()
  const diff = useTurnFileDiff(selection, collapsed ? null : file.path)
  const hasDiffCounts = file.additions > 0 || file.deletions > 0
  const ToggleIcon = collapsed ? ChevronRight : ChevronDown
  const displayPath = reviewFileDisplayPath(file.path)

  return (
    <section className="oo-turn-diff-file min-w-0 bg-background">
      <div className="oo-turn-diff-file-header sticky top-12 z-10 flex min-h-10 min-w-0 items-center justify-between gap-2 bg-background/95 px-4 backdrop-blur">
        <button
          type="button"
          title={file.path}
          className="flex min-w-0 flex-1 items-center gap-2 rounded-md py-1.5 text-left hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
          onClick={onToggle}
        >
          <ToggleIcon className="size-4 shrink-0 text-muted-foreground" />
          <FileKindTile source={{ ...file, kind: "file" }} className="size-7" iconClassName="size-3.5" />
          <span className="oo-text-label min-w-0 flex-1 truncate font-mono text-foreground">{displayPath}</span>
          {hasDiffCounts ? (
            <ChangeCountLabel additions={file.additions} className="shrink-0" deletions={file.deletions} />
          ) : (
            <span className="oo-text-caption-compact shrink-0 text-muted-foreground">{changeKindLabel(t, file)}</span>
          )}
        </button>
        <div className="flex shrink-0 items-center gap-1">
          <button
            type="button"
            title={t("artifacts.showInFolder")}
            aria-label={t("artifacts.showInFolder")}
            className="oo-toolbar-button flex size-7 shrink-0 items-center justify-center rounded-md hover:bg-accent hover:text-foreground focus-visible:bg-accent focus-visible:text-foreground"
            onClick={() => showInFolder(file.path)}
          >
            <FolderOpen className="size-3.5" />
          </button>
          <button
            type="button"
            title={t("artifacts.openFile")}
            aria-label={t("artifacts.openFile")}
            className="oo-toolbar-button flex size-7 shrink-0 items-center justify-center rounded-md hover:bg-accent hover:text-foreground focus-visible:bg-accent focus-visible:text-foreground"
            onClick={() => openPath(file.path)}
          >
            <ExternalLink className="size-3.5" />
          </button>
          {diff?.kind === "text" && diff.patch ? <CopyPatchButton patch={diff.patch} /> : null}
        </div>
      </div>
      {collapsed ? null : <TurnDiffBody diff={diff} viewType={viewType} />}
    </section>
  )
}

function useParsedDiff(patch: string | undefined): FileData[] {
  return React.useMemo(() => {
    if (!patch) {
      return []
    }
    try {
      return parseDiff(patch, { nearbySequences: "zip" })
    } catch {
      return []
    }
  }, [patch])
}

function CopyPatchButton({ patch }: { patch: string }) {
  const t = useT()
  const [copied, setCopied] = React.useState(false)
  const copiedTimerRef = React.useRef<number | null>(null)

  React.useEffect(() => {
    return () => {
      if (copiedTimerRef.current !== null) {
        window.clearTimeout(copiedTimerRef.current)
      }
    }
  }, [])

  const copy = async (): Promise<void> => {
    if (!(await writeClipboardText(patch))) {
      toast.error(t("error.copyFailed"))
      return
    }
    setCopied(true)
    if (copiedTimerRef.current !== null) {
      window.clearTimeout(copiedTimerRef.current)
    }
    copiedTimerRef.current = window.setTimeout(() => {
      setCopied(false)
      copiedTimerRef.current = null
    }, 1200)
  }

  const Icon = copied ? CheckIcon : CopyIcon
  return (
    <button
      type="button"
      title={copied ? t("chat.copiedMessage") : t("turnOutputs.copyPatch")}
      aria-label={copied ? t("chat.copiedMessage") : t("turnOutputs.copyPatch")}
      className="oo-toolbar-button flex size-7 shrink-0 items-center justify-center rounded-md hover:bg-accent hover:text-foreground focus-visible:bg-accent focus-visible:text-foreground"
      onClick={() => void copy()}
    >
      <Icon className="size-3.5" />
    </button>
  )
}

function CopyAllPatchesButton({
  files,
  selection,
}: {
  files: TurnOutputFile[]
  selection: TurnOutputSelection | null
}) {
  const t = useT()
  const chatService = useChatService()
  const [copying, setCopying] = React.useState(false)

  const copy = async (): Promise<void> => {
    if (!selection || files.length === 0 || copying) {
      return
    }
    setCopying(true)
    try {
      const diffs = await Promise.all(
        files.map((file) =>
          chatService.invoke("getTurnFileDiff", {
            sessionId: selection.record.sessionId,
            messageId: selection.record.messageId,
            path: file.path,
          }),
        ),
      )
      const patch = diffs
        .filter((diff): diff is TurnFileDiffResult & { patch: string } => diff.kind === "text" && Boolean(diff.patch))
        .map((diff) => diff.patch)
        .join("\n")
      if (!patch || !(await writeClipboardText(patch))) {
        toast.error(t("error.copyFailed"))
        return
      }
      toast.success(t("turnOutputs.copyAllDone"))
    } catch {
      toast.error(t("error.copyFailed"))
    } finally {
      setCopying(false)
    }
  }

  return (
    <button
      type="button"
      title={t("turnOutputs.copyAllPatches")}
      aria-label={t("turnOutputs.copyAllPatches")}
      disabled={copying || files.length === 0}
      className="oo-toolbar-button flex size-7 shrink-0 items-center justify-center rounded-md hover:bg-accent hover:text-foreground focus-visible:bg-accent focus-visible:text-foreground disabled:cursor-default disabled:opacity-45"
      onClick={() => void copy()}
    >
      <CopyIcon className="size-3.5" />
    </button>
  )
}

function DiffViewModeToggle({ onChange, value }: { onChange: (value: ViewType) => void; value: ViewType }) {
  const t = useT()
  return (
    <div className="oo-border-divider flex h-7 shrink-0 items-center overflow-hidden rounded-md border bg-muted/45 p-0.5">
      {(["split", "unified"] as const).map((mode) => (
        <button
          key={mode}
          type="button"
          className={cn(
            "oo-text-caption-compact inline-flex h-full items-center justify-center rounded px-2 transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
            value === mode ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
          )}
          onClick={() => onChange(mode)}
        >
          {mode === "unified" ? t("turnOutputs.unifiedDiff") : t("turnOutputs.splitDiff")}
        </button>
      ))}
    </div>
  )
}

function RawPatchFallback({ patch }: { patch: string }) {
  return (
    <pre className="oo-text-caption min-h-full bg-muted/20 p-3 font-mono whitespace-pre text-foreground">{patch}</pre>
  )
}

interface SplitDiffRow {
  key: string
  newChange: ChangeData | null
  oldChange: ChangeData | null
}

function changeKey(change: ChangeData | null): string {
  if (!change) {
    return "empty"
  }
  if (change.type === "normal") {
    return `normal:${change.oldLineNumber}:${change.newLineNumber}`
  }
  return `${change.type}:${change.lineNumber}:${change.content}`
}

function splitRows(changes: ChangeData[]): SplitDiffRow[] {
  const rows: SplitDiffRow[] = []
  for (let index = 0; index < changes.length; index++) {
    const current = changes[index]
    if (!current) {
      continue
    }
    if (current.type === "normal") {
      rows.push({
        key: `${changeKey(current)}:${changeKey(current)}`,
        oldChange: current,
        newChange: current,
      })
      continue
    }
    if (current.type === "delete") {
      const next = changes[index + 1]
      if (next?.type === "insert") {
        index += 1
        rows.push({
          key: `${changeKey(current)}:${changeKey(next)}`,
          oldChange: current,
          newChange: next,
        })
      } else {
        rows.push({
          key: `${changeKey(current)}:empty`,
          oldChange: current,
          newChange: null,
        })
      }
      continue
    }
    rows.push({
      key: `empty:${changeKey(current)}`,
      oldChange: null,
      newChange: current,
    })
  }
  return rows
}

function splitLineNumber(change: ChangeData | null, side: "new" | "old"): number | null {
  if (!change) {
    return null
  }
  if (change.type === "normal") {
    return side === "old" ? change.oldLineNumber : change.newLineNumber
  }
  if (side === "old" && change.type === "delete") {
    return change.lineNumber
  }
  if (side === "new" && change.type === "insert") {
    return change.lineNumber
  }
  return null
}

function splitLineClass(change: ChangeData | null): string {
  if (!change) {
    return "oo-turn-split-line-empty"
  }
  if (change.type === "delete") {
    return "oo-turn-split-line-delete"
  }
  if (change.type === "insert") {
    return "oo-turn-split-line-insert"
  }
  return "oo-turn-split-line-normal"
}

function SplitDiffLine({ change, side }: { change: ChangeData | null; side: "new" | "old" }) {
  const lineNumber = splitLineNumber(change, side)
  const content = change?.content ?? ""
  return (
    <div className={cn("oo-turn-split-line", splitLineClass(change))}>
      <div className="oo-turn-split-gutter">{lineNumber ?? ""}</div>
      <div className="oo-turn-split-code">{content.length > 0 ? content : " "}</div>
    </div>
  )
}

function SplitDiffSide({
  onScroll,
  rows,
  scrollRef,
  side,
}: {
  onScroll: (event: React.UIEvent<HTMLDivElement>) => void
  rows: SplitDiffRow[]
  scrollRef: React.RefObject<HTMLDivElement | null>
  side: "new" | "old"
}) {
  return (
    <div className="oo-turn-split-side">
      <div ref={scrollRef} className="oo-turn-split-side-scroll" onScroll={onScroll}>
        {rows.map((row) => (
          <SplitDiffLine
            key={`${side}:${row.key}`}
            change={side === "old" ? row.oldChange : row.newChange}
            side={side}
          />
        ))}
      </div>
    </div>
  )
}

function SplitDiffFile({ file }: { file: FileData }) {
  const leftRef = React.useRef<HTMLDivElement | null>(null)
  const rightRef = React.useRef<HTMLDivElement | null>(null)
  const syncingRef = React.useRef(false)
  const rows = React.useMemo(() => file.hunks.flatMap((hunk) => splitRows(hunk.changes)), [file.hunks])

  const syncScroll = React.useCallback((source: "left" | "right", scrollLeft: number) => {
    if (syncingRef.current) {
      return
    }
    const target = source === "left" ? rightRef.current : leftRef.current
    if (!target || target.scrollLeft === scrollLeft) {
      return
    }
    syncingRef.current = true
    target.scrollLeft = scrollLeft
    window.requestAnimationFrame(() => {
      syncingRef.current = false
    })
  }, [])

  return (
    <div className="oo-turn-split-diff">
      <SplitDiffSide
        rows={rows}
        scrollRef={leftRef}
        side="old"
        onScroll={(event) => syncScroll("left", event.currentTarget.scrollLeft)}
      />
      <SplitDiffSide
        rows={rows}
        scrollRef={rightRef}
        side="new"
        onScroll={(event) => syncScroll("right", event.currentTarget.scrollLeft)}
      />
    </div>
  )
}

function SplitDiffView({ files }: { files: FileData[] }) {
  return (
    <div className="oo-turn-split-view">
      {files.map((file, index) => (
        <SplitDiffFile key={`${file.oldRevision}:${file.newRevision}:${index}`} file={file} />
      ))}
    </div>
  )
}

function ParsedDiffView({ files, viewType }: { files: FileData[]; viewType: ViewType }) {
  if (viewType === "split") {
    return <SplitDiffView files={files} />
  }

  return (
    <div className="oo-turn-diff-view oo-turn-diff-view-unified">
      {files.map((item, index) => (
        <ReactDiff
          key={`${item.oldRevision}:${item.newRevision}:${index}`}
          diffType={item.type}
          hunks={item.hunks}
          optimizeSelection
          viewType={viewType}
        >
          {(hunks) => hunks.map((hunk) => <Hunk key={hunk.content} hunk={hunk} />)}
        </ReactDiff>
      ))}
    </div>
  )
}

function TurnDiffBody({ diff, viewType }: { diff: TurnFileDiffResult | null; viewType: ViewType }) {
  const t = useT()
  const parsedFiles = useParsedDiff(diff?.kind === "text" ? diff.patch : undefined)
  if (!diff) {
    return (
      <div className="oo-text-body flex min-h-28 items-center justify-center p-4 text-muted-foreground">
        {t("artifacts.previewLoading")}
      </div>
    )
  }
  if (diff.kind !== "text" || !diff.patch) {
    const label = diff.kind === "too_large" ? t("turnOutputs.diffTooLarge") : t("turnOutputs.diffBinary")
    return (
      <div className="oo-text-body flex min-h-28 items-center justify-center p-4 text-muted-foreground">{label}</div>
    )
  }
  return (
    <div className="min-w-0 bg-background">
      <div className="oo-turn-diff-x-scroll min-w-0">
        {parsedFiles.length > 0 ? (
          <ParsedDiffView files={parsedFiles} viewType={viewType} />
        ) : (
          <RawPatchFallback patch={diff.patch} />
        )}
      </div>
    </div>
  )
}
