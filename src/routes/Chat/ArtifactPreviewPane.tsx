import type {
  LocalArtifactGroup,
  LocalArtifactItem,
  LocalArtifactPack,
  LocalArtifactPreviewResult,
} from "../../../electron/chat/common.ts"
import type { LocalArtifactPreviewCache } from "./artifact-preview-cache.ts"
import type { TranslateFn } from "@/i18n/i18n"

import { Code2, Copy, ExternalLink, File, FolderOpen, Info, Music, Package } from "lucide-react"
import * as React from "react"
import { parseCsvPreview } from "./artifact-csv-preview.ts"
import { htmlPreviewSrcDoc } from "./artifact-html-preview.ts"
import {
  artifactMetaLabel,
  fileSizeLabel,
  isAudioArtifact,
  isCsvArtifact,
  isHtmlArtifact,
  isMarkdownArtifact,
  isVideoArtifact,
  previewLanguage,
  readableArtifactTitle,
} from "./artifact-metadata.ts"
import { useLocalArtifactPreview } from "./artifact-preview-cache.ts"
import { FileKindIcon } from "./file-type-icons.tsx"
import {
  CodeBlock,
  CodeBlockActions,
  CodeBlockCopyButton,
  CodeBlockFilename,
  CodeBlockHeader,
  CodeBlockTitle,
} from "@/components/ai-elements/code-block"
import { MessageResponse } from "@/components/ai-elements/message"
import { Button } from "@/components/ui/button"
import { useT } from "@/i18n/i18n"
import { writeClipboardText } from "@/lib/clipboard"
import { cn } from "@/lib/utils"

const ArtifactPdfPreview = React.lazy(() => import("./ArtifactPdfPreview.tsx"))
const ArtifactDocxPreview = React.lazy(() => import("./ArtifactDocxPreview.tsx"))

type ArtifactPreviewMode = "preview" | "source" | "info"

function shouldOpenArtifactContextMenu(target: EventTarget | null): boolean {
  const element = target instanceof Element ? target : null
  return !element?.closest(
    'button, a, input, textarea, select, audio, video, [contenteditable="true"], .react-pdf__Page__textContent',
  )
}

function ArtifactIcon({
  className,
  item,
  pack,
}: {
  className?: string
  item: LocalArtifactItem
  pack?: LocalArtifactPack | null
}) {
  return <FileKindIcon source={item} pack={pack} className={cn("size-4 shrink-0", className)} />
}

export function ArtifactsEmptyState() {
  const t = useT()

  return (
    <div className="flex min-h-full flex-col items-center justify-center px-6 py-12 text-center">
      <div className="relative mb-4 flex size-14 items-center justify-center rounded-2xl border border-border/70 bg-muted/40 text-muted-foreground shadow-sm">
        <Package className="size-6" />
        <div className="absolute -right-1 -bottom-1 flex size-6 items-center justify-center rounded-full border border-border bg-background shadow-sm">
          <File className="size-3.5" />
        </div>
      </div>
      <div className="oo-text-title text-foreground">{t("artifacts.emptyTitle")}</div>
      <p className="oo-text-caption mt-1 max-w-56 text-muted-foreground">{t("artifacts.emptyDescription")}</p>
    </div>
  )
}

