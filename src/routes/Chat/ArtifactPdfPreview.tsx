import type { PDFDocumentLoadingTask, PDFDocumentProxy } from "pdfjs-dist"

import { ChevronLeft, ChevronRight, Minus, Plus } from "lucide-react"
import * as pdfjs from "pdfjs-dist"
import { EventBus, LinkTarget, PDFLinkService, PDFViewer, ScrollMode } from "pdfjs-dist/web/pdf_viewer.mjs"
import * as React from "react"
import {
  adjacentPdfPage,
  pdfMaxScale,
  pdfMinScale,
  pdfScaleStep,
  steppedPdfScale,
} from "./artifact-pdf-preview-model.ts"
import { Button } from "@/components/ui/button"
import { useT } from "@/i18n/i18n"
import "pdfjs-dist/web/pdf_viewer.css"

pdfjs.GlobalWorkerOptions.workerSrc = new URL("pdfjs-dist/build/pdf.worker.min.mjs", import.meta.url).toString()

function isCancellation(error: unknown): boolean {
  return error instanceof Error && (error.name === "RenderingCancelledException" || error.name === "AbortException")
}

interface PageChangingEvent {
  pageNumber: number
}

interface ScaleChangingEvent {
  scale: number
}

export default function ArtifactPdfPreview({
  source,
  name,
  onResourceError,
}: {
  source: string
  name: string
  onResourceError?: () => void
}) {
  const t = useT()
  const scrollContainerRef = React.useRef<HTMLDivElement | null>(null)
  const pagesContainerRef = React.useRef<HTMLDivElement | null>(null)
  const viewerRef = React.useRef<PDFViewer | null>(null)
  const fitToWidthRef = React.useRef(true)
  const [loadFailed, setLoadFailed] = React.useState(false)
  const [loading, setLoading] = React.useState(true)
  const [numPages, setNumPages] = React.useState(0)
  const [pageNumber, setPageNumber] = React.useState(1)
  const [scale, setScale] = React.useState(1)

  React.useEffect(() => {
    const scrollContainer = scrollContainerRef.current
    const pagesContainer = pagesContainerRef.current
    if (!scrollContainer || !pagesContainer) {
      return
    }

    let cancelled = false
    let pagesInitialized = false
    let resizeFrame: number | null = null
    const abortController = new AbortController()
    const eventBus = new EventBus()
    const linkService = new PDFLinkService({
      eventBus,
      externalLinkRel: "noopener noreferrer nofollow",
      externalLinkTarget: LinkTarget.BLANK,
    })
    const viewerOptions = {
      abortSignal: abortController.signal,
      container: scrollContainer,
      eventBus,
      linkService,
      viewer: pagesContainer,
    }
    const viewer = new PDFViewer(viewerOptions)
    viewer.scrollMode = ScrollMode.VERTICAL
    linkService.setViewer(viewer)
    viewerRef.current = viewer
    fitToWidthRef.current = true
    setLoadFailed(false)
    setLoading(true)
    setNumPages(0)
    setPageNumber(1)
    setScale(1)

    const handlePagesInit = (): void => {
      if (cancelled) {
        return
      }
      pagesInitialized = true
      viewer.currentScaleValue = "page-width"
    }
    const handlePagesLoaded = ({ pagesCount }: { pagesCount: number }): void => {
      if (!cancelled) {
        setNumPages(pagesCount)
      }
    }
    const handlePageChanging = ({ pageNumber: nextPageNumber }: PageChangingEvent): void => {
      if (!cancelled) {
        setPageNumber(nextPageNumber)
      }
    }
    const handleScaleChanging = ({ scale: nextScale }: ScaleChangingEvent): void => {
      if (!cancelled && Number.isFinite(nextScale)) {
        setScale(nextScale)
      }
    }
    const handlePageRendered = (): void => {
      if (!cancelled) {
        setLoading(false)
      }
    }

    eventBus.on("pagesinit", handlePagesInit)
    eventBus.on("pagesloaded", handlePagesLoaded)
    eventBus.on("pagechanging", handlePageChanging)
    eventBus.on("scalechanging", handleScaleChanging)
    eventBus.on("pagerendered", handlePageRendered)

    const resizeObserver = new ResizeObserver(() => {
      if (!pagesInitialized || !fitToWidthRef.current || scrollContainer.clientWidth <= 0) {
        return
      }
      if (resizeFrame !== null) {
        window.cancelAnimationFrame(resizeFrame)
      }
      resizeFrame = window.requestAnimationFrame(() => {
        resizeFrame = null
        if (!cancelled && fitToWidthRef.current) {
          viewer.currentScaleValue = "page-width"
        }
      })
    })
    resizeObserver.observe(scrollContainer)

    const task: PDFDocumentLoadingTask = pdfjs.getDocument(source)
    void task.promise
      .then((document: PDFDocumentProxy) => {
        if (cancelled) {
          void document.destroy()
          return
        }
        setNumPages(document.numPages)
        linkService.setDocument(document)
        viewer.setDocument(document)
      })
      .catch((error: unknown) => {
        if (!cancelled && !isCancellation(error)) {
          setLoadFailed(true)
          setLoading(false)
          onResourceError?.()
        }
      })

    return () => {
      cancelled = true
      resizeObserver.disconnect()
      if (resizeFrame !== null) {
        window.cancelAnimationFrame(resizeFrame)
      }
      eventBus.off("pagesinit", handlePagesInit)
      eventBus.off("pagesloaded", handlePagesLoaded)
      eventBus.off("pagechanging", handlePageChanging)
      eventBus.off("scalechanging", handleScaleChanging)
      eventBus.off("pagerendered", handlePageRendered)
      abortController.abort()
      viewer.setDocument(null as unknown as PDFDocumentProxy)
      linkService.setDocument(null)
      if (viewerRef.current === viewer) {
        viewerRef.current = null
      }
      void task.destroy()
    }
  }, [onResourceError, source])

  const changePage = React.useCallback((delta: number) => {
    const viewer = viewerRef.current
    if (!viewer || viewer.pagesCount === 0) {
      return
    }
    viewer.currentPageNumber = adjacentPdfPage(viewer.currentPageNumber, viewer.pagesCount, delta)
  }, [])

  const applyScaleDelta = React.useCallback((delta: number) => {
    const viewer = viewerRef.current
    if (!viewer || viewer.pagesCount === 0 || !Number.isFinite(viewer.currentScale)) {
      return
    }
    fitToWidthRef.current = false
    viewer.currentScale = steppedPdfScale(viewer.currentScale, delta)
  }, [])

  return (
    <div className="flex min-h-full min-w-0 flex-col bg-[var(--oo-artifact-preview-canvas)]">
      <div className="oo-border-divider flex h-10 shrink-0 items-center justify-between gap-2 border-b bg-background px-3">
        <div className="oo-text-caption-compact min-w-0 truncate text-muted-foreground">
          <span className="font-medium text-foreground">{name}</span>
          {numPages > 0 ? <span> · {t("artifacts.pdfPage", { page: pageNumber, total: numPages })}</span> : null}
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-7"
            aria-label={t("artifacts.pdfPrevious")}
            disabled={pageNumber <= 1}
            onClick={() => changePage(-1)}
          >
            <ChevronLeft className="size-3.5" />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-7"
            aria-label={t("artifacts.pdfNext")}
            disabled={numPages === 0 || pageNumber >= numPages}
            onClick={() => changePage(1)}
          >
            <ChevronRight className="size-3.5" />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-7"
            aria-label={t("artifacts.pdfZoomOut")}
            disabled={scale <= pdfMinScale}
            onClick={() => applyScaleDelta(-pdfScaleStep)}
          >
            <Minus className="size-3.5" />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-7"
            aria-label={t("artifacts.pdfZoomIn")}
            disabled={scale >= pdfMaxScale}
            onClick={() => applyScaleDelta(pdfScaleStep)}
          >
            <Plus className="size-3.5" />
          </Button>
        </div>
      </div>
      <div className="relative min-h-0 flex-1">
        <div
          ref={scrollContainerRef}
          className="oo-pdf-scroll-container absolute inset-0 overflow-auto"
          aria-label={name}
          tabIndex={0}
        >
          <div ref={pagesContainerRef} className="pdfViewer oo-pdf-viewer" />
        </div>
        {loading || loadFailed ? (
          <div className="oo-text-body pointer-events-none absolute inset-0 flex items-center justify-center px-4 py-8 text-center text-muted-foreground">
            {loadFailed ? t("artifacts.previewReadFailed") : t("artifacts.previewLoading")}
          </div>
        ) : null}
      </div>
    </div>
  )
}
