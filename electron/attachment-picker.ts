export const attachmentPickerKinds = ["file", "directory", "file-or-directory"] as const

export type AttachmentPickerKind = (typeof attachmentPickerKinds)[number]

export interface SelectedAttachmentPath {
  agentMime?: string
  agentName?: string
  agentPath?: string
  agentSize?: number
  kind: "file" | "directory"
  mime: string
  name: string
  path: string
  size: number
}

export interface SaveClipboardAttachmentInput {
  bytes: ArrayBuffer
  mime?: string
  name?: string
}

export function isAttachmentPickerKind(value: unknown): value is AttachmentPickerKind {
  return attachmentPickerKinds.includes(value as AttachmentPickerKind)
}
