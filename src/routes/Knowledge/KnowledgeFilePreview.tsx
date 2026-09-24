import type { LocalArtifactPreviewResult, LocalArtifactSpreadsheetPreview } from "../../../electron/chat/common.ts"
import type { KnowledgeFile } from "../../../electron/knowledge/common.ts"

import * as React from "react"
import { zipArchiveStats, zipArchiveWithinLimits } from "../../../electron/chat/zip-central-directory.ts"
import { useT } from "@/i18n/i18n"
import { KnowledgeContentTooLargeError, readKnowledgeFileContent } from "@/lib/knowledge-client"

const ArtifactPdfPreview = React.lazy(() => import("../Chat/ArtifactPdfPreview.tsx"))
const ArtifactDocxPreview = React.lazy(() => import("../Chat/ArtifactDocxPreview.tsx"))
const ArtifactUniverSpreadsheetPreview = React.lazy(() =>
  import("../Chat/ArtifactUniverSpreadsheetPreview.tsx").then((module) => ({
    default: module.ArtifactUniverSpreadsheetPreview,
  })),
)

const richPreviewMaxBytes = 16 * 1024 * 1024
const spreadsheetPreviewMaxBytes = 8 * 1024 * 1024
const textPreviewMaxBytes = 512 * 1024
const spreadsheetMaxRows = 200
const spreadsheetMaxColumns = 50
const spreadsheetMaxSheets = 12

type Preview =
  | { kind: "pdf"; bytes: Uint8Array }
  | { kind: "url"; format: "docx" | "image"; url: string }
  | { kind: "text"; text: string; truncated: boolean; serviceText: boolean }
  | { kind: "spreadsheet"; preview: LocalArtifactPreviewResult }
  | { kind: "unsupported" }

function extension(name: string): string {
  return name.slice(name.lastIndexOf(".") + 1).toLowerCase()
}

function contentText(bytes: Uint8Array, contentType: string): string | null {
  if (contentType.includes("application/json")) {
    try {
      const value: unknown = JSON.parse(new TextDecoder().decode(bytes))
      if (typeof value === "string") return value
      if (!value || typeof value !== "object") return null
      const object = value as Record<string, unknown>
      for (const key of ["content", "text", "parsed_content", "parsedContent"]) {
        if (typeof object[key] === "string") return object[key]
      }
      return null
    } catch {
      return null
    }
  }
  if (contentType.startsWith("text/")) return new TextDecoder().decode(bytes)
  return null
}

async function xlsxPreview(bytes: Uint8Array): Promise<LocalArtifactPreviewResult> {
  const archive = zipArchiveStats(bytes)
  if (
    !archive ||
    !zipArchiveWithinLimits(archive, {
      maxCompressionRatio: 200,
      maxEntries: 2_048,
      maxEntryUncompressedSize: 64 * 1024 * 1024,
      maxTotalUncompressedSize: 128 * 1024 * 1024,
    })
  )
    throw new Error("Invalid or oversized spreadsheet archive")
  const { default: readXlsxFile } = await import("read-excel-file/browser")
  const arrayBuffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer
  const sheets = await readXlsxFile(arrayBuffer, { trim: false })
  const workbook = sheets.slice(0, spreadsheetMaxSheets).map(({ sheet, data }) => ({
    name: sheet,
    rowCount: data.length,
    columnCount: data.reduce((max, row) => Math.max(max, row.length), 0),
    rows: data
      .slice(0, spreadsheetMaxRows)
      .map((row) =>
        row
          .slice(0, spreadsheetMaxColumns)
          .map((cell) => (cell instanceof Date ? cell.toISOString() : String(cell ?? ""))),
      ),
  }))
  const first = workbook[0]
  const spreadsheet: LocalArtifactSpreadsheetPreview = {
    activeSheet: first?.name ?? "",
    columnCount: first?.columnCount ?? 0,
    rowCount: first?.rowCount ?? 0,
    rows: first?.rows ?? [],
    sheets: workbook.map((sheet) => sheet.name),
    workbook,
  }
  return {
    kind: "spreadsheet",
    mime: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    spreadsheet,
    truncated:
      sheets.length > workbook.length ||
      workbook.some((sheet) => sheet.rowCount > spreadsheetMaxRows || sheet.columnCount > spreadsheetMaxColumns),
  }
}

