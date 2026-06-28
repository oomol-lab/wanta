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

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max)
}

export default function ArtifactPdfPreview({ dataUrl, name }: { dataUrl: string; name: string }) {
  const t = useT()
  const containerRef = React.useRef<HTMLDivElement | null>(null)
  const [numPages, setNumPages] = React.useState(0)
  const [pageNumber, setPageNumber] = React.useState(1)
  const [scale, setScale] = React.useState(1)
  const [containerWidth, setContainerWidth] = React.useState(720)
  const pageWidth = Math.max(320, Math.min(920, containerWidth - 32)) * scale

  React.useEffect(() => {
    const container = containerRef.current
    if (!container) {
      return
    }
    const observer = new ResizeObserver((entries) => {
      const width = entries[0]?.contentRect.width
      if (width && Number.isFinite(width)) {
        setContainerWidth(width)
      }
    })
    observer.observe(container)
    return () => observer.disconnect()
  }, [])

  React.useEffect(() => {
    setNumPages(0)
    setPageNumber(1)
    setScale(1)
  }, [dataUrl])

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
            onClick={() => setScale((current) => clamp(current - scaleStep, minScale, maxScale))}
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
            onClick={() => setScale((current) => clamp(current + scaleStep, minScale, maxScale))}
          >
            <Plus className="size-3.5" />
          </Button>
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-auto p-4">
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
            <Page pageNumber={pageNumber} width={pageWidth} renderAnnotationLayer renderTextLayer />
          </div>
        </Document>
      </div>
    </div>
  )
}
