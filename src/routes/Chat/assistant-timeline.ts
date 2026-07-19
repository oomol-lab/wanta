import type { ChatMessage, ChatMessagePart } from "../../../electron/chat/common.ts"
import type { RenderBlock } from "./render-blocks.ts"

import { renderBlocks } from "./render-blocks.ts"

export interface AssistantTimelineBlock {
  message: ChatMessage
  block: RenderBlock
}

export type AssistantTimelineSegmentKind = "process" | "response"

export interface AssistantTimelineSegment {
  kind: AssistantTimelineSegmentKind
  key: string
  blocks: AssistantTimelineBlock[]
}

const progressTextMaxLength = 240

export function assistantTimelineBlocks(messages: ChatMessage[]): AssistantTimelineBlock[] {
  return messages.flatMap((message) => renderBlocks(message.parts).map((block) => ({ message, block })))
}

function isToolCallFinishReason(reason: string | undefined): boolean {
  return reason === "tool-calls" || reason === "tool_calls" || reason === "tool-use" || reason === "tool_use"
}

function hasStructuredResponseText(text: string): boolean {
  return (
    /(^|\n)\s{0,3}(?:#{1,6}\s|[-*+]\s|\d+[.)]\s|>\s|```|~~~)/u.test(text) ||
    /(^|\n)\s*\|[^\n]+\|\s*(?:\n|$)/u.test(text) ||
    /!\[[^\]]*\]\(|\[[^\]]+\]\([^\s)]+/u.test(text)
  )
}

function messageToolParts(message: ChatMessage): ChatMessagePart[] {
  return message.parts.filter((part) => part.kind === "tool")
}

function textBelongsToProcess(message: ChatMessage, part: ChatMessagePart): boolean {
  const text = part.text?.trim() ?? ""
  if (!text || text.length > progressTextMaxLength || hasStructuredResponseText(text)) {
    return false
  }

  if (message.finishReason && !isToolCallFinishReason(message.finishReason)) {
    // stop 等终止原因表示这条消息已经直接回应用户，即使同一消息里也有工具记录。
    return false
  }

  const tools = messageToolParts(message)
  if (tools.some((tool) => tool.tool === "question")) {
    // 问题前的说明是用户做决定所需的上下文，不能随工具详情一起隐藏。
    return false
  }
  if (tools.length > 0) {
    return true
  }
  return isToolCallFinishReason(message.finishReason)
}

function blockSegmentKind(item: AssistantTimelineBlock): AssistantTimelineSegmentKind {
  switch (item.block.kind) {
    case "tools":
      return "process"
    case "text":
      return textBelongsToProcess(item.message, item.block.part) ? "process" : "response"
    case "status":
      return item.block.part.statusType === "connectionFailed" || item.block.part.statusType === "runtimeFailed"
        ? "response"
        : "process"
    case "attachment":
    case "error":
      return "response"
  }
}

function blockKey(item: AssistantTimelineBlock): string {
  return `${item.message.id}:${item.block.kind === "tools" ? item.block.key : item.block.part.partId}`
}

export function segmentAssistantTimeline(messages: ChatMessage[]): AssistantTimelineSegment[] {
  const segments: AssistantTimelineSegment[] = []
  for (const item of assistantTimelineBlocks(messages)) {
    const kind = blockSegmentKind(item)
    const current = segments.at(-1)
    if (current?.kind === kind) {
      current.blocks.push(item)
      continue
    }
    segments.push({ kind, key: blockKey(item), blocks: [item] })
  }
  return segments
}

export function assistantMessagesFromTimelineBlocks(blocks: AssistantTimelineBlock[]): ChatMessage[] {
  const selectedParts = new Map<string, ChatMessagePart[]>()
  const messages = new Map<string, ChatMessage>()
  for (const { message, block } of blocks) {
    messages.set(message.id, message)
    const parts = selectedParts.get(message.id) ?? []
    if (block.kind === "tools") {
      parts.push(...block.parts)
    } else {
      parts.push(block.part)
    }
    selectedParts.set(message.id, parts)
  }
  return [...messages.values()].map((message) => ({ ...message, parts: selectedParts.get(message.id) ?? [] }))
}

export function timelineHasVisibleOutcome(segments: AssistantTimelineSegment[]): boolean {
  return segments.some(
    (segment) =>
      segment.kind === "response" &&
      segment.blocks.some(({ block }) => block.kind === "text" || block.kind === "attachment"),
  )
}

export function textFromTimelineBlocks(blocks: AssistantTimelineBlock[]): string {
  return blocks
    .filter(({ block }) => block.kind === "text")
    .map(({ block }) => (block.kind === "text" ? (block.part.text ?? "") : ""))
    .filter(Boolean)
    .join("\n\n")
    .trim()
}
