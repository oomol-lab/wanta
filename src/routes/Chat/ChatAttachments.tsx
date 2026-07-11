import type { ChatAttachment } from "../../../electron/chat/common.ts"
import type { DraftAttachment } from "./composer-state.ts"

import { FileImage, X } from "lucide-react"
import * as React from "react"
import { toast } from "sonner"
import {
  attachmentExtension,
  deleteAttachmentPreviewUrl,
  fileSizeLabel,
  isImageAttachment,
  readAttachmentPreviewUrl,
  setAttachmentPreviewUrl,
} from "./chat-attachment-utils.ts"
import { FileKindTile } from "./file-type-icons.tsx"
import { fileVisualKind } from "./file-type-kind.ts"
import { ImageViewerModal } from "@/components/ai-elements/message-image"
import { useChatService } from "@/components/AppContext"
import { useT } from "@/i18n/i18n"
import { reportRendererHandledError } from "@/lib/renderer-diagnostics"
import { resolveUserFacingError, userFacingErrorDescription } from "@/lib/user-facing-error"
import { cn } from "@/lib/utils"

function attachmentTypeLabel(t: ReturnType<typeof useT>, attachment: ChatAttachment): string {
  if (fileVisualKind(attachment) === "directory") {
    return t("chat.attachmentFolder")
  }
  const extension = attachmentExtension(attachment.name)
  if (extension) {
    return extension.toUpperCase()
  }
  const [type] = attachment.mime.split("/")
  return type ? type.toUpperCase() : "FILE"
}

function attachmentSummary(t: ReturnType<typeof useT>, attachment: ChatAttachment): string {
  if (fileVisualKind(attachment) === "directory") {
    return attachmentTypeLabel(t, attachment)
  }
  const size = fileSizeLabel(attachment.size)
  return size ? `${attachmentTypeLabel(t, attachment)} ${size}` : attachmentTypeLabel(t, attachment)
}

function AttachmentPreviewTile({ attachment }: { attachment: DraftAttachment }) {
  if (attachment.previewUrl && isImageAttachment(attachment)) {
    return (
      <span className="flex size-10 shrink-0 items-center justify-center overflow-hidden rounded-md bg-muted">
        <img src={attachment.previewUrl} alt="" className="size-full object-cover" draggable={false} decoding="async" />
      </span>
    )
  }

  return <FileKindTile source={attachment} />
}

function AttachmentImageCard({
  attachment,
  onOpen,
  onRemove,
  removeLabel,
}: {
  attachment: DraftAttachment
  onOpen: (attachment: DraftAttachment, previewUrl: string | null) => void
  onRemove?: (id: string) => void
  removeLabel: string
}) {
  const chatService = useChatService()
  const [previewUrl, setPreviewUrl] = React.useState(attachment.previewUrl ?? null)
  const [previewRetry, setPreviewRetry] = React.useState(0)
  const attachmentPath = attachment.path
  const attachmentMime = attachment.mime
  const initialPreviewUrl = attachment.previewUrl ?? null
  const imageAttachment = isImageAttachment(attachment)

  React.useEffect(() => {
    const cached = readAttachmentPreviewUrl(attachmentPath) ?? (previewRetry === 0 ? initialPreviewUrl : null)
    setPreviewUrl(cached)
    if (cached || !imageAttachment) {
      return
    }
    let cancelled = false
    void chatService
      .invoke("getAttachmentPreview", { path: attachmentPath, mime: attachmentMime })
      .then((result) => {
        const source = result.resourceUrl ?? result.dataUrl
        if (cancelled || !source) {
          return
        }
        setAttachmentPreviewUrl(attachmentPath, source, result.resourceExpiresAt)
        setPreviewUrl(source)
      })
      .catch((error: unknown) => {
        reportRendererHandledError("chat", "attachment preview load failed", error)
      })
    return () => {
      cancelled = true
    }
  }, [attachmentMime, attachmentPath, chatService, imageAttachment, initialPreviewUrl, previewRetry])

  return (
    <div className="group relative size-20 shrink-0">
      <button
        type="button"
        title={attachment.path}
        className="size-full overflow-hidden rounded-xl border border-border/60 bg-background text-left shadow-xs hover:border-border hover:bg-accent/40 focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none"
        onClick={() => onOpen(attachment, previewUrl)}
      >
        {previewUrl ? (
          <img
            src={previewUrl}
            alt=""
            className="size-full object-cover object-center"
            draggable={false}
            decoding="async"
            onError={() => {
              deleteAttachmentPreviewUrl(attachmentPath)
              setPreviewUrl(null)
              if (previewRetry < 1) {
                setPreviewRetry((value) => value + 1)
              }
            }}
          />
        ) : (
          <span className="flex size-full items-center justify-center text-muted-foreground/65">
            <FileImage className="size-6" />
          </span>
        )}
      </button>
      {onRemove ? (
        <button
          type="button"
          aria-label={removeLabel}
          className="absolute top-1 right-1 flex size-5 items-center justify-center rounded-full bg-foreground text-background shadow-sm hover:bg-foreground/85"
          onClick={() => onRemove(attachment.id)}
        >
          <X className="size-3.5" />
        </button>
      ) : null}
    </div>
  )
}

