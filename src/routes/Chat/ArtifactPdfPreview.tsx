import { ChevronLeft, ChevronRight, Minus, Plus } from "lucide-react"
import * as React from "react"
import { Document, Page, pdfjs } from "react-pdf"
import "react-pdf/dist/Page/AnnotationLayer.css"
import "react-pdf/dist/Page/TextLayer.css"

import { Button } from "@/components/ui/button"
import { useT } from "@/i18n/i18n"

pdfjs.GlobalWorkerOptions.workerSrc = new URL("pdfjs-dist/build/pdf.worker.min.mjs", import.meta.url).toString()

const minScale = 0.5
const maxScale = 2
const scaleStep = 0.1
const defaultPageAspectRatio = 1.414
const resizeRenderDelayMs = 140

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max)
}

function pageWidthForContainer(containerWidth: number, scale: number): number {
  return Math.round(Math.max(320, Math.min(920, containerWidth - 32)) * scale)
}

const MemoizedPdfPage = React.memo(function MemoizedPdfPage({
  onAspectRatioChange,
  pageNumber,
  width,
}: {
  onAspectRatioChange: (aspectRatio: number) => void
  pageNumber: number
  width: number
}) {
  return (
    <Page
      pageNumber={pageNumber}
      width={width}
      loading={null}
      renderAnnotationLayer
      renderTextLayer
      onLoadSuccess={(page) => {
        const viewport = page.getViewport({ scale: 1 })
        if (viewport.width > 0 && viewport.height > 0) {
          onAspectRatioChange(viewport.height / viewport.width)
        }
      }}
    />
  )
})

