import type {
  ComponentProps,
  Dispatch,
  MutableRefObject,
  PointerEvent,
  RefObject,
  SetStateAction,
  WheelEvent,
} from "react"

import { DownloadIcon, MinusIcon, PlusIcon, XIcon } from "lucide-react"
import { useEffect, useRef, useState } from "react"
import { createPortal } from "react-dom"
import { useChatService } from "@/components/AppContext"
import { useT } from "@/i18n/i18n"
import { cn } from "@/lib/utils"

type MarkdownImageProps = ComponentProps<"img"> & {
  node?: unknown
}

const localImagePreviewUrlByPath = new Map<string, string | null>()
const imageViewerMinScale = 0.1
const imageViewerMaxScale = 4
const imageViewerScaleStep = 0.1
const imageViewerMargin = 64
const mouseWheelZoomDelta = 0.12

interface ImageViewerSize {
  height: number
  width: number
}

interface ImageViewerOffset {
  x: number
  y: number
}

interface ImageViewerState {
  offset: ImageViewerOffset
  scale: number
}

interface ImageViewerDragState {
  originX: number
  originY: number
  pointerId: number
  scale: number
  startX: number
  startY: number
}

interface ImageViewerWheelAction {
  deltaX: number
  deltaY: number
  kind: "pan" | "zoom"
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max)
}

function imageViewerMaxOffset(imageLength: number, stageLength: number): number {
  return Math.abs(imageLength - stageLength) / 2
}

function imageFileName(value: string | null | undefined): string {
  const fallback = "image"
  if (!value) {
    return fallback
  }
  try {
    const url = new URL(value)
    const name = url.pathname.split(/[\\/]/).pop()
    return name || fallback
  } catch {
    const name = value.split(/[\\/]/).pop()
    return name || fallback
  }
}

function decodeLocalImagePathSegment(value: string): string {
  try {
    const decoded = decodeURIComponent(value)
    return /[\\/]/.test(decoded) ? value : decoded
  } catch {
    return value
  }
}

function decodeLocalImagePath(value: string): string {
  return value
    .split(/([\\/])/)
    .map((segment) => (segment === "/" || segment === "\\" ? segment : decodeLocalImagePathSegment(segment)))
    .join("")
}

export function localImagePathFromSrc(src: string | undefined): string | null {
  const value = src?.trim()
  if (!value || /^(?:https?:|data:|blob:|wanta:|wanta-local:)/i.test(value)) {
    return null
  }
  if (value.startsWith("file://")) {
    try {
      const url = new URL(value)
      const decoded = decodeURIComponent(url.pathname)
      return /^\/[A-Za-z]:[\\/]/.test(decoded) ? decoded.slice(1) : decoded
    } catch {
      return null
    }
  }
  if (/^(?:~?[\\/]|[A-Za-z]:[\\/])/.test(value)) {
    return decodeLocalImagePath(value)
  }
  return null
}

export function imageViewerFitScale(stageSize: ImageViewerSize, imageSize: ImageViewerSize): number {
  if (stageSize.width <= 0 || stageSize.height <= 0 || imageSize.width <= 0 || imageSize.height <= 0) {
    return 1
  }
  const availableWidth = Math.max(1, stageSize.width - imageViewerMargin * 2)
  const availableHeight = Math.max(1, stageSize.height - imageViewerMargin * 2)
  return clamp(
    Math.min(availableWidth / imageSize.width, availableHeight / imageSize.height, 1),
    imageViewerMinScale,
    imageViewerMaxScale,
  )
}

export function clampImageViewerOffset(
  offset: ImageViewerOffset,
  scale: number,
  imageSize: ImageViewerSize | null,
  stageSize: ImageViewerSize | null,
): ImageViewerOffset {
  if (!imageSize || !stageSize) {
    return { x: 0, y: 0 }
  }
  const maxX = imageViewerMaxOffset(imageSize.width * scale, stageSize.width)
  const maxY = imageViewerMaxOffset(imageSize.height * scale, stageSize.height)
  return {
    x: maxX === 0 ? 0 : clamp(offset.x, -maxX, maxX),
    y: maxY === 0 ? 0 : clamp(offset.y, -maxY, maxY),
  }
}

export function zoomImageViewerState(
  current: ImageViewerState,
  delta: number,
  imageSize: ImageViewerSize | null,
  stageSize: ImageViewerSize | null,
): ImageViewerState {
  const scale = clamp(current.scale + delta, imageViewerMinScale, imageViewerMaxScale)
  return {
    offset: clampImageViewerOffset(current.offset, scale, imageSize, stageSize),
    scale,
  }
}

