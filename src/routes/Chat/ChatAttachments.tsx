import type { ChatAttachment } from "../../../electron/chat/common.ts"
import type { DraftAttachment } from "./composer-state.ts"

import { FileImage, LoaderCircle, X } from "lucide-react"
import * as React from "react"
import { toast } from "sonner"
import { attachmentExtension, fileSizeLabel, isImageAttachment } from "./chat-attachment-utils.ts"
import { FileKindTile } from "./file-type-icons.tsx"
import { fileVisualKind } from "./file-type-kind.ts"
import { useAttachmentPreview } from "./use-attachment-preview.ts"
import { ImageContextActions, ImageViewerModal } from "@/components/ai-elements/message-image"
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
  onRemove,
  removeLabel,
}: {
  attachment: DraftAttachment
  onRemove?: (id: string) => void
  removeLabel: string
}) {
  const t = useT()
  const preview = useAttachmentPreview(attachment)
  const [viewerOpen, setViewerOpen] = React.useState(false)
  const previewUrl = preview.src
  const errorLabel = t(`chat.attachmentPreview.${preview.reason ?? "read_failed"}`)

  return (
    <div className="group relative size-20 shrink-0">
      <ImageContextActions localPath={attachment.path}>
        <button
          type="button"
          title={preview.status === "failed" ? errorLabel : attachment.name}
          aria-label={
            preview.status === "failed"
              ? `${errorLabel} ${t("artifacts.retry")}`
              : t("chat.imagePreview.open", { name: attachment.name })
          }
          aria-busy={preview.status === "loading"}
          className="size-full overflow-hidden rounded-xl border border-border/60 bg-background text-left shadow-xs hover:border-border hover:bg-accent/40 focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none"
          onClick={() => {
            if (preview.status === "failed") {
              preview.retry()
              return
            }
            preview.revalidate()
            setViewerOpen(true)
          }}
        >
          {previewUrl ? (
            <img
              src={previewUrl}
              alt=""
              className="size-full object-cover object-center"
              draggable={false}
              decoding="async"
              onLoad={() => preview.loaded(previewUrl)}
              onError={() => preview.failed(previewUrl)}
            />
          ) : (
            <span className="flex size-full items-center justify-center text-muted-foreground/65">
              {preview.status === "loading" ? (
                <LoaderCircle className="size-6 animate-spin" />
              ) : (
                <span className="flex flex-col items-center gap-1">
                  <FileImage className="size-6" />
                  <span className="text-xs">{t("artifacts.retry")}</span>
                </span>
              )}
            </span>
          )}
        </button>
      </ImageContextActions>
      {viewerOpen ? (
        <ImageViewerModal
          alt={attachment.name}
          localPath={attachment.path}
          onClose={() => setViewerOpen(false)}
          src={previewUrl ?? ""}
          title={attachment.name}
          previewStatus={preview.status}
          previewError={errorLabel}
          onRetry={preview.retry}
          onLoad={() => {
            if (previewUrl) preview.loaded(previewUrl)
          }}
          onError={() => {
            if (previewUrl) preview.failed(previewUrl)
          }}
        />
      ) : null}
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
  const openAttachment = React.useCallback(
    (attachment: DraftAttachment): void => {
      void chatService.invoke("showLocalPathInFolder", { path: attachment.path }).catch((cause: unknown) => {
        reportRendererHandledError("chatAttachments.showInFolder", "Failed to reveal attachment", cause)
        const error = resolveUserFacingError(cause, { area: "artifact" })
        toast.error(userFacingErrorDescription(error, t))
      })
    },
    [chatService, t],
  )

  return (
    <>
      <div className={cn("flex w-full flex-wrap justify-start gap-2", className)}>
        {attachments.map((attachment) =>
          isImageAttachment(attachment) ? (
            <AttachmentImageCard
              key={attachment.id}
              attachment={attachment}
              onRemove={onRemove}
              removeLabel={t("chat.removeAttachment")}
            />
          ) : (
            <div key={attachment.id} className="relative max-w-full min-w-0">
              <button
                type="button"
                title={attachment.name}
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
    </>
  )
}
