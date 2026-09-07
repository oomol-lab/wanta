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
import { toast } from "sonner"
import { htmlPreviewSandbox, htmlPreviewSrcDoc } from "./artifact-html-preview.ts"
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
import { artifactPreviewCacheKey, useLocalArtifactPreview } from "./artifact-preview-cache.ts"
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
import { ErrorBoundary } from "@/components/ErrorBoundary"
import { Button } from "@/components/ui/button"
import { useT } from "@/i18n/i18n"
import { writeClipboardText } from "@/lib/clipboard"
import { cn } from "@/lib/utils"

const ArtifactPdfPreview = React.lazy(() => import("./ArtifactPdfPreview.tsx"))
const ArtifactDocxPreview = React.lazy(() => import("./ArtifactDocxPreview.tsx"))
function loadArtifactUniverSpreadsheetPreview(): Promise<{
  default: typeof import("./ArtifactUniverSpreadsheetPreview.tsx").ArtifactUniverSpreadsheetPreview
}> {
  return import("./ArtifactUniverSpreadsheetPreview.tsx").then((module) => ({
    default: module.ArtifactUniverSpreadsheetPreview,
  }))
}
const ArtifactUniverSpreadsheetPreview = React.lazy(loadArtifactUniverSpreadsheetPreview)

export type ArtifactPreviewMode = "preview" | "source" | "info"

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
  mode,
  onContextMenu,
  onModeChange,
  pack,
  previewCache,
  showHeader = true,
  onOpen,
}: {
  group: LocalArtifactGroup | null
  item: LocalArtifactItem | null
  mode?: ArtifactPreviewMode
  onContextMenu: (item: LocalArtifactItem, x: number, y: number) => void
  onModeChange?: (mode: ArtifactPreviewMode) => void
  pack?: LocalArtifactPack | null
  previewCache: LocalArtifactPreviewCache
  showHeader?: boolean
  onOpen: () => void
}) {
  const t = useT()
  const { loading, preview, reload, retry, resourceLoaded } = useLocalArtifactPreview(item, previewCache)
  const scrollRef = React.useRef<HTMLDivElement | null>(null)
  const fileKey = item ? artifactPreviewCacheKey(item) : null
  React.useLayoutEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = 0
      scrollRef.current.scrollLeft = 0
    }
  }, [fileKey])
  const [internalMode, setInternalMode] = React.useState<ArtifactPreviewMode>("preview")
  const activeMode = mode ?? internalMode
  const canShowSource = preview?.kind === "text"
  const setActiveMode = React.useCallback(
    (nextMode: ArtifactPreviewMode | ((current: ArtifactPreviewMode) => ArtifactPreviewMode)): void => {
      const resolvedMode = typeof nextMode === "function" ? nextMode(activeMode) : nextMode
      if (onModeChange) {
        onModeChange(resolvedMode)
        return
      }
      setInternalMode(resolvedMode)
    },
    [activeMode, onModeChange],
  )

  React.useEffect(() => {
    if (!onModeChange) {
      setInternalMode("preview")
    }
  }, [item?.path, onModeChange])

  const spreadsheetSelected =
    !!item &&
    (isCsvArtifact(item) ||
      item.name.toLowerCase().endsWith(".xlsx") ||
      item.mime.toLowerCase() === "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")
  React.useEffect(() => {
    if (spreadsheetSelected) {
      // Rendering the lazy component reports a chunk failure through its error boundary.
      void loadArtifactUniverSpreadsheetPreview().catch(() => undefined)
    }
  }, [spreadsheetSelected])

  if (!item) {
    return <ArtifactsEmptyState />
  }
  const spreadsheetReady = !loading && preview?.kind === "spreadsheet"

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
      {showHeader ? (
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
                    activeMode === "source" && "bg-accent text-foreground",
                  )}
                  onClick={() => setActiveMode((current) => (current === "source" ? "preview" : "source"))}
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
                  activeMode === "info" && "bg-accent text-foreground",
                )}
                onClick={() => setActiveMode((current) => (current === "info" ? "preview" : "info"))}
              >
                <Info className="size-3.5" />
              </button>
            </div>
          </div>
        </div>
      ) : null}

      <div
        ref={scrollRef}
        className={cn(
          "min-h-0 flex-1",
          activeMode === "preview" && preview?.kind === "pdf" ? "overflow-hidden" : "overflow-auto",
        )}
      >
        {spreadsheetSelected ? (
          <div className={cn("h-full min-h-0", (activeMode !== "preview" || !spreadsheetReady) && "hidden")}>
            <ErrorBoundary
              resetKey={preview ?? fileKey}
              fallback={<ArtifactUnavailablePreview item={item} preview={preview} onOpen={onOpen} onRetry={retry} />}
            >
              <React.Suspense fallback={<ArtifactSpreadsheetLoadingPreview />}>
                <ArtifactUniverSpreadsheetPreview preview={spreadsheetReady ? preview : null} />
              </React.Suspense>
            </ErrorBoundary>
          </div>
        ) : null}
        <div
          key={fileKey}
          className={cn(
            "h-full min-h-0",
            spreadsheetSelected && spreadsheetReady && activeMode === "preview" && "hidden",
          )}
        >
          {activeMode === "info" ? (
            <ArtifactInfo item={item} group={group} />
          ) : loading ? (
            <div className="oo-text-body flex min-h-full items-center justify-center px-4 py-8 text-muted-foreground">
              {t("artifacts.previewLoading")}
            </div>
          ) : activeMode === "source" && canShowSource ? (
            <ArtifactSourcePreview item={item} preview={preview} />
          ) : spreadsheetSelected && spreadsheetReady ? null : (
            <ArtifactConsumablePreview
              item={item}
              pack={pack}
              preview={preview}
              onOpen={onOpen}
              onResourceError={reload}
              onResourceLoaded={resourceLoaded}
              onRetry={retry}
            />
          )}
        </div>
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
            <CodeBlockCopyButton
              aria-label={t("chat.copyMessage")}
              onError={() => toast.error(t("error.copyFailed"))}
            />
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
  if (item.kind === "directory") {
    return t("artifacts.folderPreviewDescription")
  }
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
  onRetry,
  description,
  item,
  onOpen,
  pack,
  preview,
}: {
  description?: string
  onRetry?: () => void
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
      <div className="oo-text-title text-foreground">
        {item.kind === "directory" ? t("artifacts.folderPreviewTitle") : t("artifacts.previewUnavailable")}
      </div>
      <p className="oo-text-caption mt-1 max-w-72 text-muted-foreground">
        {description ?? localArtifactPreviewUnavailableDescription(t, item, preview)}
      </p>
      {onRetry ? (
        <Button type="button" variant="outline" size="sm" className="mt-4" onClick={onRetry}>
          {t("artifacts.retry")}
        </Button>
      ) : null}
      <Button type="button" variant="outline" size="sm" className="mt-4 h-8 gap-1 px-3" onClick={onOpen}>
        <ExternalLink className="size-3.5" />
        {t("artifacts.open")}
      </Button>
    </div>
  )
}

