import type {
  AttachmentPreviewRequest,
  AttachmentPreviewResult,
  LocalArtifactPreviewRequest,
  LocalArtifactPreviewResult,
} from "./common.ts"
import type { FileHandle } from "node:fs/promises"

import { mkdtemp, open, readFile, rm, stat } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { logDiagnostic } from "../diagnostics-log.ts"
import {
  archivePreview,
  archiveFormatFromPath,
  binaryDataPreview,
  isBinaryDataPreviewArtifact,
  isDocxArtifact,
  isPdfArtifact,
  isRtfArtifact,
  isSpreadsheetPreviewArtifact,
  richPreviewMaxBytes,
  rtfToPlainText,
  spreadsheetPreview,
  spreadsheetPreviewMaxBytes,
} from "./artifact-preview.ts"
import { imageMimeFromPath, mimeFromPath } from "./artifacts.ts"
import { localArtifactItem } from "./local-artifacts.ts"
import { artifactTextPreviewMaxBytes, isTextArtifactMime, readTextPreview } from "./turn-output-files.ts"
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
  retainsHandle?: boolean
  url: string
}
export type CreateArtifactResourceUrl = (item: {
  dev: number
  ino: number
  handle?: FileHandle
  mime: string
  modifiedAt: number
  path: string
  size: number
}) => ArtifactResourceGrant | undefined
export type CreateSpreadsheetPreview = (path: string, mime: string, size: number) => Promise<LocalArtifactPreviewResult>

export interface ArtifactPreviewFileIdentity {
  dev: number
  handle: FileHandle
  ino: number
  modifiedAt: number
  size: number
}

async function snapshotTrustedFile(
  identity: ArtifactPreviewFileIdentity,
  sourcePath: string,
  maxBytes = identity.size,
): Promise<{ directory: string; path: string }> {
  const directory = await mkdtemp(path.join(os.tmpdir(), "wanta-artifact-preview-"))
  const target = path.join(directory, path.basename(sourcePath) || "artifact")
  let targetHandle: FileHandle | undefined
  try {
    targetHandle = await open(target, "wx")
    const buffer = Buffer.allocUnsafe(64 * 1024)
    const snapshotSize = Math.min(identity.size, maxBytes)
    let position = 0
    while (position < snapshotSize) {
      const { bytesRead } = await identity.handle.read(
        buffer,
        0,
        Math.min(buffer.length, snapshotSize - position),
        position,
      )
      if (bytesRead === 0) break
      let written = 0
      while (written < bytesRead) {
        const result = await targetHandle.write(buffer, written, bytesRead - written, position + written)
        written += result.bytesWritten
      }
      position += bytesRead
    }
    const current = await identity.handle.stat()
    if (
      position !== snapshotSize ||
      current.dev !== identity.dev ||
      current.ino !== identity.ino ||
      current.size !== identity.size ||
      current.mtimeMs !== identity.modifiedAt
    ) {
      throw new Error("Artifact changed while creating a preview snapshot")
    }
    return { directory, path: target }
  } catch (error) {
    await rm(directory, { force: true, recursive: true })
    throw error
  } finally {
    await targetHandle?.close().catch(() => undefined)
  }
}

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
      const resource = createResourceUrl({
        dev: info.dev,
        ino: info.ino,
        mime,
        modifiedAt: info.mtimeMs,
        path: req.path,
        size: info.size,
      })
      if (resource) {
        return { dataUrl: null, ...resourceResult(resource) }
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
  fileIdentity?: ArtifactPreviewFileIdentity,
): Promise<LocalArtifactPreviewResult> {
  const item = fileIdentity
    ? {
        kind: "file" as const,
        mime: mimeFromPath(req.path),
        modifiedAt: fileIdentity.modifiedAt,
        name: path.basename(req.path),
        path: req.path,
        size: fileIdentity.size,
      }
    : await localArtifactItem(req.path)
  if (!item || item.kind !== "file") {
    return { kind: "unsupported", mime: "application/octet-stream", reason: "missing" }
  }

  const size = fileIdentity?.size ?? item.size ?? 0
  let handleTransferred = false
  let snapshot: { directory: string; path: string } | undefined
  const requestResource = (): ArtifactResourceGrant | undefined => {
    const resource = createResourceUrl?.({
      dev: fileIdentity?.dev ?? 0,
      handle: fileIdentity?.handle,
      ino: fileIdentity?.ino ?? 0,
      mime: item.mime,
      modifiedAt: fileIdentity?.modifiedAt ?? item.modifiedAt ?? 0,
      path: item.path,
      size,
    })
    if (resource?.retainsHandle && fileIdentity) handleTransferred = true
    return resource
  }
  const previewPath = async (maxBytes?: number): Promise<string> => {
    if (!fileIdentity) return item.path
    snapshot ??= await snapshotTrustedFile(fileIdentity, item.path, maxBytes)
    return snapshot.path
  }
  try {
    if (item.mime.toLowerCase().startsWith("image/")) {
      if (size > attachmentPreviewMaxBytes) {
        return { kind: "unsupported", mime: item.mime, size, reason: "too_large" }
      }
      const resource = requestResource()
      if (resource) {
        return { kind: "image", mime: item.mime, size, ...resourceResult(resource) }
      }
      try {
        const bytes = await readFile(await previewPath())
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
      const resource = requestResource()
      if (resource) {
        return { kind: "media", mime: item.mime, size, ...resourceResult(resource) }
      }
      if (size > attachmentPreviewMaxBytes) {
        return { kind: "unsupported", mime: item.mime, size, reason: "too_large" }
      }
      try {
        const bytes = await readFile(await previewPath())
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
      if (size > spreadsheetPreviewMaxBytes) {
        return { kind: "unsupported", mime: item.mime, size, reason: "too_large" }
      }
      try {
        return await createSpreadsheetPreview(await previewPath(), item.mime, size)
      } catch (error) {
        logPreviewFailure("getLocalArtifactPreview spreadsheet", item.path, error, item.mime)
        return { kind: "unsupported", mime: item.mime, size, reason: "read_failed" }
      }
    }

    if (archiveFormatFromPath(item.path, item.mime)) {
      const archive = await archivePreview(await previewPath(), item.mime, size).catch((error: unknown) => {
        logPreviewFailure("getLocalArtifactPreview archive", item.path, error, item.mime)
        return { kind: "unsupported" as const, mime: item.mime, size, reason: "read_failed" as const }
      })
      return archive ?? { kind: "unsupported", mime: item.mime, size, reason: "read_failed" }
    }

    if (isRtfArtifact(item.path, item.mime)) {
      try {
        const preview = await readTextPreview(await previewPath(artifactTextPreviewMaxBytes), size)
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
          const validation = await safeDocxBytes(await previewPath()).catch(() => ({ reason: "read_failed" as const }))
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
        const bytes = isDocxArtifact(item.path, item.mime) ? verifiedDocxBytes : await readFile(await previewPath())
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
      const preview = await readTextPreview(await previewPath(artifactTextPreviewMaxBytes), size)
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
  } finally {
    if (snapshot) await rm(snapshot.directory, { force: true, recursive: true }).catch(() => undefined)
    if (fileIdentity && !handleTransferred) await fileIdentity.handle.close().catch(() => undefined)
  }
}
