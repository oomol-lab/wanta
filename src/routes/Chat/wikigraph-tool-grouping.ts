import type { ChatMessagePart, ToolStatus } from "../../../electron/chat/common.ts"

import { isWikigraphKnowledgeActivityPart } from "./tool-display.ts"
import { isToolCancellation } from "./tool-state.ts"

function str(value: unknown): string {
  return typeof value === "string" ? value : ""
}

function shellWordPattern(word: string): string {
  const escaped = word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
  return String.raw`(?:${escaped}|['"]${escaped}['"])`
}

function isWikigraphProbeCommand(command: string): boolean {
  const normalized = command.replace(/\s+/g, " ").trim()
  if (!normalized) {
    return false
  }
  const executable = String.raw`(?:wg|wikigraph|(?:\S+/)(?:wg|wikigraph))`
  const probeArg = String.raw`(?:--help|-h|help|--version|version)`
  const optionalRedirect = String.raw`(?:\s+\d*>[&]?\d+|\s+[<>]{1,2}\S+)*`
  const directProbe = new RegExp(String.raw`^${executable}\s+${probeArg}${optionalRedirect}$`, "iu")
  const envProbe = new RegExp(
    String.raw`^env(?:\s+-\S+|\s+\w+=\S+)*\s+${executable}\s+${probeArg}${optionalRedirect}$`,
    "iu",
  )
  const shellProbe = new RegExp(
    String.raw`^(?:bash|sh|zsh)\s+(?:-[A-Za-z]*c[A-Za-z]*\s+)${shellWordPattern(`wg --help`)}${optionalRedirect}$`,
    "iu",
  )
  return directProbe.test(normalized) || envProbe.test(normalized) || shellProbe.test(normalized)
}

function isWikigraphKnowledgeAuxiliaryPart(part: ChatMessagePart): boolean {
  return part.tool === "bash" && isWikigraphProbeCommand(str(part.input?.command))
}

function mergedStatus(parts: ChatMessagePart[]): ToolStatus | undefined {
  if (parts.some((part) => part.status === "error")) {
    return "error"
  }
  if (parts.some((part) => part.status === "running")) {
    return "running"
  }
  if (parts.some((part) => part.status === "pending")) {
    return "pending"
  }
  if (parts.some((part) => part.status === "completed")) {
    return "completed"
  }
  return parts[0]?.status
}

function mergedTiming(parts: ChatMessagePart[]): ChatMessagePart["timing"] {
  let start: number | undefined
  let end: number | undefined
  for (const part of parts) {
    if (typeof part.timing?.start === "number") {
      start = start === undefined ? part.timing.start : Math.min(start, part.timing.start)
    }
    if (typeof part.timing?.end === "number") {
      end = end === undefined ? part.timing.end : Math.max(end, part.timing.end)
    }
  }
  return start === undefined && end === undefined ? undefined : { start, end }
}

function mergeWikigraphKnowledgeParts(parts: ChatMessagePart[]): ChatMessagePart {
  const first = parts[0]
  const errorPart = parts.find((part) => part.status === "error" || part.error)
  return {
    ...first,
    partId: first.partId,
    callId: first.callId ?? first.partId,
    title: "Loaded skill: wikigraph-knowledge",
    status: mergedStatus(parts),
    error: errorPart?.error,
    output: undefined,
    input: {},
    metadata: undefined,
    attachmentsCount: undefined,
    authorization: undefined,
    cancelled: parts.some((part) => isToolCancellation(part)) || undefined,
    timing: mergedTiming(parts),
  }
}

export function groupedToolActivityParts(parts: ChatMessagePart[]): ChatMessagePart[] {
  const grouped: ChatMessagePart[] = []
  let pendingKnowledge: ChatMessagePart[] = []
  const hasLaterKnowledgeActivity = (startIndex: number) => {
    for (let index = startIndex; index < parts.length; index += 1) {
      const candidate = parts[index]
      if (!candidate) {
        continue
      }
      if (isWikigraphKnowledgeActivityPart(candidate)) {
        return true
      }
      if (!isWikigraphKnowledgeAuxiliaryPart(candidate)) {
        return false
      }
    }
    return false
  }
  const flushKnowledge = () => {
    if (pendingKnowledge.length === 0) {
      return
    }
    grouped.push(mergeWikigraphKnowledgeParts(pendingKnowledge))
    pendingKnowledge = []
  }

  for (let index = 0; index < parts.length; index += 1) {
    const part = parts[index]
    if (!part) {
      continue
    }
    if (isWikigraphKnowledgeActivityPart(part)) {
      pendingKnowledge.push(part)
      continue
    }
    if (
      isWikigraphKnowledgeAuxiliaryPart(part) &&
      (pendingKnowledge.length > 0 || hasLaterKnowledgeActivity(index + 1))
    ) {
      pendingKnowledge.push(part)
      continue
    }
    flushKnowledge()
    grouped.push(part)
  }
  flushKnowledge()
  return grouped
}
