import type { ChatMessage, ChatMessagePart } from "../../../electron/chat/common.ts"
import type { AssistantTimelineBlock } from "./assistant-timeline.ts"
import type { ChatTurnProcess } from "./chat-turns.ts"

import { describe, expect, it } from "vitest"
import { buildTurnProcessActivityRenderModel } from "./process-activity-render-model.ts"

function processFor(parts: ChatMessagePart[]): ChatTurnProcess {
  return {
    activity: null,
    authorizationIssues: [],
    errors: [],
    hasActiveTool: false,
    hasAuthorization: false,
    hasBlockingError: false,
    hasStoppedTool: false,
    hasSuccessfulConnectorCall: false,
    hasToolError: false,
    hasVisibleOutcome: false,
    tools: parts,
  }
}

describe("buildTurnProcessActivityRenderModel", () => {
  it("preserves activity blocks without product-specific grouping", () => {
    const message: ChatMessage = { id: "assistant", role: "assistant", parts: [], createdAt: 1 }
    const part: ChatMessagePart = {
      kind: "tool",
      partId: "tool-1",
      callId: "call-1",
      tool: "bash",
      status: "completed",
      input: { command: "echo ok" },
    }
    const blocks: AssistantTimelineBlock[] = [{ message, block: { kind: "tools", key: "tools", parts: [part] } }]

    const model = buildTurnProcessActivityRenderModel({ blocks, process: processFor([part]) })

    expect(model.activityBlocks).toBe(blocks)
    expect(model.renderBlocks).toEqual(blocks.map((item) => item.block))
  })
})
