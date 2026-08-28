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

const codexSkillBudgetWarningPrefix = "Warning: Skill descriptions were shortened to fit the skills context budget."

function isSuppressedAgentRuntimeNotice(block: RenderBlock): boolean {
  return block.kind === "text" && (block.part.text ?? "").trimStart().startsWith(codexSkillBudgetWarningPrefix)
}

export function assistantTimelineBlocks(messages: ChatMessage[]): AssistantTimelineBlock[] {
  return messages.flatMap((message) =>
    renderBlocks(message.parts)
      .filter((block) => !isSuppressedAgentRuntimeNotice(block))
      .map((block) => ({ message, block })),
  )
}

function isToolCallFinishReason(reason: string | undefined): boolean {
  return reason === "tool-calls" || reason === "tool_calls" || reason === "tool-use" || reason === "tool_use"
}

function blockSegmentKind(
  item: AssistantTimelineBlock,
  phase: AssistantTimelineSegmentKind,
): AssistantTimelineSegmentKind {
  switch (item.block.kind) {
    case "tools":
      return "process"
    case "text":
      // A non-tool finish reason is explicit final-response evidence. Without
      // it, narration follows the current turn phase: text seen before the
      // first tool stays put, while text between tools remains in processing.
      return item.message.finishReason && !isToolCallFinishReason(item.message.finishReason) ? "response" : phase
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

export function segmentAssistantTimeline(
  messages: ChatMessage[],
  options: { activeAssistantMessageId?: string } = {},
): AssistantTimelineSegment[] {
  const blocks = assistantTimelineBlocks(messages)
  const segments: AssistantTimelineSegment[] = []
  let phase: AssistantTimelineSegmentKind = "response"
  for (const item of blocks) {
    const kind = blockSegmentKind(item, phase)
    if (item.block.kind === "tools" || (item.block.kind === "status" && kind === "process")) {
      phase = "process"
    } else if (item.block.kind === "text" && kind === "response" && item.message.finishReason) {
      phase = "response"
    }
    const current = segments.at(-1)
    if (current?.kind === kind) {
      current.blocks.push(item)
    } else {
      segments.push({ kind, key: blockKey(item), blocks: [item] })
    }
  }
  const lastSegment = segments.at(-1)
  if (options.activeAssistantMessageId === undefined && lastSegment?.kind === "process") {
    const trailingText: AssistantTimelineBlock[] = []
    while (lastSegment.blocks.at(-1)?.block.kind === "text") {
      const item = lastSegment.blocks.pop()
      if (item) trailingText.unshift(item)
    }
    if (trailingText.length > 0) {
      const first = trailingText[0]
      segments.push({ kind: "response", key: first ? blockKey(first) : "response", blocks: trailingText })
    }
    if (lastSegment.blocks.length === 0) {
      segments.splice(-2, 1)
    }
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