function createPreview(file: KnowledgeFile, bytes: Uint8Array, contentType: string): Promise<Preview> | Preview {
  const format = extension(file.name)
  const text =
    contentText(bytes, contentType) ??
    (!contentType.includes("application/json") && (format === "txt" || format === "md")
      ? new TextDecoder().decode(bytes)
      : null)
  if (text !== null) {
    const encoded = new TextEncoder().encode(text)
    return {
      kind: "text",
      text: new TextDecoder().decode(encoded.subarray(0, textPreviewMaxBytes)),
      truncated: encoded.byteLength > textPreviewMaxBytes,
      serviceText: contentType.includes("application/json"),
    }
  }
  if (format === "pdf") return { kind: "pdf", bytes }
  if (format === "xlsx") {
    if (bytes.byteLength > spreadsheetPreviewMaxBytes) throw new KnowledgeContentTooLargeError()
    return xlsxPreview(bytes).then((preview) => ({ kind: "spreadsheet", preview }))
  }
  if (format === "docx") {
    const archive = zipArchiveStats(bytes)
    if (
      !archive ||
      !zipArchiveWithinLimits(archive, {
        maxCompressionRatio: 200,
        maxEntries: 2_048,
        maxEntryUncompressedSize: 32 * 1024 * 1024,
        maxTotalUncompressedSize: 96 * 1024 * 1024,
      })
    )
      return { kind: "unsupported" }
  }
  const mime =
    format === "docx"
      ? "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
      : (
          { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", bmp: "image/bmp" } as Record<
            string,
            string
          >
        )[format]
  if (mime && (format === "docx" || mime.startsWith("image/"))) {
    const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: mime }))
    return { kind: "url", format: format === "docx" ? format : "image", url }
  }
  return { kind: "unsupported" }
}

export function KnowledgeFilePreview({ file, teamId }: { file: KnowledgeFile; teamId: string }) {
  const t = useT()
  const [preview, setPreview] = React.useState<Preview | null>(null)
  const [loading, setLoading] = React.useState(true)
  const [error, setError] = React.useState("")
  const [revision, retry] = React.useReducer((value: number) => value + 1, 0)
  React.useEffect(() => {
    const controller = new AbortController()
    let objectUrl: string | null = null
    if (extension(file.name) === "pdf") void import("../Chat/ArtifactPdfPreview.tsx")
    setPreview(null)
    setLoading(true)
    setError("")
    void (async () => {
      const content = await readKnowledgeFileContent(teamId, file.id, richPreviewMaxBytes, controller.signal)
      if (controller.signal.aborted) return
      const next = await createPreview(file, content.bytes, content.contentType.toLowerCase())
      if (next.kind === "url") objectUrl = next.url
      if (controller.signal.aborted) {
        if (objectUrl) URL.revokeObjectURL(objectUrl)
        objectUrl = null
        return
      }
      setPreview(next)
    })()
      .catch((cause: unknown) => {
        if (controller.signal.aborted) return
        setError(
          cause instanceof KnowledgeContentTooLargeError
            ? t("knowledge.previewTooLarge")
            : t("knowledge.previewUnavailable"),
        )
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false)
      })
    return () => {
      controller.abort()
      if (objectUrl) URL.revokeObjectURL(objectUrl)
    }
  }, [file.id, file.name, teamId, revision, t])

  if (loading) return <p className="p-6 text-sm text-muted-foreground">{t("knowledge.previewLoading")}</p>
  if (error)
    return (
      <div className="p-6 text-sm text-muted-foreground">
        {error}{" "}
        <button className="underline" onClick={retry}>
          {t("knowledge.retryPreview")}
        </button>
      </div>
    )
  if (!preview || preview.kind === "unsupported")
    return <p className="p-6 text-sm text-muted-foreground">{t("knowledge.previewUnsupported")}</p>
  if (preview.kind === "text")
    return (
      <div className="p-4">
        {preview.serviceText ? (
          <p className="mb-3 text-xs text-muted-foreground">{t("knowledge.previewServiceText")}</p>
        ) : null}
        <pre className="text-sm break-words whitespace-pre-wrap">{preview.text}</pre>
        {preview.truncated ? (
          <p className="mt-3 text-xs text-muted-foreground">{t("knowledge.previewTruncated")}</p>
        ) : null}
      </div>
    )
  if (preview.kind === "spreadsheet")
    return (
      <React.Suspense fallback={<p className="p-6">{t("knowledge.previewLoading")}</p>}>
        <ArtifactUniverSpreadsheetPreview preview={preview.preview} />
      </React.Suspense>
    )
  if (preview.kind === "url" && preview.format === "image")
    return (
      <div className="flex h-full items-center justify-center p-4">
        <img src={preview.url} alt={file.name} className="max-h-full max-w-full object-contain" />
      </div>
    )
  return (
    <React.Suspense fallback={<p className="p-6">{t("knowledge.previewLoading")}</p>}>
      {preview.kind === "pdf" ? (
        <ArtifactPdfPreview data={preview.bytes} name={file.name} onRetry={retry} />
      ) : (
        <ArtifactDocxPreview source={preview.url} name={file.name} onRetry={retry} />
      )}
    </React.Suspense>
  )
}
