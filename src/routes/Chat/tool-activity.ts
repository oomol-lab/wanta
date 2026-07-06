import type { ChatMessagePart } from "../../../electron/chat/common.ts"
import type { MessageKey, TranslateFn } from "@/i18n/i18n"

import { isActiveToolPart } from "./tool-state.ts"

export type ToolCategory = "connector" | "shell" | "file" | "web" | "task" | "skill" | "custom" | "mixed"

interface ToolActivityTitleState {
  hasActive: boolean
  hasError: boolean
  hasStopped: boolean
  duration?: string | null
  category?: ToolCategory
}

type ToolActivityTitleKind =
  | "connector"
  | "shell"
  | "file"
  | "fileRead"
  | "fileWrite"
  | "fileEdit"
  | "fileList"
  | "fileSearch"
  | "web"
  | "task"
  | "skill"
  | "custom"
  | "mixed"

type ToolActivityTitleStatus = "completed" | "running" | "error" | "stopped"

const toolActivityTitleKeys = {
  connector: {
    completed: "chat.toolActivityConnectorCompleted",
    running: "chat.toolActivityConnectorRunning",
    error: "chat.toolActivityConnectorError",
    stopped: "chat.toolActivityConnectorStopped",
  },
  shell: {
    completed: "chat.toolActivityShellCompleted",
    running: "chat.toolActivityShellRunning",
    error: "chat.toolActivityShellError",
    stopped: "chat.toolActivityShellStopped",
  },
  file: {
    completed: "chat.toolActivityFileCompleted",
    running: "chat.toolActivityFileRunning",
    error: "chat.toolActivityFileError",
    stopped: "chat.toolActivityFileStopped",
  },
  fileRead: {
    completed: "chat.toolActivityFileReadCompleted",
    running: "chat.toolActivityFileReadRunning",
    error: "chat.toolActivityFileReadError",
    stopped: "chat.toolActivityFileReadStopped",
  },
  fileWrite: {
    completed: "chat.toolActivityFileWriteCompleted",
    running: "chat.toolActivityFileWriteRunning",
    error: "chat.toolActivityFileWriteError",
    stopped: "chat.toolActivityFileWriteStopped",
  },
  fileEdit: {
    completed: "chat.toolActivityFileEditCompleted",
    running: "chat.toolActivityFileEditRunning",
    error: "chat.toolActivityFileEditError",
    stopped: "chat.toolActivityFileEditStopped",
  },
  fileList: {
    completed: "chat.toolActivityFileListCompleted",
    running: "chat.toolActivityFileListRunning",
    error: "chat.toolActivityFileListError",
    stopped: "chat.toolActivityFileListStopped",
  },
  fileSearch: {
    completed: "chat.toolActivityFileSearchCompleted",
    running: "chat.toolActivityFileSearchRunning",
    error: "chat.toolActivityFileSearchError",
    stopped: "chat.toolActivityFileSearchStopped",
  },
  web: {
    completed: "chat.toolActivityWebCompleted",
    running: "chat.toolActivityWebRunning",
    error: "chat.toolActivityWebError",
    stopped: "chat.toolActivityWebStopped",
  },
  task: {
    completed: "chat.toolActivityTaskCompleted",
    running: "chat.toolActivityTaskRunning",
    error: "chat.toolActivityTaskError",
    stopped: "chat.toolActivityTaskStopped",
  },
  skill: {
    completed: "chat.toolActivitySkillCompleted",
    running: "chat.toolActivitySkillRunning",
    error: "chat.toolActivitySkillError",
    stopped: "chat.toolActivitySkillStopped",
  },
  custom: {
    completed: "chat.toolActivityCustomCompleted",
    running: "chat.toolActivityCustomRunning",
    error: "chat.toolActivityCustomError",
    stopped: "chat.toolActivityCustomStopped",
  },
  mixed: {
    completed: "chat.toolActivityMixedCompleted",
    running: "chat.toolActivityMixedRunning",
    error: "chat.toolActivityMixedError",
    stopped: "chat.toolActivityMixedStopped",
  },
} satisfies Record<ToolActivityTitleKind, Record<ToolActivityTitleStatus, MessageKey>>

export function toolActivityTitle(
  t: TranslateFn,
  parts: ChatMessagePart[],
  { hasActive, hasError, hasStopped, duration, category = summarizeToolCategory(parts) }: ToolActivityTitleState,
): string {
  const withDuration = (title: string) => (duration ? `${title} · ${duration}` : title)
  const status: ToolActivityTitleStatus = hasError
    ? "error"
    : hasActive
      ? "running"
      : hasStopped
        ? "stopped"
        : "completed"
  const kind = toolActivityTitleKind(parts, category)
  return withDuration(t(toolActivityTitleKeys[kind][status], { count: parts.length }))
}

export function classifyToolPart(part: ChatMessagePart): ToolCategory {
  switch (part.tool) {
    case "list_apps":
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

function toolActivityTitleKind(parts: ChatMessagePart[], category: ToolCategory): ToolActivityTitleKind {
  if (category !== "file") {
    return category
  }

  let tool: string | undefined
  for (const part of parts) {
    if (!part.tool) {
      return "file"
    }
    if (tool === undefined) {
      tool = part.tool
      continue
    }
    if (tool !== part.tool) {
      return "file"
    }
  }

  switch (tool) {
    case "read":
      return "fileRead"
    case "write":
      return "fileWrite"
    case "edit":
      return "fileEdit"
    case "list":
      return "fileList"
    case "grep":
    case "glob":
      return "fileSearch"
    default:
      return "file"
  }
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
  const end = part.timing?.end ?? (isActiveToolPart(part) ? now : undefined)
  if (typeof start !== "number" || typeof end !== "number" || end < start) {
    return null
  }
  return formatMs(end - start)
}

export function shouldShowRunningNoOutput(part: ChatMessagePart): boolean {
  return part.tool === "bash" && isActiveToolPart(part) && !part.output && !part.error
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
    const partEnd = part.timing?.end ?? (isActiveToolPart(part) ? now : undefined)
    if (typeof partStart !== "number" || typeof partEnd !== "number" || partEnd < partStart) {
      continue
    }
    start = start === undefined ? partStart : Math.min(start, partStart)
    end = end === undefined ? partEnd : Math.max(end, partEnd)
  }
  if (start === undefined || end === undefined) {
    return null
  }
  return formatWholeSecondDuration(end - start)
}

function formatMs(ms: number): string {
  return ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(ms < 10_000 ? 1 : 0)}s`
}

export function formatWholeSecondDuration(ms: number): string {
  const totalSeconds = Math.max(1, Math.round(ms / 1000))
  if (totalSeconds < 60) {
    return `${totalSeconds}s`
  }
  return `${Math.floor(totalSeconds / 60)}m ${totalSeconds % 60}s`
}
