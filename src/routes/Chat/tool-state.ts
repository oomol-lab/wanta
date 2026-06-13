import type { ChatMessagePart } from "../../../electron/chat/common.ts"

function normalizedTerminalMessage(message: string): string {
  return message
    .trim()
    .replace(/[.!。]+$/, "")
    .toLowerCase()
}

export function isToolCancellationMessage(message: string | undefined): boolean {
  if (!message) {
    return false
  }
  const normalized = normalizedTerminalMessage(message)
  return normalized === "task cancelled" || normalized === "task canceled"
}

export function isToolCancellation(part: ChatMessagePart): boolean {
  return part.kind === "tool" && part.status === "error" && isToolCancellationMessage(part.error)
}

export function hasBlockingToolError(parts: ChatMessagePart[]): boolean {
  return parts.some((part) => part.kind === "tool" && part.status === "error" && !isToolCancellation(part))
}

export function hasStoppedTool(parts: ChatMessagePart[]): boolean {
  return parts.some(isToolCancellation)
}