export function panImageViewerState(
  current: ImageViewerState,
  deltaX: number,
  deltaY: number,
  imageSize: ImageViewerSize | null,
  stageSize: ImageViewerSize | null,
): ImageViewerState {
  return {
    ...current,
    offset: clampImageViewerOffset(
      {
        x: current.offset.x - deltaX,
        y: current.offset.y - deltaY,
      },
      current.scale,
      imageSize,
      stageSize,
    ),
  }
}

export function imageViewerWheelAction(event: {
  ctrlKey?: boolean
  deltaMode?: number
  deltaX: number
  deltaY: number
  metaKey?: boolean
  shiftKey?: boolean
}): ImageViewerWheelAction {
  if (event.ctrlKey || event.metaKey) {
    return { kind: "zoom", deltaX: 0, deltaY: event.deltaY }
  }
  if (event.shiftKey) {
    return { kind: "pan", deltaX: event.deltaY, deltaY: 0 }
  }
  if (event.deltaMode !== 0 || (Math.abs(event.deltaY) >= 48 && Math.abs(event.deltaX) < 1)) {
    return { kind: "zoom", deltaX: 0, deltaY: Math.sign(event.deltaY || 1) }
  }
  return { kind: "pan", deltaX: event.deltaX, deltaY: event.deltaY }
}

function viewerPercent(scale: number): string {
  return `${Math.round(scale * 100)}%`
}

export function MarkdownImage({ src, alt, className, node: _, ...props }: MarkdownImageProps) {
  const t = useT()
  const chatService = useChatService()
  const localPath = typeof src === "string" ? localImagePathFromSrc(src) : null
  const originalSrc = typeof src === "string" ? src : undefined
  const [previewUrl, setPreviewUrl] = useState<string | null>(() =>
    localPath ? (localImagePreviewUrlByPath.get(localPath) ?? null) : null,
  )
  const [isViewerOpen, setIsViewerOpen] = useState(false)
  const [stageSize, setStageSize] = useState<ImageViewerSize | null>(null)
  const [imageSize, setImageSize] = useState<ImageViewerSize | null>(null)
  const [viewerState, setViewerState] = useState<ImageViewerState>({ offset: { x: 0, y: 0 }, scale: 1 })
  const viewerStateRef = useRef<ImageViewerState>(viewerState)
  const stageRef = useRef<HTMLDivElement>(null)
  const dragRef = useRef<ImageViewerDragState | null>(null)

  useEffect(() => {
    if (!localPath) {
      setPreviewUrl(null)
      return
    }
    const cached = localImagePreviewUrlByPath.get(localPath)
    if (cached !== undefined) {
      setPreviewUrl(cached)
      return
    }
    setPreviewUrl(null)
    let cancelled = false
    void chatService
      .invoke("getAttachmentPreview", { path: localPath, mime: "application/octet-stream" })
      .then((result) => {
        if (cancelled) {
          return
        }
        localImagePreviewUrlByPath.set(localPath, result.dataUrl)
        setPreviewUrl(result.dataUrl)
      })
      .catch(() => {
        if (!cancelled) {
          localImagePreviewUrlByPath.set(localPath, null)
          setPreviewUrl(null)
        }
      })
    return () => {
      cancelled = true
    }
  }, [chatService, localPath])

  useEffect(() => {
    viewerStateRef.current = viewerState
  }, [viewerState])

  const visibleSrc = localPath ? previewUrl : originalSrc
  const downloadName = imageFileName(localPath ?? originalSrc)
  const previewTitle = alt || downloadName

  if (!visibleSrc) {
    if (localPath) {
      return null
    }
    return <img src={src} alt={alt ?? ""} className={className} draggable={false} decoding="async" {...props} />
  }

  return (
    <figure className="oo-markdown-image-preview">
      <button
        type="button"
        className="oo-markdown-image-open"
        aria-label={t("chat.imagePreview.open", { name: previewTitle })}
        onClick={() => setIsViewerOpen(true)}
      >
        <img src={visibleSrc} alt={alt ?? ""} className={className} draggable={false} decoding="async" {...props} />
      </button>
      <div className="oo-markdown-image-actions">
        <a
          className="oo-markdown-image-action"
          href={visibleSrc}
          download={downloadName}
          aria-label={t("chat.imagePreview.download")}
        >
          <DownloadIcon className="size-4" />
        </a>
      </div>
      {isViewerOpen
        ? createPortal(
            <ImageViewer
              alt={alt ?? ""}
              downloadName={downloadName}
              imageSize={imageSize}
              onClose={() => setIsViewerOpen(false)}
              setImageSize={setImageSize}
              setStageSize={setStageSize}
              setViewerState={setViewerState}
              src={visibleSrc}
              stageRef={stageRef}
              stageSize={stageSize}
              title={previewTitle}
              viewerState={viewerState}
              viewerStateRef={viewerStateRef}
              dragRef={dragRef}
            />,
            document.body,
          )
        : null}
    </figure>
  )
}

