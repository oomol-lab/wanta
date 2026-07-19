import type { AuthorizationInfo, ChatMessagePart } from "../../../electron/chat/common.ts"
import type { TranslateFn } from "@/i18n/i18n"

import { parseAuthorizationSignal } from "../../../electron/chat/authorization-signal.ts"
import { compactPathDetail, compactToolDetail } from "./tool-activity.ts"

export type ToolDisplayDetailKind = "code" | "text"

export interface ToolDisplayLine {
  title: string
  detail?: string
  detailKind?: ToolDisplayDetailKind
}

function str(value: unknown): string {
  return typeof value === "string" ? value : ""
}

export function parseToolAuthorization(part: ChatMessagePart): AuthorizationInfo | null {
  if (part.authorization) {
    return part.authorization
  }
  if (part.status !== "completed") {
    return null
  }
  if (part.tool === "call_action") {
    return parseAuthorizationSignal(part.output)
  }
  return null
}

export function normalizeServiceSlug(value: string): string {
  return value.trim().toLowerCase().replace(/^oo-/, "")
}

function parseServiceFromCommand(command: string): string {
  const serviceArg = String.raw`(?:"([^"]+)"|'([^']+)'|([A-Za-z0-9_-]+))`
  const connectorMatch = command.match(
    new RegExp(String.raw`(?:^|\s)(?:oo\s+)?connector\s+(?:schema|run)\s+` + serviceArg),
  )
  if (connectorMatch) {
    // 1.3.0 `oo connector schema` 用点号 id `<service>.<action>`；只取首个点之前的 service 段。
    const raw = connectorMatch[1] ?? connectorMatch[2] ?? connectorMatch[3] ?? ""
    const dot = raw.indexOf(".")
    return dot > 0 ? raw.slice(0, dot) : raw
  }
  const providerFlagMatch = command.match(new RegExp(String.raw`(?:--provider|--service)\s+` + serviceArg))
  return providerFlagMatch ? (providerFlagMatch[1] ?? providerFlagMatch[2] ?? providerFlagMatch[3] ?? "") : ""
}

export function toolServiceSlug(part: ChatMessagePart): string {
  const input = part.input ?? {}
  const fromInput = str(input.service)
  if (fromInput) {
    return normalizeServiceSlug(fromInput)
  }
  const auth = parseToolAuthorization(part)
  if (auth?.service) {
    return normalizeServiceSlug(auth.service)
  }
  const skillTitle = part.title?.match(/^Loaded skill:\s*([A-Za-z0-9_-]+)/i)
  if (skillTitle?.[1]) {
    return normalizeServiceSlug(skillTitle[1])
  }
  const command = str(input.command)
  if (command) {
    const fromCommand = parseServiceFromCommand(command)
    if (fromCommand) {
      return normalizeServiceSlug(fromCommand)
    }
  }
  return ""
}

