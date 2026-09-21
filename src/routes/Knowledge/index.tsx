import type { KnowledgeFile, KnowledgeResults } from "../../../electron/knowledge/common.ts"

import { FileText, LoaderCircle, RefreshCw, Search, Trash2, Upload } from "lucide-react"
import * as React from "react"
import {
  knowledgeFilePending,
  knowledgeUploadAccept,
  knowledgeUploadError,
} from "../../../electron/knowledge/common.ts"
import { Button } from "@/components/ui/button"
import { Dialog } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { useT } from "@/i18n/i18n"
import { deleteKnowledgeFile, listKnowledgeFiles, retrieveKnowledge, uploadKnowledgeFile } from "@/lib/knowledge-client"

/** The parent keys this route by account and team; requests never survive that identity. */
export function KnowledgeRoute({ teamId, writable }: { teamId: string; writable: boolean }) {
  const t = useT()
  const [files, setFiles] = React.useState<KnowledgeFile[]>([])
  const [pages, setPages] = React.useState(1)
  const [nextCursor, setNextCursor] = React.useState("")
  const [revision, refresh] = React.useReducer((v: number) => v + 1, 0)
  const [loading, setLoading] = React.useState(true)
  const [error, setError] = React.useState("")
  const [listError, setListError] = React.useState("")
  const [mutation, setMutation] = React.useState<"upload" | "delete" | null>(null)
  const busy = mutation !== null
  const [deleteTarget, setDeleteTarget] = React.useState<KnowledgeFile | null>(null)
  const [query, setQuery] = React.useState("")
  const [results, setResults] = React.useState<KnowledgeResults | null>(null)
  const [searching, setSearching] = React.useState(false)
  const input = React.useRef<HTMLInputElement>(null)
  const mutationRequest = React.useRef<AbortController | null>(null)
  const searchRequest = React.useRef<AbortController | null>(null)
  React.useEffect(() => {
    return () => {
      mutationRequest.current?.abort()
      searchRequest.current?.abort()
    }
  }, [])
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
    searchRequest.current?.abort()
    setSearching(false)
    setMutation(kind)
    setError("")
    try {
      await operation(controller.signal)
      if (!controller.signal.aborted && mutationRequest.current === controller) {
        setDeleteTarget(null)
        setResults(null)
        refresh()
      }
    } catch (cause) {
      if (!controller.signal.aborted && mutationRequest.current === controller) {
        setError(cause instanceof Error ? cause.message : String(cause))
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
    // Aborting the request cannot roll back a file already accepted by the server.
    refresh()
  }
  async function search() {
    const normalized = query.trim()
    if (!normalized) return
    searchRequest.current?.abort()
    const controller = new AbortController()
    searchRequest.current = controller
    setSearching(true)
    setResults(null)
    setError("")
    try {
      const response = await retrieveKnowledge(teamId, normalized, controller.signal)
      if (!controller.signal.aborted) setResults(response)
    } catch (cause) {
      if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      if (!controller.signal.aborted) setSearching(false)
    }
  }
  if (!teamId) return <p className="p-6 text-muted-foreground">{t("knowledge.selectTeam")}</p>
  return (
    <div className="h-full overflow-y-auto p-6">
      <div className="mx-auto flex max-w-5xl flex-col gap-5">
        <form
          className="flex gap-2"
          onSubmit={(event) => {
            event.preventDefault()
            void search()
          }}
        >
          <Input
            value={query}
            maxLength={8000}
            aria-label={t("knowledge.search")}
            placeholder={t("knowledge.search")}
            onChange={(event) => {
              searchRequest.current?.abort()
              setSearching(false)
              setQuery(event.target.value)
              setResults(null)
            }}
          />
          <Button type="submit" disabled={!query.trim() || searching}>
            {searching ? <LoaderCircle className="animate-spin" /> : <Search />}
            {t("knowledge.search")}
          </Button>
        </form>
        {listError ? (
          <div role="alert" className="text-sm text-destructive">
            {listError}
          </div>
        ) : null}
        {error ? (
          <div role="alert" className="text-sm text-destructive">
            {error}
          </div>
        ) : null}
        {results ? (
          <section className="space-y-3" aria-label={t("knowledge.sources")}>
            <h2 className="font-medium">{t("knowledge.sources")}</h2>
            {results.items.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t("knowledge.emptyResults")}</p>
            ) : (
              results.items.map((hit, index) => (
                <article key={`${hit.file_id}:${index}`} className="rounded-lg border p-4">
                  <div className="flex items-center justify-between gap-3">
                    <span className="truncate font-medium">{hit.filename}</span>
                    <span className="text-xs text-muted-foreground">
                      {t("knowledge.score")} {hit.score.toFixed(3)}
                    </span>
                  </div>
                  <p className="mt-2 text-sm break-words whitespace-pre-wrap text-muted-foreground">{hit.text}</p>
                </article>
              ))
            )}
          </section>
        ) : null}
        <section className="overflow-hidden rounded-lg border">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b p-4">
            <div>
              <h2 className="font-medium">{t("knowledge.files")}</h2>
              <p className="mt-1 text-xs text-muted-foreground">{t("knowledge.uploadHint")}</p>
            </div>
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="icon"
                aria-label={t("knowledge.refresh")}
                disabled={loading}
                onClick={() => {
                  refresh()
                }}
              >
                <RefreshCw />
              </Button>
              <Button disabled={!writable || busy} onClick={() => input.current?.click()}>
                {busy ? <LoaderCircle className="animate-spin" /> : <Upload />}
                {t("knowledge.upload")}
              </Button>
              {mutation === "upload" ? (
                <Button variant="outline" onClick={cancelUpload}>
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
                  const error = knowledgeUploadError(file)
                  if (error) {
                    setError(t(error === "tooLarge" ? "knowledge.tooLarge" : "knowledge.unsupportedType"))
                    return
                  }
                  void mutate("upload", (signal) => uploadKnowledgeFile(teamId, file, signal))
                }}
              />
            </div>
          </div>
          {files.length === 0 ? (
            <p className="p-6 text-sm text-muted-foreground">
              {loading ? t("knowledge.loading") : t("knowledge.emptyFiles")}
            </p>
          ) : (
            <ul className="divide-y">
              {files.map((file) => (
                <li key={file.id} className="flex items-center gap-3 p-4">
                  <FileText className="size-4 shrink-0 text-muted-foreground" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{file.name}</p>
                    <p className="text-xs text-muted-foreground">
                      {(file.size_bytes / 1024 / 1024).toFixed(2)} MB{file.error_code ? ` · ${file.error_code}` : ""}
                    </p>
                  </div>
                  <span className="text-xs text-muted-foreground">{t(`knowledge.status.${file.status}`)}</span>
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label={`${t("knowledge.delete")} ${file.name}`}
                    disabled={!writable || busy || file.status === "deleting" || file.status === "deleted"}
                    onClick={() => setDeleteTarget(file)}
                  >
                    <Trash2 />
                  </Button>
                </li>
              ))}
            </ul>
          )}
          {nextCursor ? (
            <div className="border-t p-3">
              <Button variant="outline" disabled={loading} onClick={() => setPages((value) => value + 1)}>
                {t("knowledge.loadMore")}
              </Button>
            </div>
          ) : null}
        </section>
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
      </div>
    </div>
  )
}
