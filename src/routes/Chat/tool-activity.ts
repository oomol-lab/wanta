import type { ChatMessagePart } from "../../../electron/chat/common.ts"
import type { TranslateFn } from "@/i18n/i18n"

interface ToolActivityTitleState {
  hasActive: boolean
  hasError: boolean
  hasStopped: boolean
  singleSummary?: string
}

export function toolActivityTitle(
  t: TranslateFn,
  parts: ChatMessagePart[],
  { hasActive, hasError, hasStopped, singleSummary }: ToolActivityTitleState,
): string {
  if (parts.length === 1 && singleSummary?.trim()) {
    return singleSummary
  }
  if (hasError) {
    return t("chat.toolActivityError", { count: parts.length })
  }
  if (hasActive) {
    return t("chat.toolActivityRunning", { count: parts.length })
  }
  if (hasStopped) {
    return t("chat.toolActivityStopped", { count: parts.length })
  }
  return t("chat.toolActivityCompleted", { count: parts.length })
}

export function formatToolDuration(part: ChatMessagePart, now = Date.now()): string | null {
  const start = part.timing?.start
  const end = part.timing?.end ?? (part.status === "running" ? now : undefined)
  if (typeof start !== "number" || typeof end !== "number" || end < start) {
    return null
  }
  const ms = end - start
  return ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(ms < 10_000 ? 1 : 0)}s`
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
