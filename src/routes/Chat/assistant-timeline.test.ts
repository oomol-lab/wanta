import type { ChatMessage, ChatMessagePart } from "../../../electron/chat/common.ts"

import { describe, expect, it } from "vitest"
import { assistantTimelineBlocks, splitAssistantTimelineBlocks, textFromTimelineBlocks } from "./assistant-timeline.ts"

function message(id: string, parts: ChatMessagePart[]): ChatMessage {
  return { id, role: "assistant", parts, createdAt: 1 }
}

function textPart(partId: string, text: string): ChatMessagePart {
  return { kind: "text", partId, text }
}

function toolPart(partId: string): ChatMessagePart {
  return {
    kind: "tool",
    partId,
    callId: partId,
    tool: "bash",
    status: "completed",
    input: {},
  }
}

describe("assistantTimelineBlocks", () => {
  it("keeps tool and feedback text blocks in assistant message order", () => {
    const blocks = assistantTimelineBlocks([
      message("a1", [toolPart("tool-1"), textPart("text-1", "first feedback")]),
      message("a2", [toolPart("tool-2"), textPart("text-2", "second feedback")]),
    ])

    expect(
      blocks.map(({ message, block }) => ({
        messageId: message.id,
        kind: block.kind,
        partIds: block.kind === "tools" ? block.parts.map((part) => part.partId) : [block.part.partId],
      })),
    ).toEqual([
      { messageId: "a1", kind: "tools", partIds: ["tool-1"] },
      { messageId: "a1", kind: "text", partIds: ["text-1"] },
      { messageId: "a2", kind: "tools", partIds: ["tool-2"] },
      { messageId: "a2", kind: "text", partIds: ["text-2"] },
    ])
  })

  it("splits processing feedback before the last tool from final response after it", () => {
    const { processBlocks, responseBlocks } = splitAssistantTimelineBlocks([
      message("a1", [textPart("process-1", "I will inspect the page."), toolPart("tool-1")]),
      message("a2", [textPart("process-2", "The mobile page is blocked."), toolPart("tool-2")]),
      message("a3", [textPart("response-1", "The site blocks automated requests. Use a browser script instead.")]),
    ])

    expect(
      processBlocks.map(({ block }) => ({
        kind: block.kind,
        partIds: block.kind === "tools" ? block.parts.map((part) => part.partId) : [block.part.partId],
      })),
    ).toEqual([
      { kind: "text", partIds: ["process-1"] },
      { kind: "tools", partIds: ["tool-1"] },
      { kind: "text", partIds: ["process-2"] },
      { kind: "tools", partIds: ["tool-2"] },
    ])
    expect(responseBlocks.map(({ block }) => (block.kind === "text" ? block.part.partId : block.kind))).toEqual([
      "response-1",
    ])
    expect(textFromTimelineBlocks(responseBlocks)).toBe(
      "The site blocks automated requests. Use a browser script instead.",
    )
  })

  it("joins multiple response text blocks with blank lines", () => {
    const blocks = assistantTimelineBlocks([
      message("a1", [textPart("text-1", "First line")]),
      message("a2", [textPart("text-2", "Second line")]),
      message("a3", [textPart("text-3", "Third line")]),
    ])

    expect(textFromTimelineBlocks(blocks)).toBe("First line\n\nSecond line\n\nThird line")
  })

  it("ignores empty response text blocks", () => {
    const blocks = assistantTimelineBlocks([
      message("a1", [textPart("text-1", "First line")]),
      message("a2", [textPart("text-2", "")]),
      message("a3", [textPart("text-3", "Third line")]),
    ])

    expect(textFromTimelineBlocks(blocks)).toBe("First line\n\nThird line")
  })

  it("treats a text-only assistant message as final response", () => {
    const { processBlocks, responseBlocks } = splitAssistantTimelineBlocks([
      message("a1", [textPart("response-1", "Done.")]),
    ])

    expect(processBlocks).toEqual([])
    expect(responseBlocks.map(({ block }) => (block.kind === "text" ? block.part.partId : block.kind))).toEqual([
      "response-1",
    ])
  })
})
