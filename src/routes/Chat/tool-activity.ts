import type { ChatMessagePart } from "../../../electron/chat/common.ts"
import type { TranslateFn } from "@/i18n/i18n"

interface ToolActivityTitleState {
  hasActive: boolean
  hasError: boolean
  hasStopped: boolean
  duration?: string | null
}

export function toolActivityTitle(
  t: TranslateFn,
  parts: ChatMessagePart[],
  { hasActive, hasError, hasStopped, duration }: ToolActivityTitleState,
): string {
  const withDuration = (title: string) => (duration ? `${title} · ${duration}` : title)
  if (hasError) {
    return withDuration(t("chat.toolActivityError", { count: parts.length }))
  }
  if (hasActive) {
    return withDuration(t("chat.toolActivityRunning", { count: parts.length }))
  }
  if (hasStopped) {
    return withDuration(t("chat.toolActivityStopped", { count: parts.length }))
  }
  return withDuration(t("chat.toolActivityCompleted", { count: parts.length }))
}

export function formatToolDuration(part: ChatMessagePart, now = Date.now()): string | null {
  const start = part.timing?.start
  const end = part.timing?.end ?? (part.status === "running" ? now : undefined)
  if (typeof start !== "number" || typeof end !== "number" || end < start) {
    return null
  }
  return formatMs(end - start)
}

export function shouldShowRunningNoOutput(part: ChatMessagePart): boolean {
  return part.tool === "bash" && part.status === "running" && !part.output && !part.error
}

export function compactToolDetail(value: string, maxLength = 72): string {
  const text = value.replace(/\s+/g, " ").trim()
  if (text.length <= maxLength) {
    return text
  }
  if (maxLength <= 1) {
    return "…"
  }
  return `${text.slice(0, maxLength - 1).trimEnd()}…`
}

export function compactPathDetail(value: string, maxLength = 72): string {
  const text = value.replace(/\s+/g, " ").trim()
  if (text.length <= maxLength) {
    return text
  }
  if (maxLength <= 1) {
    return "…"
  }
  const keepStart = Math.max(1, Math.floor((maxLength - 1) * 0.4))
  const keepEnd = Math.max(1, maxLength - 1 - keepStart)
  return `${text.slice(0, keepStart).trimEnd()}…${text.slice(text.length - keepEnd).trimStart()}`
}

export function formatToolActivityDuration(parts: ChatMessagePart[], now = Date.now()): string | null {
  let start: number | undefined
  let end: number | undefined
  for (const part of parts) {
    const partStart = part.timing?.start
    const partEnd = part.timing?.end ?? (part.status === "running" ? now : undefined)
    if (typeof partStart !== "number" || typeof partEnd !== "number" || partEnd < partStart) {
      continue
    }
    start = start === undefined ? partStart : Math.min(start, partStart)
    end = end === undefined ? partEnd : Math.max(end, partEnd)
  }
  if (start === undefined || end === undefined) {
    return null
  }
  return formatMs(end - start)
}

function formatMs(ms: number): string {
  return ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(ms < 10_000 ? 1 : 0)}s`
}