function ArtifactSpreadsheetLoadingPreview() {
  const t = useT()

  return (
    <div className="flex h-full min-h-0 min-w-0 flex-col bg-[var(--oo-artifact-preview-canvas)] p-3">
      <div className="oo-univer-spreadsheet-preview oo-border-divider relative min-h-0 flex-1 overflow-hidden rounded-md border bg-background">
        <div className="oo-text-body absolute inset-0 flex items-center justify-center px-4 py-8 text-muted-foreground">
          {t("artifacts.previewLoading")}
        </div>
      </div>
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
          {archive.totalEntries === null
            ? t("artifacts.archiveShownCount", { count: archive.entries.length })
            : t("artifacts.archiveCount", { count: archive.entries.length, total: archive.totalEntries })}
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

function ArtifactVideoPreview({
  item,
  onOpen,
  onResourceError,
  onResourceLoaded,
  onRetry,
  pack,
  preview,
  source,
}: {
  item: LocalArtifactItem
  onOpen: () => void
  onResourceError?: () => void
  onResourceLoaded?: () => void
  onRetry?: () => void
  pack?: LocalArtifactPack | null
  preview: LocalArtifactPreviewResult
  source: string
}) {
  const t = useT()
  const [failure, setFailure] = React.useState<"resource" | "unsupported_source" | null>(null)

  React.useEffect(() => {
    setFailure(null)
  }, [source])

  if (failure) {
    return (
      <ArtifactUnavailablePreview
        description={t(
          failure === "unsupported_source" ? "artifacts.videoCodecUnsupported" : "artifacts.previewReadFailed",
        )}
        item={item}
        pack={pack}
        preview={preview}
        onOpen={onOpen}
        onRetry={failure === "resource" ? onRetry : undefined}
      />
    )
  }

  return (
    <div className="flex h-full min-h-0 items-center justify-center bg-[var(--oo-artifact-preview-canvas)] p-4">
      <video
        src={source}
        controls
        playsInline
        preload="metadata"
        className="max-h-full max-w-full rounded-md bg-black object-contain shadow-sm"
        onLoadedData={onResourceLoaded}
        onError={(event) => {
          if (event.currentTarget.error?.code === MediaError.MEDIA_ERR_SRC_NOT_SUPPORTED) {
            setFailure("unsupported_source")
            return
          }
          setFailure("resource")
          onResourceError?.()
        }}
      />
    </div>
  )
}

export function ArtifactConsumablePreview({
  item,
  preview,
  onOpen,
  pack,
  onResourceError,
  onResourceLoaded,
  onRetry,
  imageGallery = false,
}: {
  item: LocalArtifactItem
  preview: LocalArtifactPreviewResult | null
  onOpen: () => void
  pack?: LocalArtifactPack | null
  onResourceError?: () => void
  onResourceLoaded?: () => void
  onRetry?: () => void
  imageGallery?: boolean
}) {
  const t = useT()
  const [failedSource, setFailedSource] = React.useState<string | null>(null)
  const resourceSource = preview?.resourceUrl ?? preview?.dataUrl
  const lazyPreviewFallback = (
    <ArtifactUnavailablePreview
      item={item}
      preview={preview}
      onOpen={onOpen}
      onRetry={onRetry}
      description={t("artifacts.previewReadFailed")}
    />
  )
  const resourceError = () => {
    setFailedSource(resourceSource ?? null)
    onResourceError?.()
  }
  if (resourceSource && failedSource === resourceSource) return lazyPreviewFallback

  if (preview?.kind === "image" && resourceSource) {
    return (
      <div className="flex h-full min-h-0 items-center justify-center bg-[var(--oo-artifact-preview-canvas)] p-4">
        <img
          src={resourceSource}
          alt={item.name}
          className={cn(
            "max-h-full max-w-full object-contain",
            imageGallery ? "drop-shadow-sm" : "rounded-md border border-border bg-background shadow-sm",
          )}
          onDoubleClick={imageGallery ? onOpen : undefined}
          draggable={false}
          decoding="async"
          onLoad={onResourceLoaded}
          onError={resourceError}
        />
      </div>
    )
  }

  if (preview?.kind === "media" && resourceSource && isVideoArtifact(item)) {
    return (
      <ArtifactVideoPreview
        item={item}
        pack={pack}
        preview={preview}
        source={resourceSource}
        onOpen={onOpen}
        onResourceError={onResourceError}
        onResourceLoaded={onResourceLoaded}
        onRetry={onRetry}
      />
    )
  }

  if (preview?.kind === "media" && resourceSource && isAudioArtifact(item)) {
    return (
      <div className="flex min-h-full flex-col items-center justify-center gap-4 px-6 py-12 text-center">
        <div className="flex size-14 items-center justify-center rounded-2xl border border-border bg-muted/40 text-muted-foreground shadow-sm">
          <Music className="size-6" />
        </div>
        <div className="w-full max-w-sm">
          <audio
            src={resourceSource}
            controls
            preload="metadata"
            className="w-full"
            onLoadedData={onResourceLoaded}
            onError={resourceError}
          />
        </div>
      </div>
    )
  }

  if (preview?.kind === "pdf" && resourceSource) {
    return (
      <ErrorBoundary key={`${item.path}:pdf`} fallback={lazyPreviewFallback}>
        <React.Suspense
          fallback={
            <div className="oo-text-body flex min-h-full items-center justify-center px-4 py-8 text-muted-foreground">
              {t("artifacts.previewLoading")}
            </div>
          }
        >
          <ArtifactPdfPreview
            source={resourceSource}
            name={item.name}
            onResourceError={onResourceError}
            onResourceLoaded={onResourceLoaded}
            onRetry={onRetry}
          />
        </React.Suspense>
      </ErrorBoundary>
    )
  }

  if (preview?.kind === "document" && preview.documentFormat === "docx" && resourceSource) {
    return (
      <ErrorBoundary key={`${item.path}:docx`} fallback={lazyPreviewFallback}>
        <React.Suspense
          fallback={
            <div className="oo-text-body flex min-h-full items-center justify-center px-4 py-8 text-muted-foreground">
              {t("artifacts.previewLoading")}
            </div>
          }
        >
          <ArtifactDocxPreview
            source={resourceSource}
            name={item.name}
            onResourceError={onResourceError}
            onResourceLoaded={onResourceLoaded}
            onRetry={onRetry}
          />
        </React.Suspense>
      </ErrorBoundary>
    )
  }

  if (preview?.kind === "spreadsheet") {
    return (
      <ErrorBoundary key={`${item.path}:spreadsheet`} fallback={lazyPreviewFallback}>
        <React.Suspense fallback={<ArtifactSpreadsheetLoadingPreview />}>
          <ArtifactUniverSpreadsheetPreview preview={preview} />
        </React.Suspense>
      </ErrorBoundary>
    )
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

  if (preview?.kind === "text") {
    return <ArtifactSourcePreview item={item} preview={preview} />
  }

  return (
    <ArtifactUnavailablePreview
      item={item}
      pack={pack}
      preview={preview}
      onOpen={onOpen}
      onRetry={preview?.reason === "read_failed" ? onRetry : undefined}
    />
  )
}

function ArtifactHtmlPreview({ preview }: { preview: LocalArtifactPreviewResult }) {
  const t = useT()
  const source = preview.text ?? ""

  return (
    <div className="flex h-full min-h-0 min-w-0 flex-col bg-[var(--oo-artifact-preview-canvas)]">
      <iframe
        title={t("artifacts.htmlPreview")}
        srcDoc={htmlPreviewSrcDoc(source)}
        sandbox={htmlPreviewSandbox()}
        referrerPolicy="no-referrer"
        className="block h-full min-h-0 w-full min-w-0 flex-1 border-0 bg-transparent"
      />
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
