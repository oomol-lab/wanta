export const attachmentPickerKinds = ["file", "directory", "file-or-directory"] as const

export type AttachmentPickerKind = (typeof attachmentPickerKinds)[number]

export function isAttachmentPickerKind(value: unknown): value is AttachmentPickerKind {
  return attachmentPickerKinds.includes(value as AttachmentPickerKind)
}
