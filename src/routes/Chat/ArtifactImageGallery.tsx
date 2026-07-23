import type { LocalArtifactGroup, LocalArtifactItem } from "../../../electron/chat/common.ts"
import type { LocalArtifactPreviewCache } from "./artifact-preview-cache.ts"
import type { ArtifactPreviewMode } from "./ArtifactPreviewPane.tsx"

import { Image } from "lucide-react"
import * as React from "react"
import { useLocalArtifactPreview } from "./artifact-preview-cache.ts"
import { useLocalArtifactThumbnail } from "./artifact-thumbnail-cache.ts"
import { ArtifactConsumablePreview, ArtifactInfo, ArtifactsEmptyState } from "./ArtifactPreviewPane.tsx"
import { useT } from "@/i18n/i18n"
import { cn } from "@/lib/utils"

export function ImageThumbnail({
  index,
  item,
  selected,
  onClick,
  onContextMenu,
  onDoubleClick,
}: {
  index: number
  item: LocalArtifactItem
  selected: boolean
  onClick: () => void
  onContextMenu: (x: number, y: number) => void
  onDoubleClick: () => void
}) {
  const thumbnailRef = React.useRef<HTMLButtonElement | null>(null)
  const [nearViewport, setNearViewport] = React.useState(false)
  const thumbnail = useLocalArtifactThumbnail(nearViewport ? item : null)

  React.useEffect(() => {
    const element = thumbnailRef.current
    if (!element) {
      return
    }
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting) {
          setNearViewport(true)
          observer.disconnect()
        }
      },
      { rootMargin: "160px" },
    )
    observer.observe(element)
    return () => observer.disconnect()
  }, [])

  return (
    <button
      ref={thumbnailRef}
      type="button"
      title={item.name}
      className={cn(
        "oo-artifact-selectable relative aspect-square overflow-hidden rounded-md border text-muted-foreground shadow-sm focus-visible:outline-none",
        selected && "oo-artifact-selected shadow-none",
      )}
      onClick={onClick}
      onContextMenu={(event) => {
        event.preventDefault()
        event.stopPropagation()
        onContextMenu(event.clientX, event.clientY)
      }}
      onDoubleClick={onDoubleClick}
    >
      {thumbnail ? (
        <img src={thumbnail} alt={item.name} className="size-full object-cover" draggable={false} loading="lazy" />
      ) : (
        <span className="flex size-full items-center justify-center">
          <Image className="size-4" />
        </span>
      )}
      <span className="absolute right-1 bottom-1 rounded bg-background/90 px-1 text-[0.625rem] leading-4 text-muted-foreground shadow-sm">
        {index}
      </span>
    </button>
  )
}

export function ImageGalleryPreview({
  group,
  item,
  mode,
  onContextMenu,
  onModeChange,
  previewCache,
  onOpen,
}: {
  group: LocalArtifactGroup | null
  item: LocalArtifactItem | null
  mode: ArtifactPreviewMode
  onContextMenu: (item: LocalArtifactItem, x: number, y: number) => void
  onModeChange: (mode: ArtifactPreviewMode) => void
  previewCache: LocalArtifactPreviewCache
  onOpen: () => void
}) {
  const t = useT()
  const { loading, preview, reload } = useLocalArtifactPreview(item, previewCache)

  React.useEffect(() => {
    if (mode === "source") {
      onModeChange("preview")
    }
  }, [mode, onModeChange])

  if (!item) {
    return <ArtifactsEmptyState />
  }

  return (
    <section
      className="flex min-h-0 flex-1 flex-col"
      onContextMenu={(event) => {
        if (!item) {
          return
        }
        event.preventDefault()
        event.stopPropagation()
        onContextMenu(item, event.clientX, event.clientY)
      }}
    >
      <div
        className={cn(
          "min-h-0 flex-1",
          mode === "preview" && preview?.kind === "pdf" ? "overflow-hidden" : "overflow-auto",
        )}
      >
        {mode === "info" ? (
          <ArtifactInfo item={item} group={group} />
        ) : loading ? (
          <div className="oo-text-body flex min-h-full items-center justify-center px-4 py-8 text-muted-foreground">
            {t("artifacts.previewLoading")}
          </div>
        ) : preview?.kind === "image" && (preview.resourceUrl || preview.dataUrl) ? (
          <div className="flex min-h-full items-center justify-center bg-[var(--oo-artifact-preview-canvas)] p-4">
            <img
              src={preview.resourceUrl ?? preview.dataUrl}
              alt={item.name}
              className="max-h-full max-w-full object-contain drop-shadow-sm"
              draggable={false}
              decoding="async"
              onError={reload}
              onDoubleClick={onOpen}
            />
          </div>
        ) : (
          <ArtifactConsumablePreview item={item} preview={preview} onOpen={onOpen} onResourceError={reload} />
        )}
      </div>
    </section>
  )
}