export default function ArtifactPdfPreview({ dataUrl, name }: { dataUrl: string; name: string }) {
  const t = useT()
  const containerRef = React.useRef<HTMLDivElement | null>(null)
  const renderedPageWidthRef = React.useRef<number | null>(null)
  const resizeRenderTimerRef = React.useRef<number | null>(null)
  const measuredContainerRef = React.useRef(false)
  const containerWidthRef = React.useRef<number | null>(null)
  const scaleRef = React.useRef(1)
  const [numPages, setNumPages] = React.useState(0)
  const [pageNumber, setPageNumber] = React.useState(1)
  const [scale, setScale] = React.useState(1)
  const [containerWidth, setContainerWidth] = React.useState<number | null>(null)
  const [renderedPageWidth, setRenderedPageWidth] = React.useState<number | null>(null)
  const [pageAspectRatio, setPageAspectRatio] = React.useState(defaultPageAspectRatio)
  const pageWidth = containerWidth === null ? null : pageWidthForContainer(containerWidth, scale)
  const pageHeight = pageWidth === null ? 0 : Math.round(pageWidth * pageAspectRatio)
  const visualScale = pageWidth !== null && renderedPageWidth !== null ? pageWidth / renderedPageWidth : 1
  const pageReady = pageWidth !== null && renderedPageWidth !== null

  const clearPendingRenderedWidth = React.useCallback(() => {
    if (resizeRenderTimerRef.current !== null) {
      window.clearTimeout(resizeRenderTimerRef.current)
      resizeRenderTimerRef.current = null
    }
  }, [])

  const commitRenderedWidth = React.useCallback(
    (nextWidth: number, delayMs: number) => {
      if (!Number.isFinite(nextWidth) || nextWidth <= 0) {
        return
      }
      const roundedWidth = Math.round(nextWidth)
      if (renderedPageWidthRef.current === roundedWidth && resizeRenderTimerRef.current === null) {
        clearPendingRenderedWidth()
        return
      }
      clearPendingRenderedWidth()
      if (delayMs <= 0) {
        renderedPageWidthRef.current = roundedWidth
        setRenderedPageWidth(roundedWidth)
        return
      }
      resizeRenderTimerRef.current = window.setTimeout(() => {
        renderedPageWidthRef.current = roundedWidth
        setRenderedPageWidth(roundedWidth)
        resizeRenderTimerRef.current = null
      }, delayMs)
    },
    [clearPendingRenderedWidth],
  )

  React.useEffect(() => {
    const container = containerRef.current
    if (!container) {
      return
    }
    const observer = new ResizeObserver((entries) => {
      const width = entries[0]?.contentRect.width
      if (width && Number.isFinite(width)) {
        const roundedWidth = Math.round(width)
        containerWidthRef.current = roundedWidth
        setContainerWidth((current) => (current === roundedWidth ? current : roundedWidth))
        commitRenderedWidth(
          pageWidthForContainer(roundedWidth, scaleRef.current),
          measuredContainerRef.current ? resizeRenderDelayMs : 0,
        )
        measuredContainerRef.current = true
      }
    })
    observer.observe(container)
    return () => observer.disconnect()
  }, [commitRenderedWidth])

  React.useEffect(() => {
    scaleRef.current = scale
  }, [scale])

  React.useEffect(() => clearPendingRenderedWidth, [clearPendingRenderedWidth])

  React.useEffect(() => {
    clearPendingRenderedWidth()
    setNumPages(0)
    setPageNumber(1)
    setScale(1)
    scaleRef.current = 1
    setPageAspectRatio(defaultPageAspectRatio)
    const measuredWidth = containerWidthRef.current
    const nextWidth = measuredWidth === null ? null : pageWidthForContainer(measuredWidth, 1)
    renderedPageWidthRef.current = nextWidth
    setRenderedPageWidth(nextWidth)
  }, [clearPendingRenderedWidth, dataUrl])

  const applyScaleDelta = React.useCallback(
    (delta: number) => {
      setScale((current) => {
        const nextScale = clamp(current + delta, minScale, maxScale)
        scaleRef.current = nextScale
        const measuredWidth = containerWidthRef.current
        if (measuredWidth !== null) {
          commitRenderedWidth(pageWidthForContainer(measuredWidth, nextScale), 0)
        }
        return nextScale
      })
    },
    [commitRenderedWidth],
  )

  return (
    <div ref={containerRef} className="flex min-h-full min-w-0 flex-col bg-[var(--oo-artifact-preview-canvas)]">
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
            onClick={() => setPageNumber((current) => Math.max(1, current - 1))}
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
            onClick={() => setPageNumber((current) => Math.min(numPages || current, current + 1))}
          >
            <ChevronRight className="size-3.5" />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-7"
            aria-label={t("artifacts.pdfZoomOut")}
            disabled={scale <= minScale}
            onClick={() => applyScaleDelta(-scaleStep)}
          >
            <Minus className="size-3.5" />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-7"
            aria-label={t("artifacts.pdfZoomIn")}
            disabled={scale >= maxScale}
            onClick={() => applyScaleDelta(scaleStep)}
          >
            <Plus className="size-3.5" />
          </Button>
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-auto p-4">
        {pageReady ? (
          <Document
            file={dataUrl}
            loading={
              <div className="oo-text-body py-8 text-center text-muted-foreground">{t("artifacts.previewLoading")}</div>
            }
            error={
              <div className="oo-text-body py-8 text-center text-muted-foreground">
                {t("artifacts.previewReadFailed")}
              </div>
            }
            onLoadSuccess={({ numPages: nextNumPages }) => {
              setNumPages(nextNumPages)
              setPageNumber((current) => Math.min(Math.max(1, current), nextNumPages))
            }}
          >
            <div className="flex justify-center">
              <div
                className="relative overflow-hidden"
                style={{
                  height: pageHeight,
                  width: pageWidth,
                }}
              >
                <div
                  className="absolute top-0 left-0 will-change-transform"
                  style={{
                    transform: `scale(${visualScale})`,
                    transformOrigin: "top left",
                    width: renderedPageWidth,
                  }}
                >
                  <MemoizedPdfPage
                    pageNumber={pageNumber}
                    width={renderedPageWidth}
                    onAspectRatioChange={setPageAspectRatio}
                  />
                </div>
              </div>
            </div>
          </Document>
        ) : (
          <div className="oo-text-body py-8 text-center text-muted-foreground">{t("artifacts.previewLoading")}</div>
        )}
      </div>
    </div>
  )
}
