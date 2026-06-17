import type { ChatMessage } from "../../../electron/chat/common.ts"
import type { RenderBlock } from "./render-blocks.ts"

import { renderBlocks } from "./render-blocks.ts"

export interface AssistantTimelineBlock {
  message: ChatMessage
  block: RenderBlock
}

export interface AssistantTimelineSplit {
  processBlocks: AssistantTimelineBlock[]
  responseBlocks: AssistantTimelineBlock[]
}

export function assistantTimelineBlocks(messages: ChatMessage[]): AssistantTimelineBlock[] {
  return messages.flatMap((message) => renderBlocks(message.parts).map((block) => ({ message, block })))
}

export function splitAssistantTimelineBlocks(messages: ChatMessage[]): AssistantTimelineSplit {
  const blocks = assistantTimelineBlocks(messages)
  const lastToolIndex = blocks.findLastIndex(({ block }) => block.kind === "tools")
  if (lastToolIndex === -1) {
    return { processBlocks: [], responseBlocks: blocks }
  }
  return {
    processBlocks: blocks.slice(0, lastToolIndex + 1),
    responseBlocks: blocks.slice(lastToolIndex + 1),
  }
}

export function textFromTimelineBlocks(blocks: AssistantTimelineBlock[]): string {
  return blocks
    .filter(({ block }) => block.kind === "text")
    .map(({ block }) => (block.kind === "text" ? (block.part.text ?? "") : ""))
    .filter(Boolean)
    .join("\n\n")
    .trim()
}
