import type { ChatMessagePart } from "../../../electron/chat/common.ts"

export type RenderBlock =
  | { kind: "text"; part: ChatMessagePart }
  | { kind: "error"; part: ChatMessagePart }
  | { kind: "status"; part: ChatMessagePart }
  | { kind: "attachment"; part: ChatMessagePart }
  | { kind: "tools"; key: string; parts: ChatMessagePart[] }

export function isRenderablePart(part: ChatMessagePart): boolean {
  return (
    part.kind === "tool" ||
    part.kind === "error" ||
    part.kind === "status" ||
    (part.kind === "attachment" && Boolean(part.attachment?.mime.toLowerCase().startsWith("image/"))) ||
    (part.kind === "text" && Boolean(part.text?.trim()))
  )
}

function textRendersAttachment(parts: ChatMessagePart[], attachmentPath: string): boolean {
  if (!attachmentPath.trim()) {
    return false
  }
  const localImagePath = /^(?:file:\/\/|~?[\\/]|[A-Za-z]:[\\/])/i.test(attachmentPath)
  return parts.some((part) => {
    if (part.kind !== "text" || !part.text?.includes(attachmentPath)) {
      return false
    }
    return localImagePath || part.text.includes(`](${attachmentPath})`) || part.text.includes(`](<${attachmentPath}>)`)
  })
}

export function renderBlocks(parts: ChatMessagePart[]): RenderBlock[] {
  const blocks: RenderBlock[] = []
  let pendingTools: ChatMessagePart[] = []
  const flushTools = () => {
    if (pendingTools.length === 0) {
      return
    }
    blocks.push({ kind: "tools", key: pendingTools[0]?.partId ?? "tools", parts: pendingTools })
    pendingTools = []
  }
  for (const part of parts) {
    if (!isRenderablePart(part)) {
      continue
    }
    if (part.kind === "attachment" && part.attachment && textRendersAttachment(parts, part.attachment.path)) {
      continue
    }
    if (part.kind === "tool") {
      pendingTools.push(part)
      continue
    }
    flushTools()
    if (part.kind === "error") {
      blocks.push({ kind: "error", part })
    } else if (part.kind === "status") {
      blocks.push({ kind: "status", part })
    } else if (part.kind === "attachment") {
      blocks.push({ kind: "attachment", part })
    } else if (part.kind === "text") {
      blocks.push({ kind: "text", part })
    }
  }
  flushTools()
  return blocks
}
