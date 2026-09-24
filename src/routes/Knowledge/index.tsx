import type { KnowledgeFile, KnowledgeHit } from "../../../electron/knowledge/common.ts"
import type { KnowledgeSourceSelection } from "./navigation.ts"

import { ArrowLeft, LoaderCircle, MessageCircleQuestionMark, RefreshCw, Trash2, Upload, X } from "lucide-react"
import * as React from "react"
import {
  knowledgeFilePending,
  knowledgeUploadAccept,
  knowledgeUploadError,
} from "../../../electron/knowledge/common.ts"
import { KnowledgeFileIcon } from "./KnowledgeFileIcon.tsx"
import { KnowledgeFilePreview } from "./KnowledgeFilePreview.tsx"
import { Button } from "@/components/ui/button"
import { Dialog } from "@/components/ui/dialog"
import { useT } from "@/i18n/i18n"
import { deleteKnowledgeFile, listKnowledgeFiles, uploadKnowledgeFile } from "@/lib/knowledge-client"

function FileRow({
  file,
  onOpen,
  onDelete,
  canDelete,
}: {
  file: KnowledgeFile
  onOpen: () => void
  onDelete: () => void
  canDelete: boolean
}) {
  const t = useT()
  return (
    <article className="group flex min-w-0 items-center gap-2 rounded-lg px-2 py-1 hover:bg-muted/50">
      <button
        type="button"
        className="flex min-w-0 flex-1 items-center gap-3 rounded-md py-2 text-left focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
        aria-label={`${t("knowledge.openFile")} ${file.name}`}
        onClick={onOpen}
      >
        <KnowledgeFileIcon name={file.name} />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium">{file.name}</span>
          <span className="block truncate text-xs text-muted-foreground">
            {t(`knowledge.status.${file.status}`)} · {(file.size_bytes / 1024 / 1024).toFixed(2)} MB
          </span>
        </span>
      </button>
      <Button
        variant="ghost"
        size="icon"
        aria-label={`${t("knowledge.delete")} ${file.name}`}
        disabled={!canDelete}
        onClick={onDelete}
      >
        <Trash2 aria-hidden="true" />
      </Button>
    </article>
  )
}

