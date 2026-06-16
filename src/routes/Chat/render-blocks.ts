import type { ChatMessagePart } from "../../../electron/chat/common.ts"

export type RenderBlock =
  | { kind: "text"; part: ChatMessagePart }
  | { kind: "reasoning"; part: ChatMessagePart }
  | { kind: "error"; part: ChatMessagePart }
  | { kind: "tools"; key: string; parts: ChatMessagePart[] }

export function isRenderablePart(part: ChatMessagePart): boolean {
  return part.kind === "tool" || part.kind === "error" || Boolean(part.text?.trim())
}

export function renderBlocks(parts: ChatMessagePart[]): RenderBlock[] {
  const blocks: RenderBlock[] = []
  let pendingTools: ChatMessagePart[] = []
  const flushTools = () => {
    if (pendingTools.length === 0) {
      return
    }
    blocks.push({ kind: "tools", key: pendingTools.map((part) => part.partId).join(":"), parts: pendingTools })
    pendingTools = []
  }
  for (const part of parts) {
    if (!isRenderablePart(part)) {
      continue
    }
    if (part.kind === "tool") {
      pendingTools.push(part)
      continue
    }
    flushTools()
    if (part.kind === "error") {
      blocks.push({ kind: "error", part })
    } else if (part.kind === "reasoning") {
      blocks.push({ kind: "reasoning", part })
    } else {
      blocks.push({ kind: "text", part })
    }
  }
  flushTools()
  return blocks
}
