import type {
  AttachmentPreviewRequest,
  AttachmentPreviewResult,
  LocalArtifactPreviewRequest,
  LocalArtifactPreviewResult,
} from "./common.ts"

import { readFile, stat } from "node:fs/promises"
import {
  archivePreview,
  binaryDataPreview,
  isBinaryDataPreviewArtifact,
  isRtfArtifact,
  isXlsxArtifact,
  richPreviewMaxBytes,
  rtfToPlainText,
  spreadsheetPreview,
} from "./artifact-preview.ts"
import { imageMimeFromPath } from "./artifacts.ts"
import { localArtifactItem } from "./local-artifacts.ts"
import { isTextArtifactMime, readTextPreview } from "./turn-output-files.ts"

const attachmentPreviewMaxBytes = 16 * 1024 * 1024

function errorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message
  }
  return String(error)
}

function attachmentPreviewMime(req: AttachmentPreviewRequest): string | null {
  if (req.mime.toLowerCase().startsWith("image/")) {
    return req.mime
  }
  return imageMimeFromPath(req.path)
}

export async function attachmentPreview(req: AttachmentPreviewRequest): Promise<AttachmentPreviewResult> {
  const mime = attachmentPreviewMime(req)
  if (!mime) {
    return { dataUrl: null }
  }
  try {
    const info = await stat(req.path)
    if (!info.isFile() || info.size > attachmentPreviewMaxBytes) {
      return { dataUrl: null }
    }
    const bytes = await readFile(req.path)
    return { dataUrl: `data:${mime};base64,${bytes.toString("base64")}` }
  } catch (error) {
    console.error("[wanta] getAttachmentPreview failed", { path: req.path, error: errorMessage(error) })
    return { dataUrl: null }
  }
}

export async function localArtifactPreview(req: LocalArtifactPreviewRequest): Promise<LocalArtifactPreviewResult> {
  const item = await localArtifactItem(req.path)
  if (!item || item.kind !== "file") {
    return { kind: "unsupported", mime: "application/octet-stream", reason: "missing" }
  }

  const size = item.size ?? 0
  if (item.mime.toLowerCase().startsWith("image/")) {
    if (size > attachmentPreviewMaxBytes) {
      return { kind: "unsupported", mime: item.mime, size, reason: "too_large" }
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
      console.error("[wanta] getLocalArtifactPreview image failed", { path: req.path, error: errorMessage(error) })
      return { kind: "unsupported", mime: item.mime, size, reason: "read_failed" }
    }
  }

  if (item.mime.toLowerCase().startsWith("audio/") || item.mime.toLowerCase().startsWith("video/")) {
    if (size > attachmentPreviewMaxBytes) {
      return { kind: "unsupported", mime: item.mime, size, reason: "too_large" }
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
      console.error("[wanta] getLocalArtifactPreview media failed", { path: req.path, error: errorMessage(error) })
      return { kind: "unsupported", mime: item.mime, size, reason: "read_failed" }
    }
  }

  if (isXlsxArtifact(item.path, item.mime)) {
    try {
      return await spreadsheetPreview(item.path, item.mime, size)
    } catch (error) {
      console.error("[wanta] getLocalArtifactPreview spreadsheet failed", {
        path: req.path,
        error: errorMessage(error),
      })
      return { kind: "unsupported", mime: item.mime, size, reason: "read_failed" }
    }
  }

  const archive = await archivePreview(item.path, item.mime, size).catch((error: unknown) => {
    console.error("[wanta] getLocalArtifactPreview archive failed", { path: req.path, error: errorMessage(error) })
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
      console.error("[wanta] getLocalArtifactPreview rtf failed", { path: req.path, error: errorMessage(error) })
      return { kind: "unsupported", mime: item.mime, size, reason: "read_failed" }
    }
  }

  if (isBinaryDataPreviewArtifact(item.path, item.mime) && size <= richPreviewMaxBytes) {
    try {
      const bytes = await readFile(item.path)
      const richPreview = binaryDataPreview(item.path, item.mime, size, bytes)
      if (richPreview) {
        return richPreview
      }
    } catch (error) {
      console.error("[wanta] getLocalArtifactPreview rich file failed", {
        path: req.path,
        error: errorMessage(error),
      })
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
    console.error("[wanta] getLocalArtifactPreview text failed", { path: req.path, error: errorMessage(error) })
    return { kind: "unsupported", mime: item.mime, size, reason: "read_failed" }
  }
}