function imageDownloadName(attachment: DraftAttachment): string {
  return attachment.name.trim() || attachment.path.split(/[\\/]/).pop() || "image"
}

export function AttachmentList({
  attachments,
  className,
  onRemove,
}: {
  attachments: DraftAttachment[]
  className?: string
  onRemove?: (id: string) => void
}) {
  const t = useT()
  const chatService = useChatService()
  const [imageViewer, setImageViewer] = React.useState<{
    attachment: DraftAttachment
    src: string | null
  } | null>(null)

  const openAttachment = React.useCallback(
    (attachment: DraftAttachment, previewUrl: string | null = null): void => {
      if (isImageAttachment(attachment)) {
        setImageViewer({
          attachment,
          src: previewUrl ?? attachment.previewUrl ?? readAttachmentPreviewUrl(attachment.path) ?? null,
        })
        return
      }
      void chatService.invoke("showLocalPathInFolder", { path: attachment.path }).catch((cause: unknown) => {
        reportRendererHandledError("chatAttachments.showInFolder", "Failed to reveal attachment", cause)
        const error = resolveUserFacingError(cause, { area: "artifact" })
        toast.error(userFacingErrorDescription(error, t))
      })
    },
    [chatService, t],
  )

  React.useEffect(() => {
    if (!imageViewer || imageViewer.src) {
      return
    }
    let cancelled = false
    void chatService
      .invoke("getAttachmentPreview", {
        path: imageViewer.attachment.path,
        mime: imageViewer.attachment.mime,
      })
      .then((result) => {
        if (cancelled) {
          return
        }
        const source = result.resourceUrl ?? result.dataUrl
        if (!source) {
          toast.error(t("artifacts.previewReadFailed"))
          setImageViewer(null)
          return
        }
        setAttachmentPreviewUrl(imageViewer.attachment.path, source, result.resourceExpiresAt)
        setImageViewer((current) =>
          current?.attachment.path === imageViewer.attachment.path
            ? { attachment: current.attachment, src: source }
            : current,
        )
      })
      .catch((cause: unknown) => {
        if (!cancelled) {
          const error = resolveUserFacingError(cause, { area: "artifact" })
          toast.error(userFacingErrorDescription(error, t))
          setImageViewer(null)
        }
      })
    return () => {
      cancelled = true
    }
  }, [chatService, imageViewer, t])

  return (
    <>
      <div className={cn("flex w-full flex-wrap justify-start gap-2", className)}>
        {attachments.map((attachment) =>
          isImageAttachment(attachment) ? (
            <AttachmentImageCard
              key={attachment.id}
              attachment={attachment}
              onOpen={openAttachment}
              onRemove={onRemove}
              removeLabel={t("chat.removeAttachment")}
            />
          ) : (
            <div key={attachment.id} className="relative max-w-full min-w-0">
              <button
                type="button"
                title={attachment.path}
                className={cn(
                  "oo-border-divider flex h-14 max-w-full min-w-0 items-center gap-3 rounded-lg border bg-background/70 py-2 pl-2 text-left shadow-xs hover:border-border hover:bg-accent/60 focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none",
                  onRemove ? "pr-8" : "pr-2",
                )}
                onClick={() => openAttachment(attachment)}
              >
                <AttachmentPreviewTile attachment={attachment} />
                <span className="min-w-0 flex-1">
                  <span className="oo-text-label block max-w-56 truncate text-foreground">{attachment.name}</span>
                  <span className="oo-text-caption-compact block truncate font-normal text-muted-foreground">
                    {attachmentSummary(t, attachment)}
                  </span>
                </span>
              </button>
              {onRemove ? (
                <button
                  type="button"
                  aria-label={t("chat.removeAttachment")}
                  className="absolute top-1/2 right-2 -translate-y-1/2 rounded-full p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
                  onClick={() => onRemove(attachment.id)}
                >
                  <X className="size-3.5" />
                </button>
              ) : null}
            </div>
          ),
        )}
      </div>
      {imageViewer?.src ? (
        <ImageViewerModal
          alt={imageViewer.attachment.name}
          downloadName={imageDownloadName(imageViewer.attachment)}
          onClose={() => setImageViewer(null)}
          src={imageViewer.src}
          title={imageViewer.attachment.name || imageDownloadName(imageViewer.attachment)}
        />
      ) : null}
    </>
  )
}