interface ImageViewerProps {
  alt: string
  downloadName: string
  dragRef: MutableRefObject<ImageViewerDragState | null>
  imageSize: ImageViewerSize | null
  onClose: () => void
  setImageSize: Dispatch<SetStateAction<ImageViewerSize | null>>
  setStageSize: Dispatch<SetStateAction<ImageViewerSize | null>>
  setViewerState: Dispatch<SetStateAction<ImageViewerState>>
  src: string
  stageRef: RefObject<HTMLDivElement | null>
  stageSize: ImageViewerSize | null
  title: string
  viewerState: ImageViewerState
  viewerStateRef: MutableRefObject<ImageViewerState>
}

export function ImageViewerModal({
  alt,
  downloadName,
  onClose,
  src,
  title,
}: {
  alt: string
  downloadName: string
  onClose: () => void
  src: string
  title: string
}) {
  const [stageSize, setStageSize] = useState<ImageViewerSize | null>(null)
  const [imageSize, setImageSize] = useState<ImageViewerSize | null>(null)
  const [viewerState, setViewerState] = useState<ImageViewerState>({ offset: { x: 0, y: 0 }, scale: 1 })
  const viewerStateRef = useRef<ImageViewerState>(viewerState)
  const stageRef = useRef<HTMLDivElement>(null)
  const dragRef = useRef<ImageViewerDragState | null>(null)

  useEffect(() => {
    viewerStateRef.current = viewerState
  }, [viewerState])

  return createPortal(
    <ImageViewer
      alt={alt}
      downloadName={downloadName}
      imageSize={imageSize}
      onClose={onClose}
      setImageSize={setImageSize}
      setStageSize={setStageSize}
      setViewerState={setViewerState}
      src={src}
      stageRef={stageRef}
      stageSize={stageSize}
      title={title}
      viewerState={viewerState}
      viewerStateRef={viewerStateRef}
      dragRef={dragRef}
    />,
    document.body,
  )
}

