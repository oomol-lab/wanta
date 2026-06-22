import type { ChatAttachment } from "../../../electron/chat/common.ts"
import type { DraftAttachment } from "./composer-state.ts"

import {
  File as FileIcon,
  FileArchive,
  FileCode,
  FileImage,
  FileSpreadsheet,
  FileText,
  FileVideoCamera,
  Folder,
  X,
} from "lucide-react"
import * as React from "react"
import { toast } from "sonner"
import {
  attachmentExtension,
  fileSizeLabel,
  isDirectoryAttachment,
  isImageAttachment,
  readAttachmentPreviewUrl,
  setAttachmentPreviewUrl,
} from "./chat-attachment-utils.ts"
import { useChatService } from "@/components/AppContext"
import { useT } from "@/i18n/i18n"
import { resolveUserFacingError, userFacingErrorDescription } from "@/lib/user-facing-error"
import { cn } from "@/lib/utils"

function attachmentTypeLabel(t: ReturnType<typeof useT>, attachment: ChatAttachment): string {
  if (isDirectoryAttachment(attachment)) {
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
  if (isDirectoryAttachment(attachment)) {
    return attachmentTypeLabel(t, attachment)
  }
  const size = fileSizeLabel(attachment.size)
  return size ? `${attachmentTypeLabel(t, attachment)} ${size}` : attachmentTypeLabel(t, attachment)
}

function AttachmentPreviewTile({ attachment }: { attachment: DraftAttachment }) {
  if (isDirectoryAttachment(attachment)) {
    return (
      <span className="oo-attachment-tile-directory flex size-10 shrink-0 items-center justify-center rounded-md">
        <Folder className="size-5" />
      </span>
    )
  }

  if (attachment.previewUrl && isImageAttachment(attachment)) {
    return (
      <span className="flex size-10 shrink-0 items-center justify-center overflow-hidden rounded-md bg-muted">
        <img src={attachment.previewUrl} alt="" className="size-full object-cover" draggable={false} decoding="async" />
      </span>
    )
  }

  const mime = attachment.mime.toLowerCase()
  const extension = attachmentExtension(attachment.name)

  if (mime === "application/pdf" || extension === "pdf") {
    return (
      <span className="oo-attachment-tile-pdf flex size-10 shrink-0 items-center justify-center rounded-md text-[9px] font-semibold">
        PDF
      </span>
    )
  }

  const iconClassName = "size-5"
  const tileClassName = "flex size-10 shrink-0 items-center justify-center rounded-md"

  if (mime.startsWith("image/")) {
    return (
      <span className={cn(tileClassName, "oo-attachment-tile-image")}>
        <FileImage className={iconClassName} />
      </span>
    )
  }
  if (mime.startsWith("video/")) {
    return (
      <span className={cn(tileClassName, "oo-attachment-tile-video")}>
        <FileVideoCamera className={iconClassName} />
      </span>
    )
  }
  if (["zip", "gz", "tgz", "rar", "7z"].includes(extension)) {
    return (
      <span className={cn(tileClassName, "oo-attachment-tile-archive")}>
        <FileArchive className={iconClassName} />
      </span>
    )
  }
  if (["csv", "tsv", "xls", "xlsx"].includes(extension)) {
    return (
      <span className={cn(tileClassName, "oo-attachment-tile-sheet")}>
        <FileSpreadsheet className={iconClassName} />
      </span>
    )
  }
  if (["css", "html", "js", "json", "jsx", "md", "py", "ts", "tsx", "xml", "yaml", "yml"].includes(extension)) {
    return (
      <span className={cn(tileClassName, "oo-attachment-tile-code")}>
        <FileCode className={iconClassName} />
      </span>
    )
  }
  if (mime.startsWith("text/") || ["doc", "docx", "rtf", "txt"].includes(extension)) {
    return (
      <span className={cn(tileClassName, "bg-muted text-muted-foreground")}>
        <FileText className={iconClassName} />
      </span>
    )
  }

  return (
    <span className={cn(tileClassName, "bg-muted text-muted-foreground")}>
      <FileIcon className={iconClassName} />
    </span>
  )
}

function AttachmentImageCard({
  attachment,
  onOpen,
  onRemove,
  removeLabel,
}: {
  attachment: DraftAttachment
  onOpen: (attachment: DraftAttachment) => void
  onRemove?: (id: string) => void
  removeLabel: string
}) {
  const chatService = useChatService()
  const [previewUrl, setPreviewUrl] = React.useState(attachment.previewUrl ?? null)
  const attachmentPath = attachment.path
  const attachmentMime = attachment.mime
  const initialPreviewUrl = attachment.previewUrl ?? null
  const imageAttachment = isImageAttachment(attachment)

  React.useEffect(() => {
    const cached = readAttachmentPreviewUrl(attachmentPath) ?? initialPreviewUrl
    setPreviewUrl(cached)
    if (cached || !imageAttachment) {
      return
    }
    let cancelled = false
    void chatService
      .invoke("getAttachmentPreview", { path: attachmentPath, mime: attachmentMime })
      .then((result) => {
        if (cancelled || !result.dataUrl) {
          return
        }
        setAttachmentPreviewUrl(attachmentPath, result.dataUrl)
        setPreviewUrl(result.dataUrl)
      })
      .catch(() => undefined)
    return () => {
      cancelled = true
    }
  }, [attachmentMime, attachmentPath, chatService, imageAttachment, initialPreviewUrl])

  return (
    <div className="group relative size-20 shrink-0">
      <button
        type="button"
        title={attachment.path}
        className="size-full overflow-hidden rounded-xl border border-border/60 bg-background text-left shadow-xs hover:border-border hover:bg-accent/40 focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none"
        onClick={() => onOpen(attachment)}
      >
        {previewUrl ? (
          <img
            src={previewUrl}
            alt=""
            className="size-full object-cover object-center"
            draggable={false}
            decoding="async"
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
      void chatService.invoke("openLocalPath", { path: attachment.path }).catch((cause: unknown) => {
        const error = resolveUserFacingError(cause, { area: "artifact" })
        toast.error(userFacingErrorDescription(error, t))
      })
    },
    [chatService, t],
  )

  return (
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
  )
}
