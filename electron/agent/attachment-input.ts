import type { ChatAttachment } from "../chat/common.ts"

import { stat } from "node:fs/promises"

export interface AttachmentModelCapabilities {
  images: boolean
  pdf: boolean
}

export type PlannedAttachmentInput =
  | { kind: "file"; mime: string; name: string; path: string }
  | {
      kind: "internal-text"
      purpose: "attachment-limit" | "attachment-reference"
      text: string
    }

export interface AttachmentInputDependencies {
  fileSize: (path: string) => Promise<number | null>
}

export const maxAttachmentsPerTurn = 20
export const maxDirectAttachmentBytes = 20 * 1024 * 1024
export const maxDirectAttachmentsTotalBytes = 40 * 1024 * 1024

const directImageMimes = new Set(["image/gif", "image/jpeg", "image/png", "image/webp"])
const textApplicationMimes = new Set([
  "application/javascript",
  "application/json",
  "application/ld+json",
  "application/sql",
  "application/toml",
  "application/x-httpd-php",
  "application/x-javascript",
  "application/x-ndjson",
  "application/x-sh",
  "application/x-yaml",
  "application/xml",
  "application/yaml",
])
const textExtensions = new Set([
  "bash",
  "c",
  "cc",
  "cfg",
  "cjs",
  "conf",
  "cpp",
  "cs",
  "css",
  "csv",
  "cxx",
  "dart",
  "env",
  "fish",
  "go",
  "h",
  "hpp",
  "htm",
  "html",
  "ini",
  "java",
  "js",
  "json",
  "jsonl",
  "jsx",
  "kt",
  "kts",
  "less",
  "log",
  "lua",
  "md",
  "mjs",
  "php",
  "pl",
  "properties",
  "py",
  "r",
  "rb",
  "rs",
  "sass",
  "scala",
  "scss",
  "sh",
  "sql",
  "svelte",
  "swift",
  "toml",
  "ts",
  "tsv",
  "tsx",
  "txt",
  "vue",
  "xml",
  "yaml",
  "yml",
  "zsh",
])

function extension(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? name
  const index = base.lastIndexOf(".")
  return index < 0 ? "" : base.slice(index + 1).toLowerCase()
}

function isDirectory(attachment: ChatAttachment): boolean {
  return attachment.kind === "directory" || attachment.mime.toLowerCase() === "inode/directory"
}

function isTextInput(name: string, mime: string): boolean {
  const normalizedMime = mime.toLowerCase()
  return (
    normalizedMime.startsWith("text/") ||
    textApplicationMimes.has(normalizedMime) ||
    textExtensions.has(extension(name))
  )
}

function attachmentSource(attachment: ChatAttachment): { mime: string; name: string; path: string; size: number } {
  return attachment.agentPath
    ? {
        mime: attachment.agentMime || "application/octet-stream",
        name: attachment.agentName || attachment.name,
        path: attachment.agentPath,
        size: attachment.agentSize ?? attachment.size,
      }
    : { mime: attachment.mime, name: attachment.name, path: attachment.path, size: attachment.size }
}

async function actualFileSize(filePath: string): Promise<number | null> {
  try {
    const info = await stat(filePath)
    return info.isFile() ? info.size : null
  } catch {
    return null
  }
}

const defaultDependencies: AttachmentInputDependencies = { fileSize: actualFileSize }

function sizeLabel(size: number): string {
  if (!Number.isFinite(size) || size <= 0) return "unknown size"
  if (size < 1024) return `${size} B`
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`
  return `${(size / 1024 / 1024).toFixed(1)} MB`
}

function pathReference(
  attachment: ChatAttachment,
  source: { mime: string; name: string; path: string; size: number },
  reason: string,
): PlannedAttachmentInput {
  return {
    kind: "internal-text",
    purpose: "attachment-reference",
    text: [
      `Attached local file: ${attachment.name}`,
      `Path: ${attachment.path}`,
      `Media type: ${attachment.mime || "application/octet-stream"}; size: ${sizeLabel(attachment.size)}`,
      `The file was not embedded in the model request because ${reason}.`,
      source.path === attachment.path
        ? "Use an appropriate local tool or script against the exact path when the task requires its contents. Do not use the Read tool on an unsupported binary file."
        : `A prepared copy exists at ${source.path}, but it was not embedded. Use local tools against the original or prepared path as appropriate.`,
    ].join("\n"),
  }
}

export async function planAttachmentInputs(
  attachments: readonly ChatAttachment[] | undefined,
  capabilities: AttachmentModelCapabilities,
  dependencies: AttachmentInputDependencies = defaultDependencies,
): Promise<PlannedAttachmentInput[]> {
  const inputs: PlannedAttachmentInput[] = []
  let directBytes = 0
  const accepted = (attachments ?? []).slice(0, maxAttachmentsPerTurn)

  for (const attachment of accepted) {
    const snapshotSource = attachmentSource(attachment)
    const mime = snapshotSource.mime.toLowerCase() || "application/octet-stream"
    if (isDirectory(attachment)) {
      inputs.push({
        kind: "file",
        mime: "application/x-directory",
        name: snapshotSource.name,
        path: snapshotSource.path,
      })
      continue
    }

    const size = await dependencies.fileSize(snapshotSource.path).catch(() => null)
    if (size === null) {
      inputs.push(
        pathReference(
          attachment,
          snapshotSource,
          "its current size could not be verified immediately before the model request",
        ),
      )
      continue
    }
    const source = { ...snapshotSource, size }

    const sizeIsSafe =
      source.size <= maxDirectAttachmentBytes && directBytes + source.size <= maxDirectAttachmentsTotalBytes
    if (!sizeIsSafe) {
      inputs.push(pathReference(attachment, source, "it exceeds the safe direct-attachment size budget"))
      continue
    }

    if (isTextInput(source.name, mime)) {
      directBytes += Math.max(0, source.size)
      inputs.push({ kind: "file", mime: "text/plain", name: source.name, path: source.path })
      continue
    }

    if (directImageMimes.has(mime)) {
      if (!capabilities.images) {
        inputs.push(pathReference(attachment, source, "the selected model does not support image input"))
        continue
      }
      directBytes += Math.max(0, source.size)
      inputs.push({ kind: "file", mime, name: source.name, path: source.path })
      continue
    }

    if (mime === "application/pdf") {
      if (!capabilities.pdf) {
        inputs.push(pathReference(attachment, source, "the selected model does not support direct PDF input"))
        continue
      }
      directBytes += Math.max(0, source.size)
      inputs.push({ kind: "file", mime, name: source.name, path: source.path })
      continue
    }

    const reason = mime.startsWith("image/")
      ? `its image format (${mime}) is not in the normalized image allowlist`
      : `its media type (${mime}) is not safe to pass through to the selected model provider`
    inputs.push(pathReference(attachment, source, reason))
  }

  const omitted = (attachments?.length ?? 0) - accepted.length
  if (omitted > 0) {
    inputs.push({
      kind: "internal-text",
      purpose: "attachment-limit",
      text: `${omitted} additional attachment${omitted === 1 ? " was" : "s were"} not embedded because the per-turn limit is ${maxAttachmentsPerTurn}. Ask the user to split the files across multiple turns if they are required.`,
    })
  }
  return inputs
}
