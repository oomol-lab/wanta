import type {
  AttachmentPreviewRequest,
  AttachmentPreviewResult,
  LocalArtifactPreviewRequest,
  LocalArtifactPreviewResult,
} from "./common.ts"

import { readFile, stat } from "node:fs/promises"
import { logDiagnostic } from "../diagnostics-log.ts"
import {
  archivePreview,
  binaryDataPreview,
  isBinaryDataPreviewArtifact,
  isDocxArtifact,
  isPdfArtifact,
  isRtfArtifact,
  isSpreadsheetPreviewArtifact,
  richPreviewMaxBytes,
  rtfToPlainText,
  spreadsheetPreview,
} from "./artifact-preview.ts"
import { imageMimeFromPath } from "./artifacts.ts"
import { localArtifactItem } from "./local-artifacts.ts"
import { isTextArtifactMime, readTextPreview } from "./turn-output-files.ts"
import { zipArchiveStats, zipArchiveWithinLimits } from "./zip-central-directory.ts"

const attachmentPreviewMaxBytes = 16 * 1024 * 1024
const docxArchiveLimits = {
  maxCompressionRatio: 200,
  maxEntries: 2_048,
  maxEntryUncompressedSize: 32 * 1024 * 1024,
  maxTotalUncompressedSize: 96 * 1024 * 1024,
} as const

async function safeDocxBytes(filePath: string): Promise<{ bytes: Buffer } | { reason: "read_failed" | "too_large" }> {
  const bytes = await readFile(filePath)
  const archive = zipArchiveStats(bytes)
  if (!archive) {
    return { reason: "read_failed" }
  }
  return zipArchiveWithinLimits(archive, docxArchiveLimits) ? { bytes } : { reason: "too_large" }
}

function resourceResult(
  grant: ArtifactResourceGrant,
): Pick<AttachmentPreviewResult, "resourceExpiresAt" | "resourceUrl"> {
  return { resourceExpiresAt: grant.expiresAt, resourceUrl: grant.url }
}

export interface ArtifactResourceGrant {
  expiresAt: number
  url: string
}
export type CreateArtifactResourceUrl = (item: {
  mime: string
  modifiedAt: number
  path: string
  size: number
}) => ArtifactResourceGrant
export type CreateSpreadsheetPreview = (path: string, mime: string, size: number) => Promise<LocalArtifactPreviewResult>

function errorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message
  }
  return String(error)
}

function logPath(filePath: string): string {
  return filePath.replace(/[\r\n]/g, " ")
}

function logPreviewFailure(scope: string, filePath: string, error: unknown, mime?: string): void {
  const safePath = logPath(filePath)
  console.error(`[wanta] ${scope} failed`, { error: errorMessage(error), path: safePath })
  logDiagnostic("chat-preview", `${scope} failed`, { error, mime, path: safePath }, "warn")
}

function attachmentPreviewMime(req: AttachmentPreviewRequest): string | null {
  if (req.mime.toLowerCase().startsWith("image/")) {
    return req.mime
  }
  return imageMimeFromPath(req.path)
}

export async function attachmentPreview(
  req: AttachmentPreviewRequest,
  createResourceUrl?: CreateArtifactResourceUrl,
): Promise<AttachmentPreviewResult> {
  const mime = attachmentPreviewMime(req)
  if (!mime) {
    return { dataUrl: null }
  }
  try {
    const info = await stat(req.path)
    if (!info.isFile() || info.size > attachmentPreviewMaxBytes) {
      return { dataUrl: null }
    }
    if (createResourceUrl) {
      return {
        dataUrl: null,
        ...resourceResult(createResourceUrl({ mime, modifiedAt: info.mtimeMs, path: req.path, size: info.size })),
      }
    }
    const bytes = await readFile(req.path)
    return { dataUrl: `data:${mime};base64,${bytes.toString("base64")}` }
  } catch (error) {
    logPreviewFailure("getAttachmentPreview", req.path, error, mime)
    return { dataUrl: null }
  }
}

