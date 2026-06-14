import type { ChatAttachment } from "./common.ts"

import { randomUUID } from "node:crypto"
import { mkdir, writeFile } from "node:fs/promises"
import path from "node:path"
import { mimeFromPath } from "./artifacts.ts"

export const clipboardAttachmentMaxBytes = 64 * 1024 * 1024

export interface SaveClipboardAttachmentInput {
  name?: string
  mime?: string
  bytes: ArrayBuffer
}

function extensionFromMime(mime: string): string {
  switch (mime.toLowerCase()) {
    case "image/avif":
      return "avif"
    case "image/bmp":
      return "bmp"
    case "image/gif":
      return "gif"
    case "image/jpeg":
      return "jpg"
    case "image/png":
      return "png"
    case "image/svg+xml":
      return "svg"
    case "image/webp":
      return "webp"
    case "application/pdf":
      return "pdf"
    case "text/csv":
      return "csv"
    case "text/html":
      return "html"
    case "text/markdown":
      return "md"
    case "text/plain":
      return "txt"
    default:
      return "bin"
  }
}

function sanitizeAttachmentName(name: string): string {
  return (
    path
      .basename(name)
      .replace(/[<>:"/\\|?*]/g, "_")
      .replaceAll(/./g, (char) => (char.charCodeAt(0) < 32 ? "_" : char))
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 120) || "clipboard-attachment"
  )
}

export function clipboardAttachmentFileName(input: { name?: string; mime?: string }): string {
  return `${Date.now()}-${randomUUID()}-${clipboardAttachmentDisplayName(input)}`
}

export function clipboardAttachmentDisplayName(input: { name?: string; mime?: string }): string {
  const mime = input.mime?.trim() || "application/octet-stream"
  const sanitized = sanitizeAttachmentName(input.name?.trim() || "clipboard-attachment")
  const extension = path.extname(sanitized) ? "" : `.${extensionFromMime(mime)}`
  return `${sanitized}${extension}`
}

export async function saveClipboardAttachment(
  rootDir: string,
  input: SaveClipboardAttachmentInput,
): Promise<ChatAttachment> {
  if (input.bytes.byteLength === 0) {
    throw new Error("Attachment is empty.")
  }
  if (input.bytes.byteLength > clipboardAttachmentMaxBytes) {
    throw new Error("Attachment is too large.")
  }
  const dir = path.join(rootDir, "attachments", "clipboard")
  await mkdir(dir, { recursive: true })
  const displayName = clipboardAttachmentDisplayName({ name: input.name, mime: input.mime })
  const fileName = clipboardAttachmentFileName({ name: displayName, mime: input.mime })
  const filePath = path.join(dir, fileName)
  const bytes = Buffer.from(new Uint8Array(input.bytes))
  await writeFile(filePath, bytes, { mode: 0o600 })
  const mime = input.mime?.trim() || mimeFromPath(filePath)
  return {
    id: `clipboard-${randomUUID()}`,
    name: displayName,
    mime,
    size: bytes.byteLength,
    path: filePath,
    kind: "file",
  }
}
