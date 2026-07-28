import type { ChatMessagePart } from "../../../electron/chat/common.ts"
import type { AssistantTimelineBlock } from "./assistant-timeline.ts"
import type { ChatTurnProcess, ChatTurnProcessStatus } from "./chat-turns.ts"
import type { RenderBlock } from "./render-blocks.ts"

import {
  chatTurnProcessStatus,
  settlingToolPartId,
  shouldSurfaceProcessActivity,
  summarizeTurnProcess,
} from "./chat-turns.ts"
import { isActiveToolPart } from "./tool-state.ts"
import { groupedWikigraphToolActivityBlocks } from "./wikigraph-tool-grouping.ts"

export interface TurnProcessActivityRenderModel {
  activityBlocks: AssistantTimelineBlock[]
  renderBlocks: RenderBlock[]
  settlingPartId?: string
  showLiveStatus: boolean
  status: ChatTurnProcessStatus
  statusKey: string
}

export function latestActiveProcessTool(process: Pick<ChatTurnProcess, "tools">): ChatMessagePart | null {
  for (let index = process.tools.length - 1; index >= 0; index -= 1) {
    const part = process.tools[index]
    if (part && isActiveToolPart(part)) {
      return part
    }
  }
  return null
}

export function shouldShowProcessLiveStatus(
  process: Pick<ChatTurnProcess, "activity" | "tools">,
  status: ChatTurnProcessStatus,
): boolean {
  const activeTool = latestActiveProcessTool(process)
  return (
    (status === "running" && !activeTool) ||
    status === "retrying" ||
    Boolean(process.activity && status !== "completed" && status !== "stopped")
  )
}

export function buildTurnProcessActivityRenderModel({
  blocks,
  live = false,
  process,
}: {
  blocks: AssistantTimelineBlock[]
  live?: boolean
  process: ReturnType<typeof summarizeTurnProcess>
}): TurnProcessActivityRenderModel {
  const status = chatTurnProcessStatus(process, live)
  const statusKey = [
    status,
    live ? "live" : "",
    process.activity?.phase,
    process.tools.map((part) => `${part.partId}:${part.status}`).join("|"),
    process.errors.map((part) => part.partId).join("|"),
  ].join(":")
  const activityBlocks = groupedWikigraphToolActivityBlocks(blocks, { live })
  const renderBlocks = activityBlocks.map((item) => item.block)
  return {
    activityBlocks,
    renderBlocks,
    settlingPartId: settlingToolPartId(process, status),
    showLiveStatus:
      (renderBlocks.length === 0 || shouldSurfaceProcessActivity(process.activity)) &&
      shouldShowProcessLiveStatus(process, status),
    status,
    statusKey,
  }
}
