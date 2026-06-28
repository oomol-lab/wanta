import type { PDFDocumentLoadingTask, PDFDocumentProxy, RenderTask } from "pdfjs-dist"

import { ChevronLeft, ChevronRight, Minus, Plus } from "lucide-react"
import * as pdfjs from "pdfjs-dist"
import * as React from "react"
import { Button } from "@/components/ui/button"
import { useT } from "@/i18n/i18n"

pdfjs.GlobalWorkerOptions.workerSrc = new URL("pdfjs-dist/build/pdf.worker.min.mjs", import.meta.url).toString()

const minScale = 0.5
const maxScale = 2
const scaleStep = 0.1
const defaultPageAspectRatio = 1.414
const maxDevicePixelRatio = 2
const resizeRenderDelayMs = 140

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max)
}

function pageWidthForContainer(containerWidth: number, scale: number): number {
  return Math.round(Math.max(320, Math.min(920, containerWidth - 32)) * scale)
}

function isCancellation(error: unknown): boolean {
  return error instanceof Error && (error.name === "RenderingCancelledException" || error.name === "AbortException")
}

interface RenderedPageMetrics {
  height: number
  width: number
}

export default function ArtifactPdfPreview({ dataUrl, name }: { dataUrl: string; name: string }) {
  const t = useT()
  const containerRef = React.useRef<HTMLDivElement | null>(null)
  const canvasRefs = React.useRef<[HTMLCanvasElement | null, HTMLCanvasElement | null]>([null, null])
  const activeBufferRef = React.useRef<0 | 1>(0)
  const documentTaskRef = React.useRef<PDFDocumentLoadingTask | null>(null)
  const renderTaskRef = React.useRef<RenderTask | null>(null)
  const renderGenerationRef = React.useRef(0)
  const renderedPageWidthRef = React.useRef<number | null>(null)
  const resizeRenderTimerRef = React.useRef<number | null>(null)
  const measuredContainerRef = React.useRef(false)
  const containerWidthRef = React.useRef<number | null>(null)
  const scaleRef = React.useRef(1)
  const [activeBuffer, setActiveBuffer] = React.useState<0 | 1>(0)
  const [loadFailed, setLoadFailed] = React.useState(false)
  const [numPages, setNumPages] = React.useState(0)
  const [pageNumber, setPageNumber] = React.useState(1)
  const [scale, setScale] = React.useState(1)
  const [containerWidth, setContainerWidth] = React.useState<number | null>(null)
  const [document, setDocument] = React.useState<PDFDocumentProxy | null>(null)
  const [renderedPage, setRenderedPage] = React.useState<RenderedPageMetrics | null>(null)
  const [renderedPageWidth, setRenderedPageWidth] = React.useState<number | null>(null)
  const [pageAspectRatio, setPageAspectRatio] = React.useState(defaultPageAspectRatio)
  const pageWidth = containerWidth === null ? null : pageWidthForContainer(containerWidth, scale)
  const pageHeight = pageWidth === null ? 0 : Math.round(pageWidth * pageAspectRatio)
  const visualScale =
    pageWidth !== null && renderedPage !== null && renderedPage.width > 0 ? pageWidth / renderedPage.width : 1
  const pageReady = pageWidth !== null && renderedPageWidth !== null
  const loading = !loadFailed && (!document || !renderedPage)

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
    const generation = ++renderGenerationRef.current
    renderTaskRef.current?.cancel()
    documentTaskRef.current?.destroy()
    clearPendingRenderedWidth()
    setActiveBuffer(0)
    activeBufferRef.current = 0
    setDocument(null)
    setLoadFailed(false)
    setNumPages(0)
    setPageNumber(1)
    setRenderedPage(null)
    setScale(1)
    scaleRef.current = 1
    setPageAspectRatio(defaultPageAspectRatio)
    const measuredWidth = containerWidthRef.current
    const nextWidth = measuredWidth === null ? null : pageWidthForContainer(measuredWidth, 1)
    renderedPageWidthRef.current = nextWidth
    setRenderedPageWidth(nextWidth)

    const task = pdfjs.getDocument(dataUrl)
    documentTaskRef.current = task
    void task.promise
      .then((nextDocument) => {
        if (renderGenerationRef.current !== generation) {
          void nextDocument.destroy()
          return
        }
        setDocument(nextDocument)
        setNumPages(nextDocument.numPages)
      })
      .catch((error: unknown) => {
        if (renderGenerationRef.current === generation && !isCancellation(error)) {
          setLoadFailed(true)
        }
      })

    return () => {
      if (documentTaskRef.current === task) {
        documentTaskRef.current = null
      }
      void task.destroy()
    }
  }, [clearPendingRenderedWidth, dataUrl])

  React.useEffect(() => {
    if (!document || renderedPageWidth === null) {
      return
    }

    const generation = ++renderGenerationRef.current
    renderTaskRef.current?.cancel()
    renderTaskRef.current = null
    let renderTask: RenderTask | null = null
    let cancelled = false

    void document
      .getPage(pageNumber)
      .then((page) => {
        if (cancelled || renderGenerationRef.current !== generation) {
          return
        }

        const baseViewport = page.getViewport({ scale: 1 })
        if (baseViewport.width <= 0 || baseViewport.height <= 0) {
          setLoadFailed(true)
          return
        }

        const ratio = baseViewport.height / baseViewport.width
        setPageAspectRatio(ratio)

        const cssWidth = Math.round(renderedPageWidth)
        const cssHeight = Math.round(cssWidth * ratio)
        const pixelRatio = Math.min(window.devicePixelRatio || 1, maxDevicePixelRatio)
        const viewport = page.getViewport({ scale: (cssWidth / baseViewport.width) * pixelRatio })
        const buffer = activeBufferRef.current === 0 ? 1 : 0
        const canvas = canvasRefs.current[buffer]
        const context = canvas?.getContext("2d", { alpha: false })
        if (!canvas || !context) {
          setLoadFailed(true)
          return
        }

        canvas.width = Math.max(1, Math.round(viewport.width))
        canvas.height = Math.max(1, Math.round(viewport.height))
        canvas.style.width = `${cssWidth}px`
        canvas.style.height = `${cssHeight}px`
        context.fillStyle = "#ffffff"
        context.fillRect(0, 0, canvas.width, canvas.height)

        renderTask = page.render({
          canvas,
          viewport,
          background: "#ffffff",
        })
        renderTaskRef.current = renderTask

        return renderTask.promise.then(() => {
          if (cancelled || renderGenerationRef.current !== generation) {
            return
          }
          activeBufferRef.current = buffer
          setActiveBuffer(buffer)
          setRenderedPage({ height: cssHeight, width: cssWidth })
          setLoadFailed(false)
        })
      })
      .catch((error: unknown) => {
        if (!cancelled && renderGenerationRef.current === generation && !isCancellation(error)) {
          setLoadFailed(true)
        }
      })

    return () => {
      cancelled = true
      renderTask?.cancel()
    }
  }, [document, pageNumber, renderedPageWidth])

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
      <div className="relative min-h-0 flex-1 overflow-auto p-4">
        {pageReady ? (
          <div
            className={
              renderedPage ? "flex justify-center" : "pointer-events-none absolute h-0 w-0 overflow-hidden opacity-0"
            }
          >
            <div
              className="relative overflow-hidden bg-white shadow-sm"
              style={{
                height: pageHeight,
                width: pageWidth,
              }}
            >
              <div
                className="absolute top-0 left-0 will-change-transform"
                style={{
                  height: renderedPage?.height ?? pageHeight,
                  transform: `scale(${visualScale})`,
                  transformOrigin: "top left",
                  width: renderedPage?.width ?? renderedPageWidth,
                }}
              >
                <canvas
                  ref={(canvas) => {
                    canvasRefs.current[0] = canvas
                  }}
                  aria-label={name}
                  className={activeBuffer === 0 && renderedPage ? "block" : "hidden"}
                />
                <canvas
                  ref={(canvas) => {
                    canvasRefs.current[1] = canvas
                  }}
                  aria-label={name}
                  className={activeBuffer === 1 && renderedPage ? "block" : "hidden"}
                />
              </div>
            </div>
          </div>
        ) : null}
        {loading || loadFailed ? (
          <div className="oo-text-body py-8 text-center text-muted-foreground">
            {loadFailed ? t("artifacts.previewReadFailed") : t("artifacts.previewLoading")}
          </div>
        ) : null}
      </div>
    </div>
  )
}
