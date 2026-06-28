import type { ChatAttachment } from "../../../electron/chat/common.ts"
import type { ComposerAction, DraftAttachment } from "./composer-state.ts"

import * as React from "react"
import {
  filesFromDataTransfer,
  isImageAttachment,
  revokeAttachmentPreviewUrls,
  setAttachmentPreviewUrl,
} from "./chat-attachment-utils.ts"
import { useT } from "@/i18n/i18n"

export interface ComposerAttachmentInput {
  agentMime?: string
  agentName?: string
  agentPath?: string
  agentSize?: number
  name: string
  mime: string
  size: number
  path: string
  kind?: "file" | "directory"
  file?: File
}

interface UseComposerAttachmentsOptions {
  attachments: DraftAttachment[]
  disabled: boolean
  dispatch: React.Dispatch<ComposerAction>
  setInputError: (error: string | null) => void
}

export interface UseComposerAttachments {
  fileInputRef: React.RefObject<HTMLInputElement | null>
  addAttachments: (items: ComposerAttachmentInput[]) => void
  addFiles: (files: FileList | File[]) => Promise<void>
  handleDragOver: (event: React.DragEvent<HTMLFormElement>) => void
  handleDrop: (event: React.DragEvent<HTMLFormElement>) => void
  handleFileInputChange: (event: React.ChangeEvent<HTMLInputElement>) => void
  handlePaste: (event: React.ClipboardEvent<HTMLTextAreaElement>) => void
  removeAttachment: (id: string) => void
  revokeCurrentPreviews: () => void
  selectAttachments: (kind: "file" | "directory") => Promise<void>
}

const imageOptimizeMaxSidePx = 1600
const imageOptimizeMinBytes = 1.5 * 1024 * 1024
const imageOptimizeQuality = 0.84
const optimizableImageMimes = new Set(["image/bmp", "image/jpeg", "image/jpg", "image/png", "image/webp"])

function optimizedImageName(name: string, mime: string): string {
  const base = name.replace(/\.[^.\\/]+$/, "") || "image"
  return `${base}-optimized.${mime === "image/jpeg" ? "jpg" : "webp"}`
}

function canvasToBlob(canvas: HTMLCanvasElement, mime: string, quality: number): Promise<Blob | null> {
  return new Promise((resolve) => {
    canvas.toBlob((blob) => resolve(blob), mime, quality)
  })
}

async function optimizeImageFileForAgent(
  file: File,
): Promise<{ bytes: ArrayBuffer; mime: string; name: string } | null> {
  const sourceMime = file.type.toLowerCase()
  if (!optimizableImageMimes.has(sourceMime)) {
    return null
  }

  const bitmap = await createImageBitmap(file)
  try {
    const scale = Math.min(1, imageOptimizeMaxSidePx / Math.max(bitmap.width, bitmap.height))
    if (scale >= 1 && file.size < imageOptimizeMinBytes) {
      return null
    }

    const width = Math.max(1, Math.round(bitmap.width * scale))
    const height = Math.max(1, Math.round(bitmap.height * scale))
    const canvas = document.createElement("canvas")
    canvas.width = width
    canvas.height = height
    const context = canvas.getContext("2d")
    if (!context) {
      return null
    }
    context.drawImage(bitmap, 0, 0, width, height)

    const outputMime = sourceMime === "image/jpeg" || sourceMime === "image/jpg" ? "image/jpeg" : "image/webp"
    const blob = await canvasToBlob(canvas, outputMime, imageOptimizeQuality)
    if (!blob || blob.size >= file.size * 0.9) {
      return null
    }
    return {
      bytes: await blob.arrayBuffer(),
      mime: blob.type || outputMime,
      name: optimizedImageName(file.name || "image", blob.type || outputMime),
    }
  } finally {
    bitmap.close()
  }
}

function toDraftAttachment(item: ComposerAttachmentInput): DraftAttachment {
  const attachment: DraftAttachment = {
    ...(item.agentPath
      ? {
          agentMime: item.agentMime,
          agentName: item.agentName,
          agentPath: item.agentPath,
          agentSize: item.agentSize,
        }
      : {}),
    id: `${Date.now()}-${item.kind ?? "file"}-${item.name}-${item.size}-${Math.random().toString(36).slice(2)}`,
    name: item.name || item.path.split(/[\\/]/).pop() || "attachment",
    mime: item.mime || (item.kind === "directory" ? "inode/directory" : "application/octet-stream"),
    size: item.size,
    path: item.path,
    kind: item.kind ?? "file",
  }
  if (item.file && isImageAttachment(attachment)) {
    attachment.previewUrl = URL.createObjectURL(item.file)
  }
  return attachment
}

