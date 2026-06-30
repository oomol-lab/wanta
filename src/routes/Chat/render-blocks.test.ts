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

function errorPart(partId: string, errorText: string): ChatMessagePart {
  return { kind: "error", partId, errorText }
}

function reasoningPart(partId: string, text: string): ChatMessagePart {
  return { kind: "reasoning", partId, text }
}

function attachmentPart(partId: string): ChatMessagePart {
  return {
    kind: "attachment",
    partId,
    attachment: {
      id: partId,
      name: "report.pdf",
      mime: "application/pdf",
      size: 12,
      path: "/tmp/report.pdf",
      kind: "file",
    },
  }
}

describe("renderBlocks", () => {
  it("ignores whitespace-only text parts so adjacent tools stay grouped", () => {
    const firstTool = toolPart("tool-1")
    const secondTool = toolPart("tool-2")

    const blocks = renderBlocks([textPart("space-1", "\n  "), firstTool, textPart("space-2", " \n\t"), secondTool])

    expect(blocks).toEqual([{ kind: "tools", key: "tool-1", parts: [firstTool, secondTool] }])
  })

  it("keeps a tool group key stable when another adjacent tool is appended", () => {
    const firstTool = toolPart("tool-1")
    const firstBlocks = renderBlocks([firstTool])
    const secondBlocks = renderBlocks([firstTool, toolPart("tool-2")])

    expect(firstBlocks[0]).toMatchObject({ kind: "tools", key: "tool-1" })
    expect(secondBlocks[0]).toMatchObject({ kind: "tools", key: "tool-1" })
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

  it("keeps error notices as standalone separators", () => {
    const firstTool = toolPart("tool-1")
    const error = errorPart("error-1", "Payment Required")
    const secondTool = toolPart("tool-2")

    const blocks = renderBlocks([firstTool, error, secondTool])

    expect(blocks).toEqual([
      { kind: "tools", key: "tool-1", parts: [firstTool] },
      { kind: "error", part: error },
      { kind: "tools", key: "tool-2", parts: [secondTool] },
    ])
  })

  it("keeps reasoning out of the default message blocks", () => {
    const reasoning = reasoningPart("reasoning-1", "Check the current state")
    const answer = textPart("text-1", "Done")

    const blocks = renderBlocks([reasoning, answer])

    expect(blocks).toEqual([{ kind: "text", part: answer }])
  })

  it("renders assistant attachments as standalone blocks", () => {
    const attachment = attachmentPart("attachment-1")
    const answer = textPart("text-1", "Done")

    const blocks = renderBlocks([attachment, answer])

    expect(blocks).toEqual([
      { kind: "attachment", part: attachment },
      { kind: "text", part: answer },
    ])
  })
})
