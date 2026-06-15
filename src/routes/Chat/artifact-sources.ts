import type { ChatMessage } from "../../../electron/chat/common.ts"

export interface TurnArtifactSource {
  messageId: string
  text: string
  artifactRoot?: string
  sourcePaths: string[]
}

function assistantMessageText(message: ChatMessage): string {
  return message.parts
    .filter((part) => part.kind === "text")
    .map((part) => part.text ?? "")
    .join("")
}

function sourceForTurn(
  renderMessageId: string | null,
  artifactRoot: string | undefined,
  textParts: string[],
  sourcePaths: string[],
): TurnArtifactSource | null {
  if (!renderMessageId) {
    return null
  }
  const text = textParts.join("\n").trim()
  if (!artifactRoot && !text) {
    return null
  }
  return {
    messageId: renderMessageId,
    text,
    sourcePaths,
    ...(artifactRoot ? { artifactRoot } : {}),
  }
}

export function turnArtifactSourcesByRenderMessage(messages: ChatMessage[]): Map<string, TurnArtifactSource> {
  const sources = new Map<string, TurnArtifactSource>()
  let latestArtifactRoot: string | undefined
  let sourcePaths: string[] = []
  let textParts: string[] = []
  let lastAssistantMessageId: string | null = null

  const flushTurn = () => {
    const source = sourceForTurn(lastAssistantMessageId, latestArtifactRoot, textParts, sourcePaths)
    if (source) {
      sources.set(source.messageId, source)
    }
    latestArtifactRoot = undefined
    sourcePaths = []
    textParts = []
    lastAssistantMessageId = null
  }

  for (const message of messages) {
    if (message.role === "user") {
      flushTurn()
      sourcePaths = message.parts
        .filter((part) => part.kind === "attachment" && part.attachment)
        .map((part) => part.attachment?.path ?? "")
        .filter(Boolean)
      continue
    }
    if (message.role !== "assistant") {
      continue
    }
    lastAssistantMessageId = message.id
    const text = assistantMessageText(message).trim()
    if (text) {
      textParts.push(text)
    }
    if (message.artifactRoot) {
      latestArtifactRoot = message.artifactRoot
    }
  }
  flushTurn()
  return sources
}
