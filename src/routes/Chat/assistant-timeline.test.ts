import type { ChatMessage, ChatMessagePart } from "../../../electron/chat/common.ts"

import { describe, expect, it } from "vitest"
import {
  assistantMessagesFromTimelineBlocks,
  assistantTimelineBlocks,
  segmentAssistantTimeline,
  textFromTimelineBlocks,
  timelineHasVisibleOutcome,
} from "./assistant-timeline.ts"

function message(id: string, parts: ChatMessagePart[], finishReason?: string): ChatMessage {
  return { id, role: "assistant", parts, createdAt: 1, ...(finishReason ? { finishReason } : {}) }
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

function questionPart(partId: string): ChatMessagePart {
  return { ...toolPart(partId), tool: "question", status: "error", error: "The user dismissed this question" }
}

describe("assistantTimelineBlocks", () => {
  it("hides persisted Codex skill-budget runtime notices", () => {
    const blocks = assistantTimelineBlocks([
      message("warning", [
        textPart(
          "warning:text",
          "Warning: Skill descriptions were shortened to fit the skills context budget. Codex can still see every skill.",
        ),
      ]),
      message("answer", [textPart("answer:text", "Working on it.")]),
    ])

    expect(blocks.map(({ message }) => message.id)).toEqual(["answer"])
  })

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

  it("preserves narration, tool, and final response chronology", () => {
    const segments = segmentAssistantTimeline([
      message("a1", [textPart("process-1", "I will inspect the page."), toolPart("tool-1")]),
      message("a2", [textPart("process-2", "The mobile page is blocked."), toolPart("tool-2")]),
      message("a3", [textPart("response-1", "The site blocks automated requests. Use a browser script instead.")]),
    ])
    const processBlocks = segments.filter((segment) => segment.kind === "process").flatMap((segment) => segment.blocks)
    const responseBlocks = segments
      .filter((segment) => segment.kind === "response")
      .flatMap((segment) => segment.blocks)

    expect(
      processBlocks.map(({ block }) => ({
        kind: block.kind,
        partIds: block.kind === "tools" ? block.parts.map((part) => part.partId) : [block.part.partId],
      })),
    ).toEqual([
      { kind: "tools", partIds: ["tool-1"] },
      { kind: "text", partIds: ["process-2"] },
      { kind: "tools", partIds: ["tool-2"] },
    ])
    expect(responseBlocks.map(({ block }) => (block.kind === "text" ? block.part.partId : block.kind))).toEqual([
      "process-1",
      "response-1",
    ])
    expect(textFromTimelineBlocks(responseBlocks)).toBe(
      "I will inspect the page.\n\nThe site blocks automated requests. Use a browser script instead.",
    )
    expect(segments.map(({ kind }) => kind)).toEqual(["response", "process", "response"])
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
    const segments = segmentAssistantTimeline([message("a1", [textPart("response-1", "Done.")])])

    expect(segments.map((segment) => segment.kind)).toEqual(["response"])
    expect(
      segments.flatMap((segment) =>
        segment.blocks.map(({ block }) => (block.kind === "text" ? block.part.partId : block.kind)),
      ),
    ).toEqual(["response-1"])
  })

  it("renders a short active ACP answer as a response without execution evidence", () => {
    const active = message("a1", [textPart("answer", "Hello!")])

    expect(segmentAssistantTimeline([active]).map((segment) => segment.kind)).toEqual(["response"])
  })

  it("keeps visible narration in place when its tool call arrives", () => {
    const narration = textPart("progress", "I will inspect the PostHog project first.")
    const beforeTool = message("a1", [narration])
    const afterTool = message("a1", [narration, toolPart("tool-1")])

    const beforeSegments = segmentAssistantTimeline([beforeTool])
    expect(beforeSegments.map(({ kind }) => kind)).toEqual(["response"])
    const afterSegments = segmentAssistantTimeline([afterTool])
    expect(afterSegments.map(({ kind }) => kind)).toEqual(["response", "process"])
    expect(afterSegments[0]?.key).toBe(beforeSegments[0]?.key)
    expect(textFromTimelineBlocks(afterSegments[0]?.blocks ?? [])).toBe(narration.text)
  })

  it("keeps structured prelude outside and intermediate narration inside processing", () => {
    const plan = [
      "## Selection plan",
      "",
      "| Product | Signal |",
      "| --- | --- |",
      "| Magnetic name tags | Strong |",
    ].join("\n")
    const segments = segmentAssistantTimeline([
      message("a1", [textPart("plan", plan), toolPart("question")], "tool-calls"),
      message("a2", [textPart("progress", "I will collect the platform data now."), toolPart("search")], "tool-calls"),
      message("a3", [textPart("final", "The report is ready.")], "stop"),
    ])

    expect(segments.map((segment) => segment.kind)).toEqual(["response", "process", "response"])
    expect(segments[0]?.blocks.map(({ block }) => block.kind)).toEqual(["text"])
    expect(segments[1]?.blocks.map(({ block }) => block.kind)).toEqual(["tools", "text", "tools"])
    expect(segments[2]?.blocks.map(({ block }) => block.kind)).toEqual(["text"])
    expect(timelineHasVisibleOutcome(segments)).toBe(true)
  })

  it("keeps question context outside the process disclosure", () => {
    const segments = segmentAssistantTimeline([
      message(
        "a1",
        [textPart("context", "I need you to confirm the target Notion page."), questionPart("question")],
        "tool-calls",
      ),
    ])

    expect(segments.map((segment) => segment.kind)).toEqual(["response", "process"])
    expect(textFromTimelineBlocks(segments[0]?.blocks ?? [])).toBe("I need you to confirm the target Notion page.")
  })

  it("does not hide a substantive answer followed by a trailing save tool", () => {
    const answer = "## Findings\n\n- First conclusion\n- Second conclusion"
    const segments = segmentAssistantTimeline([
      message("a1", [textPart("answer", answer), toolPart("save")], "tool-calls"),
    ])

    expect(segments.map((segment) => segment.kind)).toEqual(["response", "process"])
    expect(textFromTimelineBlocks(segments[0]?.blocks ?? [])).toBe(answer)
  })

  it("keeps narration visible before a failed tool", () => {
    const failedTool = { ...toolPart("proxy"), status: "error" as const, error: "The user rejected permission." }
    const segments = segmentAssistantTimeline([
      message("a1", [textPart("progress", "I will try the provider proxy."), failedTool], "tool-calls"),
    ])

    expect(segments.map((segment) => segment.kind)).toEqual(["response", "process"])
    expect(timelineHasVisibleOutcome(segments)).toBe(true)
  })

  it("keeps a short stop response visible even when its message contains a tool", () => {
    const segments = segmentAssistantTimeline([
      message("a1", [toolPart("lookup"), textPart("answer", "Done. The page is ready.")], "stop"),
    ])

    expect(segments.map((segment) => segment.kind)).toEqual(["process", "response"])
  })

  it("uses contiguous process disclosures to preserve lane chronology", () => {
    const segments = segmentAssistantTimeline([
      message("a1", [textPart("progress-1", "Checking data."), toolPart("tool-1")], "tool-calls"),
      message("a2", [textPart("answer", "## Interim result\n\nUseful result")], "stop"),
      message("a3", [textPart("progress-2", "Saving the result."), toolPart("tool-2")], "tool-calls"),
    ])

    expect(segments.map((segment) => segment.kind)).toEqual(["response", "process", "response", "process"])
    expect(segments.filter(({ kind }) => kind === "process").map(({ blocks }) => blocks[0]?.block.kind)).toEqual([
      "tools",
      "tools",
    ])
  })

  it("renders active structured text as a response without execution evidence", () => {
    const active = message("a1", [
      textPart("report", "## Data quality\n\n- YouTube complete\n- Reddit needs a narrower query"),
    ])

    expect(segmentAssistantTimeline([active]).map(({ kind }) => kind)).toEqual(["response"])
  })

  it("keeps intermediate narration and adjacent tools in one process disclosure", () => {
    const segments = segmentAssistantTimeline([
      message("a1", [toolPart("tool-1")]),
      message("a2", [toolPart("tool-2")]),
      message("a3", [textPart("note", "Now I will continue.")]),
      message("a4", [toolPart("tool-3")]),
    ])

    expect(segments.map(({ kind }) => kind)).toEqual(["process"])
    expect(segments[0]?.blocks.map(({ block }) => block.kind)).toEqual(["tools", "tools", "text", "tools"])
  })

  it("reconstructs process messages without unrelated response parts", () => {
    const source = message("a1", [textPart("progress", "Checking data."), toolPart("tool-1")], "tool-calls")
    const processBlocks = segmentAssistantTimeline([source])[1]?.blocks ?? []

    expect(assistantMessagesFromTimelineBlocks(processBlocks)).toEqual([{ ...source, parts: [source.parts[1]!] }])
  })
})