export function useComposerAttachments({
  attachments,
  disabled,
  dispatch,
  setInputError,
}: UseComposerAttachmentsOptions): UseComposerAttachments {
  const t = useT()
  const fileInputRef = React.useRef<HTMLInputElement | null>(null)
  const attachmentsRef = React.useRef<DraftAttachment[]>([])

  React.useEffect(() => {
    attachmentsRef.current = attachments
  }, [attachments])

  React.useEffect(() => () => revokeAttachmentPreviewUrls(attachmentsRef.current), [])

  const addAttachments = React.useCallback(
    (items: ComposerAttachmentInput[]) => {
      const next = items.map(toDraftAttachment)
      if (next.length === 0) {
        return
      }
      const seen = new Set(attachmentsRef.current.map((attachment) => attachment.path))
      const uniqueNext = next.filter((attachment) => {
        if (seen.has(attachment.path)) {
          return false
        }
        seen.add(attachment.path)
        return true
      })
      const acceptedIds = new Set(uniqueNext.map((attachment) => attachment.id))
      revokeAttachmentPreviewUrls(next.filter((attachment) => !acceptedIds.has(attachment.id)))
      for (const attachment of uniqueNext) {
        if (attachment.previewUrl) {
          setAttachmentPreviewUrl(attachment.path, attachment.previewUrl)
        }
      }
      dispatch({ type: "add-attachments", attachments: uniqueNext })
    },
    [dispatch],
  )

  const addFiles = React.useCallback(
    async (files: FileList | File[]) => {
      setInputError(null)
      const next: ComposerAttachmentInput[] = []
      for (const file of Array.from(files)) {
        const path = globalThis.wanta?.getPathForFile(file)
        const saver = globalThis.wanta?.saveClipboardAttachment
        let optimized: {
          name: string
          mime: string
          size: number
          path: string
          kind: "file" | "directory"
        } | null = null
        if (saver) {
          try {
            const optimizedFile = await optimizeImageFileForAgent(file)
            if (optimizedFile) {
              optimized = await saver(optimizedFile)
            }
          } catch {
            optimized = null
          }
        }
        if (!path) {
          if (!saver) {
            setInputError(t("chat.attachmentPathUnavailable"))
            continue
          }
          try {
            const saved =
              optimized ??
              (await saver({
                name: file.name,
                mime: file.type || "application/octet-stream",
                bytes: await file.arrayBuffer(),
              }))
            next.push({
              name: saved.name,
              mime: saved.mime,
              size: saved.size,
              path: saved.path,
              kind: saved.kind,
              file,
            })
          } catch {
            setInputError(t("chat.attachmentSaveFailed"))
          }
          continue
        }
        next.push({
          name: file.name || path.split(/[\\/]/).pop() || "attachment",
          mime: file.type || "application/octet-stream",
          size: file.size,
          path,
          kind: "file",
          ...(optimized
            ? {
                agentMime: optimized.mime,
                agentName: optimized.name,
                agentPath: optimized.path,
                agentSize: optimized.size,
              }
            : {}),
          file,
        })
      }
      addAttachments(next)
    },
    [addAttachments, setInputError, t],
  )

  const selectAttachments = React.useCallback(
    async (kind: "file" | "directory") => {
      setInputError(null)
      const picker = globalThis.wanta?.selectAttachmentPaths
      if (!picker) {
        if (kind === "file") {
          fileInputRef.current?.click()
        } else {
          setInputError(t("chat.attachmentFolderPickerUnavailable"))
        }
        return
      }
      try {
        addAttachments(await picker(kind))
      } catch (error) {
        setInputError(error instanceof Error ? error.message : String(error))
      }
    },
    [addAttachments, setInputError, t],
  )

  const removeAttachment = React.useCallback(
    (id: string) => {
      revokeAttachmentPreviewUrls(attachmentsRef.current.filter((attachment) => attachment.id === id))
      dispatch({ type: "remove-attachment", id })
    },
    [dispatch],
  )

  const revokeCurrentPreviews = React.useCallback(() => {
    revokeAttachmentPreviewUrls(attachmentsRef.current)
  }, [])

  const handleDragOver = React.useCallback((event: React.DragEvent<HTMLFormElement>) => {
    if (event.dataTransfer.types.includes("Files")) {
      event.preventDefault()
    }
  }, [])

  const handleDrop = React.useCallback(
    (event: React.DragEvent<HTMLFormElement>) => {
      if (!event.dataTransfer.types.includes("Files")) {
        return
      }
      event.preventDefault()
      const files = filesFromDataTransfer(event.dataTransfer)
      if (disabled || files.length === 0) {
        return
      }
      void addFiles(files)
    },
    [addFiles, disabled],
  )

  const handlePaste = React.useCallback(
    (event: React.ClipboardEvent<HTMLTextAreaElement>) => {
      const files = filesFromDataTransfer(event.clipboardData)
      if (disabled || files.length === 0) {
        return
      }
      event.preventDefault()
      void addFiles(files)
    },
    [addFiles, disabled],
  )

  const handleFileInputChange = React.useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      if (disabled) {
        event.currentTarget.value = ""
        return
      }
      if (event.currentTarget.files) {
        void addFiles(event.currentTarget.files)
      }
      event.currentTarget.value = ""
    },
    [addFiles, disabled],
  )

  return {
    fileInputRef,
    addAttachments,
    addFiles,
    handleDragOver,
    handleDrop,
    handleFileInputChange,
    handlePaste,
    removeAttachment,
    revokeCurrentPreviews,
    selectAttachments,
  }
}

export function stripDraftAttachment(attachment: DraftAttachment): ChatAttachment {
  const { previewUrl: _previewUrl, ...chatAttachment } = attachment
  return chatAttachment
}
