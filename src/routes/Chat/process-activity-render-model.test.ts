import type { ChatMessage, ChatMessagePart } from "../../../electron/chat/common.ts"
import type { AssistantTimelineBlock } from "./assistant-timeline.ts"
import type { ChatTurnProcess } from "./chat-turns.ts"

import { describe, expect, it } from "vitest"
import { buildTurnProcessActivityRenderModel } from "./process-activity-render-model.ts"

function message(id: string): ChatMessage {
  return { id, role: "assistant", parts: [], createdAt: 1 }
}

function wgTool(partId: string, command: string, status: ChatMessagePart["status"] = "completed"): ChatMessagePart {
  return {
    kind: "tool",
    partId,
    callId: partId,
    tool: "bash",
    status,
    input: { command },
  }
}

function wikigraphSkillTool(partId: string, status: ChatMessagePart["status"] = "completed"): ChatMessagePart {
  return {
    kind: "tool",
    partId,
    callId: partId,
    tool: "skill",
    status,
    title: "Loaded skill: wikigraph-knowledge",
  }
}

function textBlock(partId: string, text: string): AssistantTimelineBlock {
  return {
    message: message(`message-${partId}`),
    block: { kind: "text", part: { kind: "text", partId, text } },
  }
}

function toolBlock(key: string, parts: ChatMessagePart[]): AssistantTimelineBlock {
  return {
    message: message(`message-${key}`),
    block: { kind: "tools", key, parts },
  }
}

function processFor(parts: ChatMessagePart[], overrides: Partial<ChatTurnProcess> = {}): ChatTurnProcess {
  return {
    activity: null,
    authorizationIssues: [],
    errors: [],
    hasActiveTool: parts.some((part) => part.status === "running" || part.status === "pending"),
    hasAuthorization: false,
    hasBlockingError: false,
    hasStoppedTool: false,
    hasSuccessfulConnectorCall: false,
    hasToolError: false,
    hasVisibleOutcome: false,
    tools: parts,
    ...overrides,
  }
}

function renderedToolParts(model: ReturnType<typeof buildTurnProcessActivityRenderModel>): ChatMessagePart[] {
  return model.activityBlocks.flatMap(({ block }) => (block.kind === "tools" ? block.parts : []))
}

describe("buildTurnProcessActivityRenderModel", () => {
  it("normalizes adjacent WikiGraph blocks through the same render model for live and completed views", () => {
    const tools = [
      wikigraphSkillTool("tool-skill"),
      wgTool("tool-help", "wg help recipe 2>&1"),
      wgTool("tool-wg-1", 'wg wikg://lib/entity --query "华容道" --json'),
      wgTool("tool-wg-2", 'wg wikg://lib/chapter --query "关羽 曹操"'),
    ]
    const blocks = [toolBlock("tools-1", [tools[0]!, tools[1]!, tools[2]!]), toolBlock("tools-2", [tools[3]!])]

    const live = buildTurnProcessActivityRenderModel({ blocks, live: true, process: processFor(tools) })
    const completed = buildTurnProcessActivityRenderModel({ blocks, live: false, process: processFor(tools) })
    const liveParts = renderedToolParts(live)
    const completedParts = renderedToolParts(completed)

    expect(liveParts).toHaveLength(1)
    expect(completedParts).toHaveLength(1)
    expect(liveParts[0]?.title).toBe(completedParts[0]?.title)
    expect(liveParts[0]?.input).toEqual(completedParts[0]?.input)
    expect(liveParts[0]?.output).toBeUndefined()
    expect(completedParts[0]?.output).toBeUndefined()
    expect(liveParts[0]?.status).toBe("running")
    expect(completedParts[0]?.status).toBe("completed")
  })

  it("uses visible text as a boundary so a finished WikiGraph group is completed even while later work is live", () => {
    const tools = [
      wgTool("tool-wg", 'wg wikg://lib/entity --query "华容道" --json'),
      { ...wgTool("tool-running", "node script.js"), status: "running" as const },
    ]
    const blocks = [
      toolBlock("tools-wg", [tools[0]!]),
      textBlock("text-1", "我会继续整理结果。"),
      toolBlock("tools-running", [tools[1]!]),
    ]

    const model = buildTurnProcessActivityRenderModel({ blocks, live: true, process: processFor(tools) })
    const parts = renderedToolParts(model)

    expect(parts).toHaveLength(2)
    expect(parts[0]?.title).toBe("Loaded skill: wikigraph-knowledge")
    expect(parts[0]?.status).toBe("completed")
    expect(parts[1]?.tool).toBe("bash")
    expect(parts[1]?.status).toBe("running")
  })

  it("hides pending WG commands before they are complete enough to render", () => {
    const pendingWg = wgTool("tool-pending-wg", "wg", "running")
    const blocks = [toolBlock("tools-pending-wg", [pendingWg])]

    const model = buildTurnProcessActivityRenderModel({ blocks, live: true, process: processFor([pendingWg]) })

    expect(model.activityBlocks).toHaveLength(0)
    expect(renderedToolParts(model)).toHaveLength(0)
  })
})
