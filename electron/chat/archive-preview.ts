import type { LocalArtifactPreviewResult } from "./common.ts"

import { open } from "node:fs/promises"
import { archivePreviewMaxBytes } from "./archive-preview-limits.ts"
export { archivePreviewMaxBytes, archivePreviewMaxEntries } from "./archive-preview-limits.ts"
import { readTarPreview } from "./archive-tar-preview.ts"
import { readZipPreview } from "./archive-zip-preview.ts"

export async function zipPreviewFromBytes(
  bytes: Buffer,
  mime: string,
  size: number,
): Promise<LocalArtifactPreviewResult> {
  if (Math.max(size, bytes.length) > archivePreviewMaxBytes) {
    return { kind: "unsupported", mime, size, reason: "too_large" }
  }
  const archive = await readZipPreview(bytes.length, async (offset, length) => bytes.subarray(offset, offset + length))
  return {
    kind: "archive",
    mime,
    size,
    archive,
    truncated: archive.totalEntries === null || archive.totalEntries > archive.entries.length,
  }
}

export async function archivePreview(
  filePath: string,
  mime: string,
  size: number,
  signal?: AbortSignal,
): Promise<LocalArtifactPreviewResult | null> {
  const format = archiveFormatFromPath(filePath, mime)
  if (!format) return null
  if (size > archivePreviewMaxBytes) return { kind: "unsupported", mime, size, reason: "too_large" }
  signal?.throwIfAborted()
  const handle = await open(filePath, "r")
  try {
    const info = await handle.stat()
    if (!info.isFile()) throw new Error("Archive is not a regular file")
    if (info.size > archivePreviewMaxBytes) return { kind: "unsupported", mime, size, reason: "too_large" }
    const archive =
      format === "zip"
        ? await readZipPreview(
            info.size,
            async (offset, length) => {
              const buffer = Buffer.allocUnsafe(length)
              const { bytesRead } = await handle.read(buffer, 0, length, offset)
              if (bytesRead !== length) throw new Error("Incomplete ZIP directory")
              return buffer
            },
            { signal },
          )
        : await readTarPreview(handle, { signal })
    return {
      kind: "archive",
      mime,
      size,
      archive,
      truncated: archive.totalEntries === null || archive.totalEntries > archive.entries.length,
    }
  } finally {
    await handle.close()
  }
}

export function archiveFormatFromPath(filePath: string, mime: string): "tar" | "zip" | null {
  const name = filePath.split(/[\\/]/).pop()!.toLowerCase()
  const extension = name.slice(name.lastIndexOf("."))
  const normalized = mime.toLowerCase()
  if (extension === ".zip" || normalized === "application/zip") {
    return "zip"
  }
  if (
    extension === ".tar" ||
    extension === ".tgz" ||
    name.endsWith(".tar.gz") ||
    ["application/x-gtar", "application/x-tar"].includes(normalized)
  ) {
    return "tar"
  }
  return null
}
