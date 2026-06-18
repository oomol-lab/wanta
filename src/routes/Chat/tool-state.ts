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
  return (
    normalized === "task cancelled" ||
    normalized === "task canceled" ||
    normalized === "aborted" ||
    normalized === "aborterror" ||
    normalized.startsWith("aborterror:") ||
    normalized.includes("operation was aborted")
  )
}

export function isToolCancellation(part: ChatMessagePart): boolean {
  return (
    part.kind === "tool" &&
    (part.cancelled === true || (part.status === "error" && isToolCancellationMessage(part.error)))
  )
}

export function isActiveToolPart(part: ChatMessagePart): boolean {
  return part.kind === "tool" && !isToolCancellation(part) && (part.status === "pending" || part.status === "running")
}

export function hasBlockingToolError(parts: ChatMessagePart[]): boolean {
  return parts.some((part) => part.kind === "tool" && part.status === "error" && !isToolCancellation(part))
}

export function hasStoppedTool(parts: ChatMessagePart[]): boolean {
  return parts.some(isToolCancellation)
}
