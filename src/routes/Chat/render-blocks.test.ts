import type { ChatMessagePart } from "../../../electron/chat/common.ts"

import { describe, expect, it } from "vitest"
import { renderBlocks } from "./render-blocks.ts"

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

describe("renderBlocks", () => {
  it("ignores whitespace-only text parts so adjacent tools stay grouped", () => {
    const firstTool = toolPart("tool-1")
    const secondTool = toolPart("tool-2")

    const blocks = renderBlocks([textPart("space-1", "\n  "), firstTool, textPart("space-2", " \n\t"), secondTool])

    expect(blocks).toEqual([{ kind: "tools", key: "tool-1:tool-2", parts: [firstTool, secondTool] }])
  })

  it("keeps visible text as separators between tool groups", () => {
    const firstTool = toolPart("tool-1")
    const visibleText = textPart("text-1", "下一步")
    const secondTool = toolPart("tool-2")

    const blocks = renderBlocks([firstTool, visibleText, secondTool])

    expect(blocks).toEqual([
      { kind: "tools", key: "tool-1", parts: [firstTool] },
      { kind: "text", part: visibleText },
      { kind: "tools", key: "tool-2", parts: [secondTool] },
    ])
  })
})
