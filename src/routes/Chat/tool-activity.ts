import type { ChatMessagePart } from "../../../electron/chat/common.ts"
import type { TranslateFn } from "@/i18n/i18n"

export type ToolCategory = "connector" | "shell" | "file" | "web" | "task" | "skill" | "custom" | "mixed"

interface ToolActivityTitleState {
  hasActive: boolean
  hasError: boolean
  hasStopped: boolean
  duration?: string | null
  category?: ToolCategory
}

export function toolActivityTitle(
  t: TranslateFn,
  parts: ChatMessagePart[],
  { hasActive, hasError, hasStopped, duration, category = summarizeToolCategory(parts) }: ToolActivityTitleState,
): string {
  const withDuration = (title: string) => (duration ? `${title} · ${duration}` : title)
  if (hasError) {
    return withDuration(
      category === "mixed"
        ? t("chat.toolActivityError", { count: parts.length })
        : t("chat.toolActivityCategoryError", { count: parts.length, category: toolCategoryLabel(t, category) }),
    )
  }
  if (hasActive) {
    return withDuration(
      category === "mixed"
        ? t("chat.toolActivityRunning", { count: parts.length })
        : t("chat.toolActivityCategoryRunning", { count: parts.length, category: toolCategoryLabel(t, category) }),
    )
  }
  if (hasStopped) {
    return withDuration(
      category === "mixed"
        ? t("chat.toolActivityStopped", { count: parts.length })
        : t("chat.toolActivityCategoryStopped", { count: parts.length, category: toolCategoryLabel(t, category) }),
    )
  }
  return withDuration(
    category === "mixed"
      ? t("chat.toolActivityCompleted", { count: parts.length })
      : t("chat.toolActivityCategoryCompleted", { count: parts.length, category: toolCategoryLabel(t, category) }),
  )
}

export function classifyToolPart(part: ChatMessagePart): ToolCategory {
  switch (part.tool) {
    case "search_actions":
    case "inspect_action":
    case "call_action":
      return "connector"
    case "bash":
      return "shell"
    case "read":
    case "write":
    case "edit":
    case "list":
    case "grep":
    case "glob":
      return "file"
    case "webfetch":
      return "web"
    case "task":
      return "task"
    default:
      if (part.tool?.startsWith("todo")) {
        return "task"
      }
      if (part.title?.match(/^Loaded skill:/i)) {
        return "skill"
      }
      return "custom"
  }
}

export function summarizeToolCategory(parts: ChatMessagePart[]): ToolCategory {
  let category: ToolCategory | undefined
  for (const part of parts) {
    const current = classifyToolPart(part)
    if (category === undefined) {
      category = current
      continue
    }
    if (category !== current) {
      return "mixed"
    }
  }
  return category ?? "custom"
}

export function toolCategoryLabel(t: TranslateFn, category: ToolCategory): string {
  switch (category) {
    case "connector":
      return t("chat.toolCategoryConnector")
    case "shell":
      return t("chat.toolCategoryShell")
    case "file":
      return t("chat.toolCategoryFile")
    case "web":
      return t("chat.toolCategoryWeb")
    case "task":
      return t("chat.toolCategoryTask")
    case "skill":
      return t("chat.toolCategorySkill")
    case "custom":
      return t("chat.toolCategoryCustom")
    case "mixed":
      return t("chat.toolCategoryMixed")
  }
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
