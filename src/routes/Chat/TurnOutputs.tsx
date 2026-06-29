import type {
  ChatMessage,
  TurnFileDiffResult,
  TurnOutputFile,
  TurnOutputRecord,
  TurnOutputFileRole,
} from "../../../electron/chat/common.ts"
import type { FileData, ViewType } from "react-diff-view"

import {
  CheckIcon,
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

  return (
    <div className="grid gap-1.5 sm:grid-cols-2">
      {record.summary.changedFileCount > 0 ? (
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
      {record.summary.processFileCount > 0 ? (
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
          const error = resolveUserFacingError(cause, { area: "artifact" })
          toast.error(userFacingErrorDescription(error, t))
        })
      },
      showInFolder(filePath) {
        if (!filePath) {
          return
        }
        void chatService.invoke("showLocalPathInFolder", { path: filePath }).catch((cause: unknown) => {
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
  const [activeRole, setActiveRole] = React.useState<Exclude<TurnOutputFileRole, "artifact">>(initialRole)
  const processFiles = React.useMemo(() => (selection ? roleFiles(selection.record, "process") : []), [selection])
  const changeFiles = React.useMemo(() => (selection ? roleFiles(selection.record, "project_change") : []), [selection])
  const activeFiles = activeRole === "project_change" ? changeFiles : processFiles
  const fallbackPath = selection?.selectedPath ?? activeFiles[0]?.path ?? null
  const [selectedPath, setSelectedPath] = React.useState<string | null>(fallbackPath)
  const selectedFile = activeFiles.find((file) => file.path === selectedPath) ?? activeFiles[0] ?? null
  const diff = useTurnFileDiff(selection, selectedFile?.path ?? null)
  const { openPath, showInFolder } = useTurnFileActions()

  React.useEffect(() => {
    setActiveRole(initialRole)
  }, [initialRole, selection?.record.messageId])

  React.useEffect(() => {
    setSelectedPath(selection?.selectedPath ?? activeFiles[0]?.path ?? null)
  }, [activeFiles, selection?.selectedPath])

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
          {selectedFile ? (
            <>
              <button
                type="button"
                title={t("artifacts.showInFolder")}
                aria-label={t("artifacts.showInFolder")}
                className="oo-toolbar-button flex size-8 shrink-0 items-center justify-center rounded-md hover:bg-accent hover:text-foreground focus-visible:bg-accent focus-visible:text-foreground"
                onClick={() => showInFolder(selectedFile.path)}
              >
                <FolderOpen className="size-4" />
              </button>
              <button
                type="button"
                title={t("artifacts.openFile")}
                aria-label={t("artifacts.openFile")}
                className="oo-toolbar-button flex size-8 shrink-0 items-center justify-center rounded-md hover:bg-accent hover:text-foreground focus-visible:bg-accent focus-visible:text-foreground"
                onClick={() => openPath(selectedFile.path)}
              >
                <ExternalLink className="size-4" />
              </button>
            </>
          ) : null}
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

      <div className="oo-border-divider flex shrink-0 items-center gap-1 border-b px-2.5 py-2">
        {changeFiles.length > 0 ? (
          <RoleTab
            active={activeRole === "project_change"}
            count={changeFiles.length}
            label={t("turnOutputs.changes")}
            onClick={() => setActiveRole("project_change")}
          />
        ) : null}
        {processFiles.length > 0 ? (
          <RoleTab
            active={activeRole === "process"}
            count={processFiles.length}
            label={t("turnOutputs.processFiles")}
            onClick={() => setActiveRole("process")}
          />
        ) : null}
      </div>

      <div className="grid min-h-0 flex-1 grid-cols-[minmax(160px,0.36fr)_minmax(0,1fr)]">
        <section className="oo-border-divider min-h-0 overflow-auto border-r px-2 py-3">
          {activeRole === "process" && processFiles.length > 0 ? (
            <div className="oo-text-caption mb-2 rounded-md border bg-muted/45 px-2 py-1.5 text-muted-foreground">
              {t("turnOutputs.processCaution")}
            </div>
          ) : null}
          {activeFiles.length > 0 ? (
            <div className="grid gap-1">
              {activeFiles.map((file) => (
                <TurnFileRow
                  key={file.path}
                  file={file}
                  selected={file.path === selectedFile?.path}
                  onClick={() => setSelectedPath(file.path)}
                />
              ))}
            </div>
          ) : (
            <div className="oo-text-body px-2 py-8 text-center text-muted-foreground">{t("turnOutputs.empty")}</div>
          )}
        </section>
        <TurnDiffPane diff={diff} file={selectedFile} />
      </div>
    </aside>
  )
}

function RoleTab({
  active,
  count,
  label,
  onClick,
}: {
  active: boolean
  count: number
  label: string
  onClick: () => void
}) {
  return (
    <button
      type="button"
      className={cn(
        "oo-text-label flex h-8 items-center gap-1.5 rounded-md px-2.5 transition-colors hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
        active ? "bg-accent text-foreground" : "text-muted-foreground",
      )}
      onClick={onClick}
    >
      <span>{label}</span>
      <span className="oo-text-caption-compact rounded bg-background px-1.5 text-muted-foreground">{count}</span>
    </button>
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

function TurnFileRow({ file, selected, onClick }: { file: TurnOutputFile; selected: boolean; onClick: () => void }) {
  const t = useT()
  const hasDiffCounts = file.additions > 0 || file.deletions > 0

  return (
    <button
      type="button"
      title={file.path}
      className={cn(
        "oo-artifact-selectable flex min-h-11 min-w-0 items-center gap-1.5 rounded-md border px-1.5 text-left shadow-sm hover:text-accent-foreground focus-visible:outline-none",
        selected && "oo-artifact-selected shadow-none",
      )}
      onClick={onClick}
    >
      <FileKindTile source={{ ...file, kind: "file" }} className="size-7" iconClassName="size-3.5" />
      <span className="min-w-0 flex-1">
        <span className="oo-text-caption-compact block truncate font-medium text-foreground">{file.name}</span>
        {hasDiffCounts ? (
          <ChangeCountLabel additions={file.additions} deletions={file.deletions} />
        ) : (
          <span className="oo-text-caption-compact block truncate text-muted-foreground">
            {changeKindLabel(t, file)}
          </span>
        )}
      </span>
    </button>
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

function DiffViewModeToggle({ onChange, value }: { onChange: (value: ViewType) => void; value: ViewType }) {
  const t = useT()
  return (
    <div className="oo-border-divider flex h-7 shrink-0 overflow-hidden rounded-md border bg-muted/45 p-0.5">
      {(["unified", "split"] as const).map((mode) => (
        <button
          key={mode}
          type="button"
          className={cn(
            "oo-text-caption-compact h-6 rounded px-2 transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
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
    <pre className="oo-text-caption min-h-full overflow-auto rounded-md border bg-muted/30 p-3 font-mono whitespace-pre text-foreground">
      {patch}
    </pre>
  )
}

function ParsedDiffView({ files, viewType }: { files: FileData[]; viewType: ViewType }) {
  return (
    <div
      className={cn(
        "oo-turn-diff-view",
        viewType === "split" ? "oo-turn-diff-view-split" : "oo-turn-diff-view-unified",
      )}
    >
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

function TurnDiffPane({ diff, file }: { diff: TurnFileDiffResult | null; file: TurnOutputFile | null }) {
  const t = useT()
  const [viewType, setViewType] = React.useState<ViewType>("unified")
  const parsedFiles = useParsedDiff(diff?.kind === "text" ? diff.patch : undefined)
  if (!file) {
    return (
      <div className="oo-text-body flex min-h-0 items-center justify-center p-4 text-muted-foreground">
        {t("turnOutputs.empty")}
      </div>
    )
  }
  if (!diff) {
    return (
      <div className="oo-text-body flex min-h-0 items-center justify-center p-4 text-muted-foreground">
        {t("artifacts.previewLoading")}
      </div>
    )
  }
  if (diff.kind !== "text" || !diff.patch) {
    const label = diff.kind === "too_large" ? t("turnOutputs.diffTooLarge") : t("turnOutputs.diffBinary")
    return (
      <div className="oo-text-body flex min-h-0 items-center justify-center p-4 text-muted-foreground">{label}</div>
    )
  }
  return (
    <section className="flex min-h-0 min-w-0 flex-col overflow-hidden px-2 py-3">
      <div className="oo-border-divider flex h-10 shrink-0 items-center justify-between gap-2 rounded-t-md border bg-muted/35 px-2">
        <div className="flex min-w-0 flex-1 items-center gap-3">
          <div className="oo-text-label min-w-0 truncate font-mono">{file.name}</div>
          <ChangeCountLabel additions={diff.additions} className="shrink-0" deletions={diff.deletions} />
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          <DiffViewModeToggle value={viewType} onChange={setViewType} />
          <CopyPatchButton patch={diff.patch} />
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-auto rounded-b-md border border-t-0 bg-background">
        {parsedFiles.length > 0 ? (
          <ParsedDiffView files={parsedFiles} viewType={viewType} />
        ) : (
          <RawPatchFallback patch={diff.patch} />
        )}
      </div>
    </section>
  )
}