export async function localArtifactPreview(
  req: LocalArtifactPreviewRequest,
  createResourceUrl?: CreateArtifactResourceUrl,
  createSpreadsheetPreview: CreateSpreadsheetPreview = spreadsheetPreview,
): Promise<LocalArtifactPreviewResult> {
  const item = await localArtifactItem(req.path)
  if (!item || item.kind !== "file") {
    return { kind: "unsupported", mime: "application/octet-stream", reason: "missing" }
  }

  const size = item.size ?? 0
  const requestResource = (): ArtifactResourceGrant | undefined =>
    createResourceUrl?.({ mime: item.mime, modifiedAt: item.modifiedAt ?? 0, path: item.path, size })
  if (item.mime.toLowerCase().startsWith("image/")) {
    if (size > attachmentPreviewMaxBytes) {
      return { kind: "unsupported", mime: item.mime, size, reason: "too_large" }
    }
    const resource = requestResource()
    if (resource) {
      return { kind: "image", mime: item.mime, size, ...resourceResult(resource) }
    }
    try {
      const bytes = await readFile(item.path)
      return {
        kind: "image",
        mime: item.mime,
        size,
        dataUrl: `data:${item.mime};base64,${bytes.toString("base64")}`,
      }
    } catch (error) {
      logPreviewFailure("getLocalArtifactPreview image", item.path, error, item.mime)
      return { kind: "unsupported", mime: item.mime, size, reason: "read_failed" }
    }
  }

  if (item.mime.toLowerCase().startsWith("audio/") || item.mime.toLowerCase().startsWith("video/")) {
    if (size > attachmentPreviewMaxBytes) {
      return { kind: "unsupported", mime: item.mime, size, reason: "too_large" }
    }
    const resource = requestResource()
    if (resource) {
      return { kind: "media", mime: item.mime, size, ...resourceResult(resource) }
    }
    try {
      const bytes = await readFile(item.path)
      return {
        kind: "media",
        mime: item.mime,
        size,
        dataUrl: `data:${item.mime};base64,${bytes.toString("base64")}`,
      }
    } catch (error) {
      logPreviewFailure("getLocalArtifactPreview media", item.path, error, item.mime)
      return { kind: "unsupported", mime: item.mime, size, reason: "read_failed" }
    }
  }

  if (isSpreadsheetPreviewArtifact(item.path, item.mime)) {
    try {
      return await createSpreadsheetPreview(item.path, item.mime, size)
    } catch (error) {
      logPreviewFailure("getLocalArtifactPreview spreadsheet", item.path, error, item.mime)
      return { kind: "unsupported", mime: item.mime, size, reason: "read_failed" }
    }
  }

  const archive = await archivePreview(item.path, item.mime, size).catch((error: unknown) => {
    logPreviewFailure("getLocalArtifactPreview archive", item.path, error, item.mime)
    return { kind: "unsupported" as const, mime: item.mime, size, reason: "read_failed" as const }
  })
  if (archive) {
    return archive
  }

  if (isRtfArtifact(item.path, item.mime)) {
    try {
      const preview = await readTextPreview(item.path, size)
      if (!preview) {
        return { kind: "unsupported", mime: item.mime, size, reason: "read_failed" }
      }
      return {
        kind: "text",
        mime: item.mime,
        size,
        text: rtfToPlainText(preview.text),
        truncated: preview.truncated,
      }
    } catch (error) {
      logPreviewFailure("getLocalArtifactPreview rtf", item.path, error, item.mime)
      return { kind: "unsupported", mime: item.mime, size, reason: "read_failed" }
    }
  }

  if (isBinaryDataPreviewArtifact(item.path, item.mime) && size <= richPreviewMaxBytes) {
    let verifiedDocxBytes: Buffer | undefined
    if (isPdfArtifact(item.path, item.mime) || isDocxArtifact(item.path, item.mime)) {
      if (isDocxArtifact(item.path, item.mime)) {
        const validation = await safeDocxBytes(item.path).catch(() => ({ reason: "read_failed" as const }))
        if (!("bytes" in validation)) {
          return { kind: "unsupported", mime: item.mime, size, reason: validation.reason }
        }
        verifiedDocxBytes = validation.bytes
      }
      const resource = requestResource()
      if (resource && isPdfArtifact(item.path, item.mime)) {
        return { kind: "pdf", mime: item.mime, size, ...resourceResult(resource) }
      }
      if (resource && isDocxArtifact(item.path, item.mime)) {
        return { kind: "document", mime: item.mime, size, documentFormat: "docx", ...resourceResult(resource) }
      }
    }
    try {
      const bytes = isDocxArtifact(item.path, item.mime) ? verifiedDocxBytes : await readFile(item.path)
      if (!bytes) return { kind: "unsupported", mime: item.mime, size, reason: "read_failed" }
      const richPreview = binaryDataPreview(item.path, item.mime, size, bytes)
      if (richPreview) {
        return richPreview
      }
    } catch (error) {
      logPreviewFailure("getLocalArtifactPreview rich file", item.path, error, item.mime)
      return { kind: "unsupported", mime: item.mime, size, reason: "read_failed" }
    }
  } else if (isBinaryDataPreviewArtifact(item.path, item.mime)) {
    return { kind: "unsupported", mime: item.mime, size, reason: "too_large" }
  }

  if (!isTextArtifactMime(item.mime)) {
    return { kind: "unsupported", mime: item.mime, size, reason: "unsupported_type" }
  }

  try {
    const preview = await readTextPreview(item.path, size)
    if (!preview) {
      return { kind: "unsupported", mime: item.mime, size, reason: "read_failed" }
    }
    return {
      kind: "text",
      mime: item.mime,
      size,
      text: preview.text,
      truncated: preview.truncated,
    }
  } catch (error) {
    logPreviewFailure("getLocalArtifactPreview text", item.path, error, item.mime)
    return { kind: "unsupported", mime: item.mime, size, reason: "read_failed" }
  }
}
