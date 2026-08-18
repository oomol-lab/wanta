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

function messageToolParts(message: ChatMessage): ChatMessagePart[] {
  return message.parts.filter((part) => part.kind === "tool")
}

function textBelongsToProcess(
  message: ChatMessage,
  part: ChatMessagePart,
  activeAssistantMessageId: string | undefined,
): boolean {
  const text = part.text?.trim() ?? ""
  if (!text) {
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
  // Keep all still-active narration in the process disclosure until the
  // adapter supplies a terminal finish reason. This is deliberately based on
  // turn lifecycle rather than prose length or Markdown shape: a detailed
  // progress report is still progress while the agent continues using tools.
  if (message.id === activeAssistantMessageId) {
    return true
  }
  return isToolCallFinishReason(message.finishReason)
}

function blockSegmentKind(
  item: AssistantTimelineBlock,
  activeAssistantMessageId: string | undefined,
): AssistantTimelineSegmentKind {
  switch (item.block.kind) {
    case "tools":
      return "process"
    case "text":
      return textBelongsToProcess(item.message, item.block.part, activeAssistantMessageId) ? "process" : "response"
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
  const classified = blocks.map((item) => ({ item, kind: blockSegmentKind(item, options.activeAssistantMessageId) }))
  const hasIncompleteTool = classified.some(
    ({ item, kind }) =>
      kind === "process" && item.block.kind === "tools" && item.block.parts.some((part) => part.status !== "completed"),
  )

  // Some adapters can finish a turn immediately after a tool-use step without
  // emitting a separate stop message. Once the turn is settled, preserve the
  // last narrated result as the visible outcome instead of leaving the user
  // with process activity only.
  if (
    options.activeAssistantMessageId === undefined &&
    !hasIncompleteTool &&
    !classified.some(
      ({ item, kind }) => kind === "response" && (item.block.kind === "text" || item.block.kind === "attachment"),
    )
  ) {
    const fallbackIndex = classified.findLastIndex(
      ({ item, kind }) => kind === "process" && item.block.kind === "text" && Boolean(item.block.part.text?.trim()),
    )
    if (fallbackIndex >= 0 && classified[fallbackIndex]) {
      classified[fallbackIndex].kind = "response"
    }
  }

  // Render one stable process disclosure per user turn. Agent loops commonly
  // alternate narration and tools several times; mirroring those alternations
  // as separate disclosures makes settled content appear to be regenerated.
  // Bucketing retains the order inside each lane without constraining the
  // agent's native loop or rewriting its transcript.
  const processBlocks = classified.filter(({ kind }) => kind === "process").map(({ item }) => item)
  const responseBlocks = classified.filter(({ kind }) => kind === "response").map(({ item }) => item)
  const segments: AssistantTimelineSegment[] = []
  if (processBlocks.length > 0) {
    const first = processBlocks[0]
    segments.push({ kind: "process", key: first ? blockKey(first) : "process", blocks: processBlocks })
  }
  if (responseBlocks.length > 0) {
    const first = responseBlocks[0]
    segments.push({ kind: "response", key: first ? blockKey(first) : "response", blocks: responseBlocks })
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
