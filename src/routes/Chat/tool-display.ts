import type { AuthorizationInfo, ChatMessagePart } from "../../../electron/chat/common.ts"
import type { TranslateFn } from "@/i18n/i18n"

import { compactPathDetail, compactToolDetail } from "./tool-activity.ts"

function parseAuthorization(output: string | undefined): AuthorizationInfo | null {
  if (!output) {
    return null
  }
  try {
    const parsed = JSON.parse(output) as Record<string, unknown>
    if (
      parsed.status === "authorization_required" &&
      typeof parsed.service === "string" &&
      typeof parsed.authUrl === "string"
    ) {
      return {
        service: parsed.service,
        displayName: typeof parsed.displayName === "string" ? parsed.displayName : parsed.service,
        authUrl: parsed.authUrl,
        message: typeof parsed.message === "string" ? parsed.message : undefined,
      }
    }
  } catch {
    return null
  }
  return null
}

function str(value: unknown): string {
  return typeof value === "string" ? value : ""
}

export function parseToolAuthorization(part: ChatMessagePart): AuthorizationInfo | null {
  return part.tool === "call_action" && part.status === "completed" ? parseAuthorization(part.output) : null
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
    return connectorMatch[1] ?? connectorMatch[2] ?? connectorMatch[3] ?? ""
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

/** 工具调用的一行人话动作摘要；原始命令只放在详情里。 */
export function toolActionSummary(t: TranslateFn, part: ChatMessagePart): string {
  const input = part.input ?? {}
  const service = str(input.service)
  const action = str(input.action)
  const target = service && action ? `${service} · ${action}` : service || action
  const fallbackDetail = part.title || part.tool || "tool"
  switch (part.tool) {
    case "search_actions": {
      const query = str(input.query)
      return query ? t("chat.toolSearch", { detail: compactToolDetail(query) }) : t("chat.toolSearchGeneric")
    }
    case "inspect_action":
      return target ? t("chat.toolInspect", { detail: target }) : t("chat.toolInspectGeneric")
    case "call_action":
      return target ? t("chat.toolCall", { detail: target }) : t("chat.toolCallGeneric")
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
    default:
      return t("chat.toolGeneric", { detail: compactToolDetail(fallbackDetail) })
  }
}

export function toolInputString(value: unknown): string {
  return str(value)
}