export function ArtifactPreview({
  group,
  item,
  onContextMenu,
  pack,
  previewCache,
  onOpen,
}: {
  group: LocalArtifactGroup | null
  item: LocalArtifactItem | null
  onContextMenu: (item: LocalArtifactItem, x: number, y: number) => void
  pack?: LocalArtifactPack | null
  previewCache: LocalArtifactPreviewCache
  onOpen: () => void
}) {
  const t = useT()
  const { loading, preview } = useLocalArtifactPreview(item, previewCache)
  const [mode, setMode] = React.useState<ArtifactPreviewMode>("preview")
  const canShowSource = preview?.kind === "text"

  React.useEffect(() => {
    setMode("preview")
  }, [item?.path])

  if (!item) {
    return <ArtifactsEmptyState />
  }

  return (
    <section
      className="flex min-h-0 flex-1 flex-col"
      onContextMenu={(event) => {
        if (!shouldOpenArtifactContextMenu(event.target)) {
          return
        }
        event.preventDefault()
        event.stopPropagation()
        onContextMenu(item, event.clientX, event.clientY)
      }}
    >
      <div className="oo-border-divider shrink-0 border-b px-3 py-2">
        <div className="flex min-w-0 items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-2">
            <div className="flex size-8 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">
              <ArtifactIcon item={item} pack={pack} />
            </div>
            <div className="min-w-0">
              <div className="oo-text-title truncate">{readableArtifactTitle(item)}</div>
              <div className="oo-text-caption-compact truncate text-muted-foreground">
                {artifactMetaLabel(t, item, pack)}
              </div>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-0.5">
            {canShowSource ? <CopyContentButton text={preview.text ?? ""} /> : null}
            {canShowSource ? (
              <button
                type="button"
                title={t("artifacts.sourceTab")}
                aria-label={t("artifacts.sourceTab")}
                className={cn(
                  "oo-toolbar-button flex size-7 items-center justify-center rounded-md hover:bg-accent hover:text-foreground",
                  mode === "source" && "bg-accent text-foreground",
                )}
                onClick={() => setMode((current) => (current === "source" ? "preview" : "source"))}
              >
                <Code2 className="size-3.5" />
              </button>
            ) : null}
            <button
              type="button"
              title={t("artifacts.infoTab")}
              aria-label={t("artifacts.infoTab")}
              className={cn(
                "oo-toolbar-button flex size-7 items-center justify-center rounded-md hover:bg-accent hover:text-foreground",
                mode === "info" && "bg-accent text-foreground",
              )}
              onClick={() => setMode((current) => (current === "info" ? "preview" : "info"))}
            >
              <Info className="size-3.5" />
            </button>
          </div>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-auto">
        {loading ? (
          <div className="oo-text-body flex min-h-full items-center justify-center px-4 py-8 text-muted-foreground">
            {t("artifacts.previewLoading")}
          </div>
        ) : mode === "info" ? (
          <ArtifactInfo item={item} group={group} />
        ) : mode === "source" && canShowSource ? (
          <ArtifactSourcePreview item={item} preview={preview} />
        ) : (
          <ArtifactConsumablePreview item={item} pack={pack} preview={preview} onOpen={onOpen} />
        )}
      </div>
    </section>
  )
}

function CopyContentButton({ text }: { text: string }) {
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
    if (await writeClipboardText(text)) {
      setCopied(true)
      if (copiedTimerRef.current !== null) {
        window.clearTimeout(copiedTimerRef.current)
      }
      copiedTimerRef.current = window.setTimeout(() => {
        setCopied(false)
        copiedTimerRef.current = null
      }, 1200)
    }
  }

  return (
    <button
      type="button"
      title={copied ? t("artifacts.copied") : t("artifacts.copyContent")}
      aria-label={copied ? t("artifacts.copied") : t("artifacts.copyContent")}
      className="oo-toolbar-button flex size-7 items-center justify-center rounded-md hover:bg-accent hover:text-foreground"
      onClick={() => void copy()}
    >
      <Copy className="size-3.5" />
    </button>
  )
}

function ArtifactSourcePreview({
  item,
  preview,
}: {
  item: LocalArtifactItem
  preview: LocalArtifactPreviewResult | null
}) {
  const t = useT()

  return (
    <div className="oo-artifact-code-preview min-h-full p-3">
      <CodeBlock code={preview?.text ?? ""} language={previewLanguage(item)} showLineNumbers>
        <CodeBlockHeader>
          <CodeBlockTitle>
            <CodeBlockFilename>{item.name}</CodeBlockFilename>
          </CodeBlockTitle>
          <CodeBlockActions>
            <CodeBlockCopyButton aria-label={t("chat.copyMessage")} />
          </CodeBlockActions>
        </CodeBlockHeader>
      </CodeBlock>
      {preview?.truncated ? (
        <p className="oo-text-caption mt-2 text-muted-foreground">{t("artifacts.previewTruncated")}</p>
      ) : null}
    </div>
  )
}

function localArtifactPreviewUnavailableDescription(
  t: TranslateFn,
  item: LocalArtifactItem,
  preview: LocalArtifactPreviewResult | null,
): string {
  switch (preview?.reason) {
    case "missing":
      return t("artifacts.previewMissing")
    case "read_failed":
      return t("artifacts.previewReadFailed")
    case "too_large":
      return t("artifacts.previewTooLarge")
    case "unsupported_type":
      return t("artifacts.previewUnsupported", { type: preview.mime || item.mime })
    default:
      return t("artifacts.previewUnavailableDescription", { type: preview?.mime ?? item.mime })
  }
}

