import type { ChatAttachment } from "../../../electron/chat/common.ts"
import type { DraftAttachment } from "./composer-state.ts"

const ATTACHMENT_PREVIEW_CACHE_LIMIT = 80
const attachmentResourceRefreshMarginMs = 60_000
interface AttachmentPreviewCacheEntry {
  expiresAt?: number
  url: string
}
const attachmentPreviewUrlByPath = new Map<string, AttachmentPreviewCacheEntry>()

function revokePreviewUrl(url: string | undefined): void {
  if (url?.startsWith("blob:")) {
    URL.revokeObjectURL(url)
  }
}

export function readAttachmentPreviewUrl(path: string): string | undefined {
  const entry = attachmentPreviewUrlByPath.get(path)
  if (entry?.expiresAt && entry.expiresAt <= Date.now() + attachmentResourceRefreshMarginMs) {
    attachmentPreviewUrlByPath.delete(path)
    return undefined
  }
  return entry?.url
}

export function setAttachmentPreviewUrl(path: string, url: string, expiresAt?: number): void {
  const current = attachmentPreviewUrlByPath.get(path)
  if (current && current.url !== url) {
    revokePreviewUrl(current.url)
  }
  if (!current && attachmentPreviewUrlByPath.size >= ATTACHMENT_PREVIEW_CACHE_LIMIT) {
    const oldestPath = attachmentPreviewUrlByPath.keys().next().value as string | undefined
    if (oldestPath) {
      revokePreviewUrl(attachmentPreviewUrlByPath.get(oldestPath)?.url)
      attachmentPreviewUrlByPath.delete(oldestPath)
    }
  }
  attachmentPreviewUrlByPath.set(path, { expiresAt, url })
}

export function deleteAttachmentPreviewUrl(path: string): void {
  const entry = attachmentPreviewUrlByPath.get(path)
  revokePreviewUrl(entry?.url)
  attachmentPreviewUrlByPath.delete(path)
}

export function fileSizeLabel(size: number): string {
  if (!Number.isFinite(size) || size <= 0) {
    return ""
  }
  if (size < 1024) {
    return `${size} B`
  }
  if (size < 1024 * 1024) {
    return `${(size / 1024).toFixed(1)} KB`
  }
  return `${(size / 1024 / 1024).toFixed(1)} MB`
}

export function attachmentExtension(name: string): string {
  const lastSegment = name.split(/[\\/]/).pop() ?? name
  const index = lastSegment.lastIndexOf(".")
  return index > -1 ? lastSegment.slice(index + 1).toLowerCase() : ""
}

export function isDirectoryAttachment(attachment: ChatAttachment): boolean {
  return attachment.kind === "directory" || attachment.mime.toLowerCase() === "inode/directory"
}

export function isImageAttachment(attachment: ChatAttachment): boolean {
  if (isDirectoryAttachment(attachment)) {
    return false
  }
  if (attachment.mime.toLowerCase().startsWith("image/")) {
    return true
  }
  return ["avif", "bmp", "gif", "jpeg", "jpg", "png", "svg", "webp"].includes(attachmentExtension(attachment.name))
}

export function revokeAttachmentPreviewUrls(attachments: DraftAttachment[]): void {
  for (const attachment of attachments) {
    const cached = attachmentPreviewUrlByPath.get(attachment.path)
    if (cached && (!attachment.previewUrl || cached.url === attachment.previewUrl)) {
      revokePreviewUrl(cached.url)
      attachmentPreviewUrlByPath.delete(attachment.path)
    } else {
      revokePreviewUrl(attachment.previewUrl)
    }
  }
}

export function attachmentWithPreview(attachment: ChatAttachment): DraftAttachment {
  if (!isImageAttachment(attachment)) {
    return attachment
  }
  return {
    ...attachment,
    previewUrl: readAttachmentPreviewUrl(attachment.path),
  }
}

export function filesFromDataTransfer(dataTransfer: DataTransfer): File[] {
  const files = Array.from(dataTransfer.files)
  if (files.length > 0) {
    return files
  }
  return Array.from(dataTransfer.items)
    .filter((item) => item.kind === "file")
    .map((item) => item.getAsFile())
    .filter((file): file is File => Boolean(file))
}