function bashActionSummary(t: TranslateFn, command: string): string {
  const normalized = command.replace(/\s+/g, " ").trim()
  if (/^(ls|stat|file|du)\b/.test(normalized)) {
    return t("chat.toolBashCheckFile")
  }
  if (/(^|[;&|]\s*)(which|command -v)\b|--version\b/.test(normalized)) {
    return t("chat.toolBashCheckTools")
  }
  if (/^(sips|magick|convert|qlmanage)\b/.test(normalized)) {
    return t("chat.toolBashConvertImage")
  }
  if (/^python3?\s+-c\s+["']import\b/.test(normalized)) {
    return t("chat.toolBashCheckPythonModule")
  }
  if (/\bpip3?\s+install\b/.test(normalized)) {
    return t("chat.toolBashInstallPythonPackage")
  }
  if (/^python3?\s+<<\s*['"]?EOF\b/.test(normalized) || /^python3?\s+\S+\.py\b/.test(normalized)) {
    return t("chat.toolBashRunPythonScript")
  }
  if (/^(cat|sed|head|tail)\b/.test(normalized)) {
    return t("chat.toolBashReadContent")
  }
  if (/^find\b/.test(normalized)) {
    return t("chat.toolBashFindFiles")
  }
  return t("chat.toolRunGeneric")
}

function connectorTarget(input: Record<string, unknown>): string {
  const service = str(input.service)
  const action = str(input.action)
  if (service || action) {
    return service && action ? `${service} · ${action}` : service || action
  }
  // inspect_action 现按点号 id 数组批量取契约（input 为 { actions: [...] }）。
  const actions = input.actions
  if (Array.isArray(actions) && actions.length > 0) {
    return actions.map((id) => String(id)).join(", ")
  }
  return ""
}

function pathInput(input: Record<string, unknown>): string {
  return str(input.filePath) || str(input.path)
}

function questionDetail(input: Record<string, unknown>): string {
  const questions = input.questions
  if (!Array.isArray(questions)) {
    return ""
  }
  const first = questions[0] as { header?: unknown; question?: unknown } | undefined
  return str(first?.header) || str(first?.question)
}

function knowledgeOperation(input: Record<string, unknown>): string {
  return str(input.operation)
}

function knowledgeOperationTitle(t: TranslateFn, input: Record<string, unknown>): string {
  switch (knowledgeOperation(input)) {
    case "inspect":
      return t("chat.toolKnowledgeInspectGeneric")
    case "related":
      return t("chat.toolKnowledgeRelatedGeneric")
    case "evidence":
      return t("chat.toolKnowledgeEvidenceGeneric")
    case "pack":
      return t("chat.toolKnowledgePackGeneric")
    case "search":
    default:
      return t("chat.toolKnowledgeSearchGeneric")
  }
}

function knowledgeOperationSummary(t: TranslateFn, input: Record<string, unknown>): string {
  const query = str(input.query)
  const detail = query ? compactToolDetail(query) : ""
  switch (knowledgeOperation(input)) {
    case "inspect":
      return t("chat.toolKnowledgeInspectGeneric")
    case "related":
      return detail ? t("chat.toolKnowledgeRelated", { detail }) : t("chat.toolKnowledgeRelatedGeneric")
    case "evidence":
      return detail ? t("chat.toolKnowledgeEvidence", { detail }) : t("chat.toolKnowledgeEvidenceGeneric")
    case "pack":
      return t("chat.toolKnowledgePackGeneric")
    case "search":
    default:
      return detail ? t("chat.toolKnowledgeSearch", { detail }) : t("chat.toolKnowledgeSearchGeneric")
  }
}

export function toolDisplayLine(t: TranslateFn, part: ChatMessagePart): ToolDisplayLine {
  const input = part.input ?? {}
  const fallbackDetail = part.title || part.tool || "tool"
  switch (part.tool) {
    case "list_apps": {
      const service = str(input.service)
      return {
        title: t("chat.toolListAppsGeneric"),
        ...(service ? { detail: compactToolDetail(service), detailKind: "text" } : {}),
      }
    }
    case "search_actions": {
      const query = str(input.query)
      return {
        title: t("chat.toolSearchGeneric"),
        ...(query ? { detail: compactToolDetail(query), detailKind: "text" } : {}),
      }
    }
    case "inspect_action": {
      const target = connectorTarget(input)
      return {
        title: t("chat.toolInspectGeneric"),
        ...(target ? { detail: target, detailKind: "text" } : {}),
      }
    }
    case "call_action": {
      const target = connectorTarget(input)
      return {
        title: t("chat.toolCallGeneric"),
        ...(target ? { detail: target, detailKind: "text" } : {}),
      }
    }
    case "query_knowledge": {
      const query = str(input.query)
      return {
        title: knowledgeOperationTitle(t, input),
        ...(query ? { detail: compactToolDetail(query), detailKind: "text" } : {}),
      }
    }
    case "bash": {
      const command = str(input.command).split("\n")[0]
      return {
        title: command ? bashActionSummary(t, command) : t("chat.toolRunGeneric"),
        ...(command ? { detail: compactToolDetail(command, 96), detailKind: "code" } : {}),
      }
    }
    case "read": {
      const filePath = pathInput(input)
      return {
        title: t("chat.toolReadGeneric"),
        ...(filePath ? { detail: compactPathDetail(filePath), detailKind: "text" } : {}),
      }
    }
    case "write": {
      const filePath = pathInput(input)
      return {
        title: t("chat.toolWriteGeneric"),
        ...(filePath ? { detail: compactPathDetail(filePath), detailKind: "text" } : {}),
      }
    }
    case "edit": {
      const filePath = pathInput(input)
      return {
        title: t("chat.toolEditGeneric"),
        ...(filePath ? { detail: compactPathDetail(filePath), detailKind: "text" } : {}),
      }
    }
    case "list": {
      const filePath = str(input.path) || str(input.filePath)
      return {
        title: t("chat.toolListGeneric"),
        ...(filePath ? { detail: compactPathDetail(filePath), detailKind: "text" } : {}),
      }
    }
    case "grep": {
      const pattern = str(input.pattern)
      return {
        title: t("chat.toolGrepGeneric"),
        ...(pattern ? { detail: compactToolDetail(pattern), detailKind: "text" } : {}),
      }
    }
    case "glob": {
      const pattern = str(input.pattern)
      return {
        title: t("chat.toolGlobGeneric"),
        ...(pattern ? { detail: compactToolDetail(pattern), detailKind: "text" } : {}),
      }
    }
    case "webfetch": {
      const url = str(input.url)
      return {
        title: t("chat.toolWebFetchGeneric"),
        ...(url ? { detail: compactPathDetail(url), detailKind: "text" } : {}),
      }
    }
    case "task":
      return {
        title: t("chat.toolTaskGeneric"),
        detail: compactToolDetail(fallbackDetail),
        detailKind: "text",
      }
    case "question": {
      const detail = questionDetail(input)
      return {
        title: t("chat.toolQuestionGeneric"),
        ...(detail ? { detail: compactToolDetail(detail), detailKind: "text" } : {}),
      }
    }
    default:
      return {
        title: t("chat.toolGenericGeneric"),
        detail: compactToolDetail(fallbackDetail),
        detailKind: "text",
      }
  }
}

/** 工具调用的一行人话动作摘要；原始命令只放在详情里。 */
export function toolActionSummary(t: TranslateFn, part: ChatMessagePart): string {
  const input = part.input ?? {}
  const target = connectorTarget(input)
  const fallbackDetail = part.title || part.tool || "tool"
  switch (part.tool) {
    case "list_apps": {
      const service = str(input.service)
      return service ? t("chat.toolListApps", { detail: compactToolDetail(service) }) : t("chat.toolListAppsGeneric")
    }
    case "search_actions": {
      const query = str(input.query)
      return query ? t("chat.toolSearch", { detail: compactToolDetail(query) }) : t("chat.toolSearchGeneric")
    }
    case "inspect_action":
      return target ? t("chat.toolInspect", { detail: target }) : t("chat.toolInspectGeneric")
    case "call_action":
      return target ? t("chat.toolCall", { detail: target }) : t("chat.toolCallGeneric")
    case "query_knowledge":
      return knowledgeOperationSummary(t, input)
    case "bash": {
      const command = str(input.command).split("\n")[0]
      return command ? bashActionSummary(t, command) : t("chat.toolRunGeneric")
    }
    case "read": {
      const filePath = str(input.filePath) || str(input.path)
      return filePath ? t("chat.toolRead", { detail: compactPathDetail(filePath) }) : t("chat.toolReadGeneric")
    }
    case "write": {
      const filePath = str(input.filePath) || str(input.path)
      return filePath ? t("chat.toolWrite", { detail: compactPathDetail(filePath) }) : t("chat.toolWriteGeneric")
    }
    case "edit": {
      const filePath = str(input.filePath) || str(input.path)
      return filePath ? t("chat.toolEdit", { detail: compactPathDetail(filePath) }) : t("chat.toolEditGeneric")
    }
    case "list": {
      const filePath = str(input.path) || str(input.filePath)
      return filePath ? t("chat.toolList", { detail: compactPathDetail(filePath) }) : t("chat.toolListGeneric")
    }
    case "grep": {
      const pattern = str(input.pattern)
      return pattern ? t("chat.toolGrep", { detail: compactToolDetail(pattern) }) : t("chat.toolGrepGeneric")
    }
    case "glob": {
      const pattern = str(input.pattern)
      return pattern ? t("chat.toolGlob", { detail: compactToolDetail(pattern) }) : t("chat.toolGlobGeneric")
    }
    case "webfetch": {
      const url = str(input.url)
      return url ? t("chat.toolWebFetch", { detail: compactPathDetail(url) }) : t("chat.toolWebFetchGeneric")
    }
    case "task": {
      return t("chat.toolTask", { detail: compactToolDetail(fallbackDetail) })
    }
    case "question": {
      const detail = questionDetail(input)
      return detail ? t("chat.toolQuestion", { detail: compactToolDetail(detail) }) : t("chat.toolQuestionGeneric")
    }
    default:
      return t("chat.toolGeneric", { detail: compactToolDetail(fallbackDetail) })
  }
}