function ArtifactUnavailablePreview({
  description,
  item,
  onOpen,
  pack,
  preview,
}: {
  description?: string
  item: LocalArtifactItem
  onOpen: () => void
  pack?: LocalArtifactPack | null
  preview: LocalArtifactPreviewResult | null
}) {
  const t = useT()

  return (
    <div className="flex min-h-full flex-col items-center justify-center px-6 py-12 text-center">
      <div className="mb-3 flex size-12 items-center justify-center rounded-xl border border-border bg-muted/40 text-muted-foreground">
        <ArtifactIcon item={item} className="size-5" pack={pack} />
      </div>
      <div className="oo-text-title text-foreground">{t("artifacts.previewUnavailable")}</div>
      <p className="oo-text-caption mt-1 max-w-72 text-muted-foreground">
        {description ?? localArtifactPreviewUnavailableDescription(t, item, preview)}
      </p>
      <Button type="button" variant="outline" size="sm" className="mt-4 h-8 gap-1 px-3" onClick={onOpen}>
        <ExternalLink className="size-3.5" />
        {t("artifacts.open")}
      </Button>
    </div>
  )
}

function ArtifactCsvPreview({ item, preview }: { item: LocalArtifactItem; preview: LocalArtifactPreviewResult }) {
  const t = useT()
  const parsed = React.useMemo(() => parseCsvPreview(preview.text ?? ""), [preview.text])
  const [head = [], ...body] = parsed.rows
  const columnCount = Math.max(1, ...parsed.rows.map((row) => row.length))
  const columns = Array.from({ length: columnCount }, (_, index) => index)

  if (parsed.rows.length === 0) {
    return <ArtifactSourcePreview item={item} preview={preview} />
  }

  return (
    <div className="min-h-full bg-background p-3">
      <div className="oo-border-divider overflow-auto rounded-md border">
        <table className="min-w-full border-separate border-spacing-0 text-left text-sm">
          {head.length > 0 ? (
            <thead className="sticky top-0 z-10 bg-muted text-muted-foreground">
              <tr>
                {columns.map((index) => (
                  <th
                    key={index}
                    className="oo-border-divider border-b px-3 py-2 align-top font-medium whitespace-nowrap"
                  >
                    {head[index] || "-"}
                  </th>
                ))}
              </tr>
            </thead>
          ) : null}
          <tbody>
            {body.map((row, rowIndex) => (
              <tr key={rowIndex} className="odd:bg-background even:bg-muted/25">
                {columns.map((columnIndex) => (
                  <td key={columnIndex} className="oo-border-divider max-w-72 border-b px-3 py-2 align-top break-words">
                    {row[columnIndex] || ""}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {preview.truncated || parsed.truncated ? (
        <p className="oo-text-caption mt-2 text-muted-foreground">{t("artifacts.previewTruncated")}</p>
      ) : null}
    </div>
  )
}

function spreadsheetColumnLabel(index: number): string {
  let current = index + 1
  let label = ""
  while (current > 0) {
    current -= 1
    label = String.fromCharCode(65 + (current % 26)) + label
    current = Math.floor(current / 26)
  }
  return label
}

function ArtifactSpreadsheetPreview({ preview }: { preview: LocalArtifactPreviewResult }) {
  const t = useT()
  const sheet = preview.spreadsheet
  if (!sheet) {
    return null
  }
  const visibleColumnCount = Math.max(1, Math.min(sheet.columnCount, ...sheet.rows.map((row) => row.length)))
  const columns = Array.from({ length: visibleColumnCount }, (_, index) => index)

  return (
    <div className="min-h-full bg-background p-3">
      <div className="mb-2 flex min-w-0 flex-wrap items-center justify-between gap-2">
        <div className="oo-text-caption-compact min-w-0 truncate text-muted-foreground">
          <span className="font-medium text-foreground">{sheet.activeSheet || t("artifacts.sheetDefaultName")}</span>
          {sheet.sheets.length > 1 ? <span> · {t("artifacts.sheetCount", { count: sheet.sheets.length })}</span> : null}
        </div>
        <div className="oo-text-caption text-muted-foreground">
          {t("artifacts.sheetSize", { columns: sheet.columnCount, rows: sheet.rowCount })}
        </div>
      </div>
      <div className="oo-border-divider overflow-auto rounded-md border">
        <table className="min-w-full border-separate border-spacing-0 text-left text-sm">
          <thead className="sticky top-0 z-10 bg-muted text-muted-foreground">
            <tr>
              {columns.map((index) => (
                <th
                  key={index}
                  className="oo-border-divider border-b px-3 py-2 align-top font-medium whitespace-nowrap"
                >
                  {spreadsheetColumnLabel(index)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {sheet.rows.map((row, rowIndex) => (
              <tr key={rowIndex} className="odd:bg-background even:bg-muted/25">
                {columns.map((columnIndex) => (
                  <td key={columnIndex} className="oo-border-divider max-w-72 border-b px-3 py-2 align-top break-words">
                    {row[columnIndex] || ""}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {preview.truncated ? (
        <p className="oo-text-caption mt-2 text-muted-foreground">{t("artifacts.sheetTruncated")}</p>
      ) : null}
    </div>
  )
}

function ArtifactArchivePreview({ preview }: { preview: LocalArtifactPreviewResult }) {
  const t = useT()
  const archive = preview.archive
  if (!archive) {
    return null
  }

  return (
    <div className="min-h-full bg-background p-3">
      <div className="mb-2 flex min-w-0 flex-wrap items-center justify-between gap-2">
        <div className="oo-text-caption-compact font-medium text-foreground">
          {t("artifacts.archiveFormat", { format: archive.format.toUpperCase() })}
        </div>
        <div className="oo-text-caption text-muted-foreground">
          {t("artifacts.archiveCount", { count: archive.entries.length, total: archive.totalEntries })}
        </div>
      </div>
      <div className="oo-border-divider overflow-hidden rounded-md border">
        <table className="min-w-full border-separate border-spacing-0 text-left text-sm">
          <thead className="sticky top-0 z-10 bg-muted text-muted-foreground">
            <tr>
              <th className="oo-border-divider border-b px-3 py-2 font-medium whitespace-nowrap">
                {t("artifacts.archivePath")}
              </th>
              <th className="oo-border-divider border-b px-3 py-2 text-right font-medium whitespace-nowrap">
                {t("artifacts.archiveSize")}
              </th>
            </tr>
          </thead>
          <tbody>
            {archive.entries.map((entry, index) => (
              <tr key={`${entry.path}:${index}`} className="odd:bg-background even:bg-muted/25">
                <td className="oo-border-divider max-w-[32rem] border-b px-3 py-2 align-top break-all">
                  <span className="inline-flex items-center gap-2">
                    {entry.kind === "directory" ? (
                      <FolderOpen className="size-3.5 shrink-0" />
                    ) : (
                      <File className="size-3.5 shrink-0" />
                    )}
                    {entry.path}
                  </span>
                </td>
                <td className="oo-border-divider border-b px-3 py-2 text-right whitespace-nowrap text-muted-foreground">
                  {entry.kind === "directory" ? "-" : fileSizeLabel(entry.size)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {preview.truncated ? (
        <p className="oo-text-caption mt-2 text-muted-foreground">{t("artifacts.archiveTruncated")}</p>
      ) : null}
    </div>
  )
}

export function ArtifactConsumablePreview({
  item,
  preview,
  onOpen,
  pack,
}: {
  item: LocalArtifactItem
  preview: LocalArtifactPreviewResult | null
  onOpen: () => void
  pack?: LocalArtifactPack | null
}) {
  const t = useT()

  if (preview?.kind === "image" && preview.dataUrl) {
    return (
      <div className="flex min-h-full items-center justify-center bg-[var(--oo-artifact-preview-canvas)] p-4">
        <img
          src={preview.dataUrl}
          alt={item.name}
          className="max-h-full max-w-full rounded-md border border-border bg-background object-contain shadow-sm"
          draggable={false}
          decoding="async"
        />
      </div>
    )
  }

  if (preview?.kind === "media" && preview.dataUrl && isVideoArtifact(item)) {
    return (
      <div className="flex min-h-full items-center justify-center bg-[var(--oo-artifact-preview-canvas)] p-4">
        <video src={preview.dataUrl} controls className="max-h-full max-w-full rounded-md bg-black shadow-sm" />
      </div>
    )
  }

  if (preview?.kind === "media" && preview.dataUrl && isAudioArtifact(item)) {
    return (
      <div className="flex min-h-full flex-col items-center justify-center gap-4 px-6 py-12 text-center">
        <div className="flex size-14 items-center justify-center rounded-2xl border border-border bg-muted/40 text-muted-foreground shadow-sm">
          <Music className="size-6" />
        </div>
        <div className="w-full max-w-sm">
          <audio src={preview.dataUrl} controls className="w-full" />
        </div>
      </div>
    )
  }

  if (preview?.kind === "pdf" && preview.dataUrl) {
    return (
      <React.Suspense
        fallback={
          <div className="oo-text-body flex min-h-full items-center justify-center px-4 py-8 text-muted-foreground">
            {t("artifacts.previewLoading")}
          </div>
        }
      >
        <ArtifactPdfPreview dataUrl={preview.dataUrl} name={item.name} />
      </React.Suspense>
    )
  }

  if (preview?.kind === "document" && preview.documentFormat === "docx" && preview.dataUrl) {
    return (
      <React.Suspense
        fallback={
          <div className="oo-text-body flex min-h-full items-center justify-center px-4 py-8 text-muted-foreground">
            {t("artifacts.previewLoading")}
          </div>
        }
      >
        <ArtifactDocxPreview dataUrl={preview.dataUrl} name={item.name} />
      </React.Suspense>
    )
  }

  if (preview?.kind === "spreadsheet") {
    return <ArtifactSpreadsheetPreview preview={preview} />
  }

  if (preview?.kind === "archive") {
    return <ArtifactArchivePreview preview={preview} />
  }

  if (preview?.kind === "text" && isMarkdownArtifact(item)) {
    return (
      <div className="min-h-full px-5 py-4">
        <MessageResponse className="oo-markdown max-w-none">{preview.text ?? ""}</MessageResponse>
        {preview.truncated ? (
          <p className="oo-text-caption mt-3 text-muted-foreground">{t("artifacts.previewTruncated")}</p>
        ) : null}
      </div>
    )
  }

  if (preview?.kind === "text" && isHtmlArtifact(item)) {
    if (preview.truncated) {
      return (
        <ArtifactUnavailablePreview
          description={t("artifacts.htmlPreviewTruncated")}
          item={item}
          pack={pack}
          preview={preview}
          onOpen={onOpen}
        />
      )
    }
    return <ArtifactHtmlPreview preview={preview} />
  }

  if (preview?.kind === "text" && isCsvArtifact(item)) {
    return <ArtifactCsvPreview item={item} preview={preview} />
  }

  if (preview?.kind === "text") {
    return <ArtifactSourcePreview item={item} preview={preview} />
  }

  return <ArtifactUnavailablePreview item={item} pack={pack} preview={preview} onOpen={onOpen} />
}

function ArtifactHtmlPreview({ preview }: { preview: LocalArtifactPreviewResult }) {
  const t = useT()

  return (
    <div className="flex min-h-full min-w-0 flex-col bg-[var(--oo-artifact-preview-canvas)]">
      <iframe
        title={t("artifacts.htmlPreview")}
        srcDoc={htmlPreviewSrcDoc(preview.text ?? "")}
        sandbox=""
        referrerPolicy="no-referrer"
        className="block h-full min-h-[480px] w-full min-w-0 flex-1 border-0 bg-transparent"
      />
      {preview.truncated ? (
        <p className="oo-text-caption oo-border-divider border-t px-3 py-2 text-muted-foreground">
          {t("artifacts.previewTruncated")}
        </p>
      ) : null}
    </div>
  )
}

export function ArtifactInfo({ group, item }: { group: LocalArtifactGroup | null; item: LocalArtifactItem }) {
  const t = useT()
  const rows = [
    [t("artifacts.infoName"), item.name],
    [t("artifacts.infoType"), item.mime],
    [t("artifacts.infoSize"), fileSizeLabel(item.size) || "-"],
    [t("artifacts.infoPath"), item.path],
    ...(group?.root ? ([[t("artifacts.infoFolder"), group.root.path]] as string[][]) : []),
  ]

  return (
    <div className="grid gap-3 p-4">
      {rows.map(([label, value]) => (
        <div key={label} className="grid gap-1">
          <div className="oo-text-caption-compact font-medium text-muted-foreground">{label}</div>
          <div className="oo-text-body rounded-md border border-border bg-muted/30 px-3 py-2 break-all">{value}</div>
        </div>
      ))}
    </div>
  )
}
