import type { AttachmentPreviewResult } from "../../../electron/chat/common.ts"
import type {
  ComponentProps,
  Dispatch,
  MutableRefObject,
  PointerEvent,
  RefObject,
  ReactElement,
  SetStateAction,
  WheelEvent,
} from "react"

import {
  CopyIcon,
  EllipsisIcon,
  ExternalLinkIcon,
  FolderOpenIcon,
  MinusIcon,
  PlusIcon,
  SaveIcon,
  XIcon,
} from "lucide-react"
import { ContextMenu as ContextMenuPrimitive } from "radix-ui"
import { useEffect, useRef, useState } from "react"
import { createPortal } from "react-dom"
import { toast } from "sonner"
import { useChatService } from "@/components/AppContext"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { useT } from "@/i18n/i18n"
import { reportRendererHandledError } from "@/lib/renderer-diagnostics"
import { resolveUserFacingError, userFacingErrorDescription } from "@/lib/user-facing-error"
import { cn } from "@/lib/utils"

type MarkdownImageProps = ComponentProps<"img"> & {
  node?: unknown
}

interface LocalImagePreviewCacheEntry {
  expiresAt?: number
  url: string | null
}

const localImagePreviewUrlByPath = new Map<string, LocalImagePreviewCacheEntry>()
const localImagePreviewRefreshMarginMs = 60_000
const imageViewerMinScale = 0.1
const imageViewerMaxScale = 4
const imageViewerScaleStep = 0.1
const imageViewerMargin = 64
const mouseWheelZoomDelta = 0.12