/** The parent keys this route by account and team; requests never survive that identity. */
export function KnowledgeRoute({
  teamId,
  writable,
  sourceSelection,
  onSourceSelectionConsumed,
  analysisContent,
  conversationActive = false,
  onCloseAnalysis,
}: {
  teamId: string
  writable: boolean
  sourceSelection?: KnowledgeSourceSelection | null
  onSourceSelectionConsumed?: () => void
  analysisContent?: React.ReactNode
  conversationActive?: boolean
  onCloseAnalysis?: () => void
}) {
  const t = useT()
  const [files, setFiles] = React.useState<KnowledgeFile[]>([])
  const [pages, setPages] = React.useState(1)
  const [nextCursor, setNextCursor] = React.useState("")
  const [revision, refresh] = React.useReducer((value: number) => value + 1, 0)
  const [loading, setLoading] = React.useState(true)
  const [listError, setListError] = React.useState("")
  const [error, setError] = React.useState("")
  const [mutation, setMutation] = React.useState<"upload" | "delete" | null>(null)
  const [deleteTarget, setDeleteTarget] = React.useState<KnowledgeFile | null>(null)
  const [selectedFile, setSelectedFile] = React.useState<KnowledgeFile | null>(null)
  const [selectedHit, setSelectedHit] = React.useState<KnowledgeHit | null>(null)
  const [askPanelOpen, setAskPanelOpen] = React.useState(false)
  const [dragActive, setDragActive] = React.useState(false)
  const input = React.useRef<HTMLInputElement>(null)
  const dragDepth = React.useRef(0)
  const mutationRequest = React.useRef<AbortController | null>(null)

  React.useEffect(() => {
    if (!sourceSelection || sourceSelection.teamId !== teamId) return
    const hit = sourceSelection.hit
    setSelectedFile({
      id: hit.file_id,
      name: hit.filename,
      size_bytes: 0,
      status: "ready",
      created_at: "",
      updated_at: "",
    })
    setSelectedHit(hit)
    onSourceSelectionConsumed?.()
  }, [onSourceSelectionConsumed, sourceSelection, teamId])

  React.useEffect(() => () => mutationRequest.current?.abort(), [])
  React.useEffect(() => {
    if (!teamId) {
      setLoading(false)
      return
    }
    const controller = new AbortController()
    let timer: ReturnType<typeof setTimeout> | undefined
    setListError("")
    setLoading(true)
    void (async () => {
      try {
        const items: KnowledgeFile[] = []
        let cursor = ""
        for (let page = 0; page < pages; page++) {
          const response = await listKnowledgeFiles(teamId, cursor, controller.signal)
          items.push(...response.items)
          cursor = response.next_cursor
          if (!cursor) break
        }
        if (controller.signal.aborted) return
        setFiles([...new Map(items.map((file) => [file.id, file])).values()])
        setNextCursor(cursor)
        if (items.some((file) => knowledgeFilePending(file.status))) timer = setTimeout(refresh, 3_000)
      } catch (cause) {
        if (!controller.signal.aborted) setListError(cause instanceof Error ? cause.message : String(cause))
      } finally {
        if (!controller.signal.aborted) setLoading(false)
      }
    })()
    return () => {
      controller.abort()
      clearTimeout(timer)
    }
  }, [teamId, pages, revision])

  async function mutate(kind: "upload" | "delete", operation: (signal: AbortSignal) => Promise<unknown>) {
    if (mutationRequest.current || !writable) return
    const controller = new AbortController()
    mutationRequest.current = controller
    setMutation(kind)
    setError("")
    try {
      await operation(controller.signal)
      if (!controller.signal.aborted && mutationRequest.current === controller) {
        if (kind === "delete" && deleteTarget?.id === selectedFile?.id) {
          setSelectedFile(null)
          setSelectedHit(null)
        }
        setDeleteTarget(null)
        refresh()
      }
    } catch (cause) {
      if (!controller.signal.aborted && mutationRequest.current === controller) {
        setError(cause instanceof Error ? cause.message : String(cause))
        if (kind === "upload") refresh()
      }
    } finally {
      if (!controller.signal.aborted && mutationRequest.current === controller) {
        mutationRequest.current = null
        setMutation(null)
      }
    }
  }

  function cancelUpload() {
    if (mutation !== "upload") return
    mutationRequest.current?.abort()
    mutationRequest.current = null
    setMutation(null)
    refresh()
  }

  function uploadFiles(files: File[]) {
    if (!writable || mutationRequest.current || files.length === 0) return
    for (const file of files) {
      const validation = knowledgeUploadError(file)
      if (validation) {
        setError(t(validation === "tooLarge" ? "knowledge.tooLarge" : "knowledge.unsupportedType"))
        return
      }
    }
    void mutate("upload", async (signal) => {
      for (const file of files) {
        if (signal.aborted) break
        await uploadKnowledgeFile(teamId, file, signal)
      }
    })
  }

  const detailFile = selectedFile ? (files.find((file) => file.id === selectedFile.id) ?? selectedFile) : null
  const showAskPanel = askPanelOpen || conversationActive
  const busy = mutation !== null
  const controls = (
    <div className="flex items-center gap-1">
      <Button variant="ghost" size="icon" aria-label={t("knowledge.refresh")} disabled={loading} onClick={refresh}>
        <RefreshCw aria-hidden="true" />
      </Button>
      <Button variant="ghost" size="sm" disabled={!writable || busy} onClick={() => input.current?.click()}>
        {busy ? <LoaderCircle className="animate-spin" aria-hidden="true" /> : <Upload aria-hidden="true" />}
        {t("knowledge.upload")}
      </Button>
      {mutation === "upload" ? (
        <Button variant="outline" size="sm" onClick={cancelUpload}>
          {t("knowledge.cancelUpload")}
        </Button>
      ) : null}
      <input
        ref={input}
        type="file"
        accept={knowledgeUploadAccept}
        className="hidden"
        onChange={(event) => {
          const file = event.target.files?.[0]
          event.target.value = ""
          if (!file) return
          uploadFiles([file])
        }}
      />
    </div>
  )

  if (!teamId) return <p className="p-6 text-muted-foreground">{t("knowledge.selectTeam")}</p>
  return (
    <>
      <div className="relative flex h-full min-h-0 min-w-0">
        <div
          data-knowledge-drop-zone=""
          className="relative flex min-w-0 flex-1 flex-col"
          onDragEnter={(event) => {
            if (!event.dataTransfer.types.includes("Files")) return
            event.preventDefault()
            if (!writable || busy) return
            dragDepth.current += 1
            setDragActive(true)
          }}
          onDragLeave={() => {
            if (!dragActive) return
            dragDepth.current = Math.max(0, dragDepth.current - 1)
            if (dragDepth.current === 0) setDragActive(false)
          }}
          onDragOver={(event) => {
            if (!event.dataTransfer.types.includes("Files")) return
            event.preventDefault()
            event.dataTransfer.dropEffect = writable && !busy ? "copy" : "none"
          }}
          onDrop={(event) => {
            if (!event.dataTransfer.types.includes("Files")) return
            event.preventDefault()
            dragDepth.current = 0
            setDragActive(false)
            uploadFiles(Array.from(event.dataTransfer.files))
          }}
        >
          <header className="flex h-12 shrink-0 items-center justify-between gap-3 border-b px-4">
            <div className="flex min-w-0 items-baseline gap-2">
              <h1 className="shrink-0 text-sm font-semibold">{t("knowledge.title")}</h1>
              <span className="truncate text-xs text-muted-foreground">
                {files.length}
                {nextCursor ? "+" : ""} {t("knowledge.booksCount")}
              </span>
            </div>
            <div className="flex items-center gap-2">
              {controls}
              {!showAskPanel ? (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setAskPanelOpen(true)}
                  aria-label={t("knowledge.askTitle")}
                >
                  <MessageCircleQuestionMark aria-hidden="true" /> {t("knowledge.askTitle")}
                </Button>
              ) : null}
            </div>
          </header>
          <section aria-label={t("knowledge.files")} className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
            {listError ? (
              <p role="alert" className="mb-3 text-sm text-destructive">
                {listError}
              </p>
            ) : null}
            {error ? (
              <p role="alert" className="mb-3 text-sm text-destructive">
                {error}
              </p>
            ) : null}
            {files.length === 0 ? (
              <p className="rounded-lg border border-dashed p-8 text-sm text-muted-foreground">
                {loading ? t("knowledge.loading") : t("knowledge.emptyFiles")}
              </p>
            ) : (
              <div className="space-y-1">
                {files.map((file) => (
                  <FileRow
                    key={file.id}
                    file={file}
                    canDelete={writable && !busy && file.status !== "deleting" && file.status !== "deleted"}
                    onDelete={() => setDeleteTarget(file)}
                    onOpen={() => {
                      setSelectedFile(file)
                      setSelectedHit(null)
                    }}
                  />
                ))}
              </div>
            )}
            {nextCursor ? (
              <Button
                variant="outline"
                className="mt-4"
                disabled={loading}
                onClick={() => setPages((value) => value + 1)}
              >
                {t("knowledge.loadMore")}
              </Button>
            ) : null}
          </section>
          {dragActive ? (
            <div className="pointer-events-none absolute inset-1 z-30 flex items-center justify-center rounded-lg border-2 border-dashed border-primary/50 bg-primary/5">
              <span
                role="status"
                className="flex items-center gap-2 rounded-lg border bg-background px-4 py-3 text-sm font-medium shadow-sm"
              >
                <Upload className="size-4" aria-hidden="true" />
                {t("knowledge.dropToUpload")}
              </span>
            </div>
          ) : null}
          {detailFile ? (
            <section aria-label={detailFile.name} className="absolute inset-0 z-10 flex min-h-0 flex-col bg-background">
              <div className="flex h-12 shrink-0 items-center gap-2 border-b px-3">
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label={t("knowledge.backToFiles")}
                  onClick={() => {
                    setSelectedFile(null)
                    setSelectedHit(null)
                  }}
                >
                  <ArrowLeft aria-hidden="true" />
                </Button>
                <div className="min-w-0 flex-1">
                  <h2 className="truncate text-sm font-semibold">{detailFile.name}</h2>
                  <p className="text-xs text-muted-foreground">
                    {t(`knowledge.status.${detailFile.status}`)} · {(detailFile.size_bytes / 1024 / 1024).toFixed(2)} MB
                  </p>
                </div>
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label={t("common.close")}
                  onClick={() => {
                    setSelectedFile(null)
                    setSelectedHit(null)
                  }}
                >
                  <X aria-hidden="true" />
                </Button>
              </div>
              {selectedHit ? (
                <div className="border-b bg-muted/20 p-3">
                  <h3 className="text-xs font-medium text-muted-foreground">{t("knowledge.evidenceTab")}</h3>
                  <p className="mt-2 max-h-28 overflow-y-auto text-sm break-words whitespace-pre-wrap">
                    {selectedHit.text}
                  </p>
                </div>
              ) : null}
              <div className="min-h-0 flex-1 overflow-auto">
                {detailFile.status === "ready" ? (
                  <KnowledgeFilePreview file={detailFile} teamId={teamId} />
                ) : (
                  <p className="p-6 text-sm text-muted-foreground">{t("knowledge.previewPending")}</p>
                )}
              </div>
            </section>
          ) : null}
        </div>
        {showAskPanel ? (
          <aside
            aria-label={t("knowledge.askTitle")}
            className="relative z-20 flex h-full w-[min(48%,38rem)] min-w-[20rem] flex-col border-l bg-background max-md:absolute max-md:inset-0 max-md:w-full"
          >
            <div className="flex h-12 shrink-0 items-center justify-between border-b px-4">
              <h2 className="text-sm font-semibold">{t("knowledge.askTitle")}</h2>
              <Button
                variant="ghost"
                size="icon"
                aria-label={t("common.close")}
                onClick={() => {
                  setAskPanelOpen(false)
                  onCloseAnalysis?.()
                }}
              >
                <X aria-hidden="true" />
              </Button>
            </div>
            <div className="min-h-0 flex-1 overflow-hidden">{analysisContent}</div>
          </aside>
        ) : null}
      </div>
      <Dialog
        open={deleteTarget !== null}
        title={t("knowledge.delete")}
        closeLabel={t("common.close")}
        onClose={() => {
          if (!busy) setDeleteTarget(null)
        }}
        footer={
          <>
            <Button variant="ghost" disabled={busy} onClick={() => setDeleteTarget(null)}>
              {t("common.cancel")}
            </Button>
            <Button
              variant="destructive"
              disabled={busy || !writable}
              onClick={() => {
                if (deleteTarget)
                  void mutate("delete", (signal) => deleteKnowledgeFile(teamId, deleteTarget.id, signal))
              }}
            >
              {t("knowledge.delete")}
            </Button>
          </>
        }
      >
        <p className="text-sm">{t("knowledge.deleteConfirm", { name: deleteTarget?.name ?? "" })}</p>
      </Dialog>
    </>
  )
}