function ImageViewer({
  alt,
  downloadName,
  dragRef,
  imageSize,
  onClose,
  setImageSize,
  setStageSize,
  setViewerState,
  src,
  stageRef,
  stageSize,
  title,
  viewerState,
  viewerStateRef,
}: ImageViewerProps) {
  const t = useT()
  const [isDragging, setIsDragging] = useState(false)
  const canZoomOut = viewerState.scale > imageViewerMinScale
  const canZoomIn = viewerState.scale < imageViewerMaxScale

  useEffect(() => {
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = "hidden"
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === "Escape") {
        onClose()
      }
    }
    document.addEventListener("keydown", onKey)
    return () => {
      document.body.style.overflow = previousOverflow
      document.removeEventListener("keydown", onKey)
    }
  }, [onClose])

  useEffect(() => {
    const measureStage = (): void => {
      const rect = stageRef.current?.getBoundingClientRect()
      if (!rect) {
        return
      }
      setStageSize({ height: rect.height, width: rect.width })
    }
    measureStage()
    window.addEventListener("resize", measureStage)
    return () => window.removeEventListener("resize", measureStage)
  }, [setStageSize, stageRef])

  useEffect(() => {
    if (!imageSize || !stageSize) {
      return
    }
    const scale = imageViewerFitScale(stageSize, imageSize)
    const next = { offset: { x: 0, y: 0 }, scale }
    viewerStateRef.current = next
    setViewerState(next)
  }, [imageSize, setViewerState, stageSize, viewerStateRef])

  const zoomBy = (delta: number): void => {
    setViewerState((current) => {
      const next = zoomImageViewerState(current, delta, imageSize, stageSize)
      viewerStateRef.current = next
      return next
    })
  }

  const handleWheel = (event: WheelEvent<HTMLDivElement>): void => {
    event.preventDefault()
    const action = imageViewerWheelAction(event)
    if (action.kind === "zoom") {
      const delta =
        event.ctrlKey || event.metaKey
          ? clamp(-action.deltaY * 0.003, -0.25, 0.25)
          : -Math.sign(action.deltaY || 1) * mouseWheelZoomDelta
      setViewerState((current) => {
        const next = zoomImageViewerState(current, delta, imageSize, stageSize)
        viewerStateRef.current = next
        return next
      })
      return
    }
    setViewerState((current) => {
      const next = panImageViewerState(current, action.deltaX, action.deltaY, imageSize, stageSize)
      viewerStateRef.current = next
      return next
    })
  }

  const handlePointerDown = (event: PointerEvent<HTMLDivElement>): void => {
    if (!event.isPrimary || (event.pointerType === "mouse" && event.button !== 0)) {
      return
    }
    event.preventDefault()
    const current = viewerStateRef.current
    event.currentTarget.setPointerCapture(event.pointerId)
    dragRef.current = {
      originX: current.offset.x,
      originY: current.offset.y,
      pointerId: event.pointerId,
      scale: current.scale,
      startX: event.clientX,
      startY: event.clientY,
    }
    setIsDragging(true)
  }

  const handlePointerMove = (event: PointerEvent<HTMLDivElement>): void => {
    const drag = dragRef.current
    if (!drag || drag.pointerId !== event.pointerId) {
      return
    }
    const nextOffset = {
      x: drag.originX + event.clientX - drag.startX,
      y: drag.originY + event.clientY - drag.startY,
    }
    setViewerState((current) => {
      const next = {
        ...current,
        offset: clampImageViewerOffset(nextOffset, drag.scale, imageSize, stageSize),
      }
      viewerStateRef.current = next
      return next
    })
  }

  const stopDrag = (event: PointerEvent<HTMLDivElement>): void => {
    if (dragRef.current?.pointerId === event.pointerId) {
      dragRef.current = null
      setIsDragging(false)
      if (event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId)
      }
    }
  }

  const clearDrag = (event: PointerEvent<HTMLDivElement>): void => {
    if (dragRef.current?.pointerId === event.pointerId) {
      dragRef.current = null
      setIsDragging(false)
    }
  }

  return (
    <div className="oo-markdown-image-viewer" role="dialog" aria-modal="true" aria-label={title}>
      <div className="oo-markdown-image-viewer-actions">
        <a
          className="oo-markdown-image-viewer-action"
          href={src}
          download={downloadName}
          aria-label={t("chat.imagePreview.download")}
        >
          <DownloadIcon className="size-4" />
        </a>
        <button
          type="button"
          className="oo-markdown-image-viewer-action"
          aria-label={t("chat.imagePreview.close")}
          onClick={onClose}
        >
          <XIcon className="size-5" />
        </button>
      </div>

      <div
        ref={stageRef}
        className={cn("oo-markdown-image-viewer-stage", isDragging && "is-dragging")}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={stopDrag}
        onPointerCancel={stopDrag}
        onLostPointerCapture={clearDrag}
        onWheel={handleWheel}
      >
        <div className="oo-markdown-image-viewer-center">
          <div
            className="oo-markdown-image-viewer-offset"
            style={{ transform: `translate(${viewerState.offset.x}px, ${viewerState.offset.y}px)` }}
          >
            <img
              src={src}
              alt={alt}
              className="oo-markdown-image-viewer-image"
              draggable={false}
              decoding="async"
              onLoad={(event) => {
                setImageSize({
                  height: event.currentTarget.naturalHeight,
                  width: event.currentTarget.naturalWidth,
                })
              }}
              style={{
                height: imageSize ? `${imageSize.height}px` : undefined,
                transform: `scale(${viewerState.scale})`,
                width: imageSize ? `${imageSize.width}px` : undefined,
              }}
            />
          </div>
        </div>
      </div>

      <div className="oo-markdown-image-viewer-zoom" aria-label={viewerPercent(viewerState.scale)}>
        <button
          type="button"
          className="oo-markdown-image-viewer-zoom-button"
          aria-label={t("chat.imagePreview.zoomOut")}
          disabled={!canZoomOut}
          onClick={() => zoomBy(-imageViewerScaleStep)}
        >
          <MinusIcon className="size-4" />
        </button>
        <span className="oo-markdown-image-viewer-percent">{viewerPercent(viewerState.scale)}</span>
        <button
          type="button"
          className="oo-markdown-image-viewer-zoom-button"
          aria-label={t("chat.imagePreview.zoomIn")}
          disabled={!canZoomIn}
          onClick={() => zoomBy(imageViewerScaleStep)}
        >
          <PlusIcon className="size-4" />
        </button>
      </div>
    </div>
  )
}