export function attachmentPreviewSource(result: AttachmentPreviewResult): string | null {
  return result.resourceUrl ?? result.dataUrl
}

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
  if (/^file:\/\//i.test(value)) {
    try {
      const url = new URL(value)
      const decoded = decodeURIComponent(url.pathname)
      return /^\/[A-Za-z]:[\\/]/.test(decoded) ? decoded.slice(1) : decoded
    } catch {
      return null
    }
  }
  if (/^(?:[\\/]|[A-Za-z]:[\\/])/.test(value)) {
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
  const [previewUrl, setPreviewUrl] = useState<string | null>(() => {
    if (!localPath) {
      return null
    }
    const cached = localImagePreviewUrlByPath.get(localPath)
    return cached && (!cached.expiresAt || cached.expiresAt > Date.now() + localImagePreviewRefreshMarginMs)
      ? cached.url
      : null
  })
  const [previewRetry, setPreviewRetry] = useState(0)
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
    if (cached && (!cached.expiresAt || cached.expiresAt > Date.now() + localImagePreviewRefreshMarginMs)) {
      setPreviewUrl(cached.url)
      return
    }
    localImagePreviewUrlByPath.delete(localPath)
    setPreviewUrl(null)
    let cancelled = false
    void chatService
      .invoke("getAttachmentPreview", { path: localPath, mime: "application/octet-stream" })
      .then((result) => {
        if (cancelled) {
          return
        }
        const nextUrl = attachmentPreviewSource(result)
        localImagePreviewUrlByPath.set(localPath, { expiresAt: result.resourceExpiresAt, url: nextUrl })
        setPreviewUrl(nextUrl)
      })
      .catch(() => {
        if (!cancelled) {
          localImagePreviewUrlByPath.delete(localPath)
          setPreviewUrl(null)
          if (previewRetry < 1) {
            setPreviewRetry((value) => value + 1)
          }
        }
      })
    return () => {
      cancelled = true
    }
  }, [chatService, localPath, previewRetry])

  useEffect(() => {
    viewerStateRef.current = viewerState
  }, [viewerState])

  const visibleSrc = localPath ? previewUrl : originalSrc
  const downloadName = imageFileName(localPath ?? originalSrc)
  const previewTitle = alt || downloadName
  const handlePreviewError: MarkdownImageProps["onError"] = (event) => {
    props.onError?.(event)
    if (!localPath || previewRetry >= 1) {
      return
    }
    localImagePreviewUrlByPath.delete(localPath)
    setPreviewUrl(null)
    setPreviewRetry((value) => value + 1)
  }

  if (!visibleSrc) {
    if (localPath) {
      return null
    }
    return <img src={src} alt={alt ?? ""} className={className} draggable={false} decoding="async" {...props} />
  }

  return (
    <figure className="oo-markdown-image-preview">
      <ImageContextActions localPath={localPath}>
        <button
          type="button"
          className="oo-markdown-image-open"
          aria-label={t("chat.imagePreview.open", { name: previewTitle })}
          onClick={() => setIsViewerOpen(true)}
        >
          <img
            src={visibleSrc}
            alt={alt ?? ""}
            className={className}
            draggable={false}
            decoding="async"
            {...props}
            onError={handlePreviewError}
          />
        </button>
      </ImageContextActions>
      {isViewerOpen
        ? createPortal(
            <ImageViewer
              alt={alt ?? ""}
              imageSize={imageSize}
              localPath={localPath}
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
  dragRef: MutableRefObject<ImageViewerDragState | null>
  imageSize: ImageViewerSize | null
  localPath?: string | null
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

interface ImageFileActions {
  copy: () => Promise<void>
  open: () => Promise<void>
  saveAs: () => Promise<void>
  showInFolder: () => Promise<void>
}

function useImageFileActions(localPath: string): ImageFileActions {
  const t = useT()
  const chatService = useChatService()

  const reportFailure = (scope: string, message: string, cause: unknown): void => {
    reportRendererHandledError(scope, message, cause)
    toast.error(userFacingErrorDescription(resolveUserFacingError(cause, { area: "artifact" }), t))
  }

  return {
    copy: async () => {
      try {
        await chatService.invoke("copyLocalImage", { path: localPath })
        toast.success(t("chat.imagePreview.copied"))
      } catch (cause) {
        reportFailure("chat.image.copy", "Failed to copy local image", cause)
      }
    },
    open: async () => {
      try {
        await chatService.invoke("openLocalPath", { path: localPath })
      } catch (cause) {
        reportFailure("chat.image.open", "Failed to open local image", cause)
      }
    },
    saveAs: async () => {
      try {
        const result = await chatService.invoke("saveLocalImageAs", { path: localPath })
        if (result.saved) {
          toast.success(t("chat.imagePreview.saved"))
        }
      } catch (cause) {
        reportFailure("chat.image.saveAs", "Failed to save local image", cause)
      }
    },
    showInFolder: async () => {
      try {
        await chatService.invoke("showLocalPathInFolder", { path: localPath })
      } catch (cause) {
        reportFailure("chat.image.showInFolder", "Failed to reveal local image", cause)
      }
    },
  }
}

function ImageActionItems({ actions }: { actions: ImageFileActions }) {
  const t = useT()
  return (
    <>
      <DropdownMenuItem onSelect={() => void actions.copy()}>
        <CopyIcon />
        {t("chat.imagePreview.copy")}
      </DropdownMenuItem>
      <DropdownMenuItem onSelect={() => void actions.saveAs()}>
        <SaveIcon />
        {t("chat.imagePreview.saveAs")}
      </DropdownMenuItem>
      <DropdownMenuItem onSelect={() => void actions.open()}>
        <ExternalLinkIcon />
        {t("chat.imagePreview.openFile")}
      </DropdownMenuItem>
      <DropdownMenuItem onSelect={() => void actions.showInFolder()}>
        <FolderOpenIcon />
        {t("chat.imagePreview.showInFolder")}
      </DropdownMenuItem>
    </>
  )
}

function ImageViewerActions({ localPath }: { localPath: string }) {
  const t = useT()
  const actions = useImageFileActions(localPath)
  return (
    <>
      <button
        type="button"
        className="oo-markdown-image-viewer-action"
        aria-label={t("chat.imagePreview.copy")}
        onClick={() => void actions.copy()}
      >
        <CopyIcon className="size-4" />
      </button>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            className="oo-markdown-image-viewer-action"
            aria-label={t("chat.imagePreview.moreActions")}
          >
            <EllipsisIcon className="size-5" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="z-[170]">
          <ImageActionItems actions={actions} />
        </DropdownMenuContent>
      </DropdownMenu>
    </>
  )
}

function ImageContextActions({
  children,
  localPath,
}: {
  children: ReactElement
  localPath: string | null | undefined
}) {
  const actions = useImageFileActions(localPath ?? "")
  if (!localPath) return children
  return (
    <ContextMenuPrimitive.Root>
      <ContextMenuPrimitive.Trigger asChild>{children}</ContextMenuPrimitive.Trigger>
      <ContextMenuPrimitive.Portal>
        <ContextMenuPrimitive.Content className="z-[180] min-w-52 rounded-md border bg-popover p-1 text-popover-foreground shadow-lg outline-hidden">
          <ContextMenuPrimitive.Item
            className="relative flex cursor-default items-center gap-2 rounded-sm px-2 py-1.5 text-sm outline-hidden select-none focus:bg-accent focus:text-accent-foreground"
            onSelect={() => void actions.copy()}
          >
            <CopyIcon className="size-4" />
            <ImageActionLabel messageKey="chat.imagePreview.copy" />
          </ContextMenuPrimitive.Item>
          <ContextMenuPrimitive.Item
            className="relative flex cursor-default items-center gap-2 rounded-sm px-2 py-1.5 text-sm outline-hidden select-none focus:bg-accent focus:text-accent-foreground"
            onSelect={() => void actions.saveAs()}
          >
            <SaveIcon className="size-4" />
            <ImageActionLabel messageKey="chat.imagePreview.saveAs" />
          </ContextMenuPrimitive.Item>
          <ContextMenuPrimitive.Item
            className="relative flex cursor-default items-center gap-2 rounded-sm px-2 py-1.5 text-sm outline-hidden select-none focus:bg-accent focus:text-accent-foreground"
            onSelect={() => void actions.open()}
          >
            <ExternalLinkIcon className="size-4" />
            <ImageActionLabel messageKey="chat.imagePreview.openFile" />
          </ContextMenuPrimitive.Item>
          <ContextMenuPrimitive.Item
            className="relative flex cursor-default items-center gap-2 rounded-sm px-2 py-1.5 text-sm outline-hidden select-none focus:bg-accent focus:text-accent-foreground"
            onSelect={() => void actions.showInFolder()}
          >
            <FolderOpenIcon className="size-4" />
            <ImageActionLabel messageKey="chat.imagePreview.showInFolder" />
          </ContextMenuPrimitive.Item>
        </ContextMenuPrimitive.Content>
      </ContextMenuPrimitive.Portal>
    </ContextMenuPrimitive.Root>
  )
}

function ImageActionLabel({ messageKey }: { messageKey: Parameters<ReturnType<typeof useT>>[0] }) {
  const t = useT()
  return <>{t(messageKey)}</>
}

export function ImageViewerModal({
  alt,
  onClose,
  localPath,
  src,
  title,
}: {
  alt: string
  onClose: () => void
  localPath?: string | null
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
      imageSize={imageSize}
      localPath={localPath}
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
  dragRef,
  imageSize,
  localPath,
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
        {localPath ? <ImageViewerActions localPath={localPath} /> : null}
        <button
          type="button"
          className="oo-markdown-image-viewer-action"
          aria-label={t("chat.imagePreview.close")}
          onClick={onClose}
        >
          <XIcon className="size-5" />
        </button>
      </div>

      <ImageContextActions localPath={localPath}>
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
      </ImageContextActions>

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
