import type { ChatMessagePart, ToolStatus } from "../../../electron/chat/common.ts"

import { isWikigraphKnowledgeActivityPart } from "./tool-display.ts"
import { isToolCancellation } from "./tool-state.ts"

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
  const flushKnowledge = () => {
    if (pendingKnowledge.length === 0) {
      return
    }
    grouped.push(mergeWikigraphKnowledgeParts(pendingKnowledge))
    pendingKnowledge = []
  }

  for (const part of parts) {
    if (isWikigraphKnowledgeActivityPart(part)) {
      pendingKnowledge.push(part)
      continue
    }
    flushKnowledge()
    grouped.push(part)
  }
  flushKnowledge()
  return grouped
}
