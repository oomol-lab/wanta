import type { ChatMessage } from "../../../electron/chat/common.ts"

export interface GeneratedArtifactSource {
  messageId: string
  requestText: string
  text: string
  artifactRoot?: string
  sourcePaths: string[]
}

function messageText(message: ChatMessage): string {
  return message.parts
    .filter((part) => part.kind === "text")
    .map((part) => part.text ?? "")
    .join("")
}

function sourceForTurn(
  messageId: string | null,
  artifactRoot: string | undefined,
  requestText: string,
  textParts: string[],
  sourcePaths: string[],
): GeneratedArtifactSource | null {
  if (!messageId) {
    return null
  }
  const text = textParts.join("\n").trim()
  if (!artifactRoot && !text) {
    return null
  }
  return {
    messageId,
    requestText,
    text,
    sourcePaths,
    ...(artifactRoot ? { artifactRoot } : {}),
  }
}

export function collectGeneratedArtifactSources(messages: ChatMessage[]): GeneratedArtifactSource[] {
  const sources: GeneratedArtifactSource[] = []
  let latestArtifactRoot: string | undefined
  let requestText = ""
  let sourcePaths: string[] = []
  let textParts: string[] = []
  let lastAssistantMessageId: string | null = null

  const flushTurn = () => {
    const source = sourceForTurn(lastAssistantMessageId, latestArtifactRoot, requestText, textParts, sourcePaths)
    if (source) {
      sources.push(source)
    }
    latestArtifactRoot = undefined
    requestText = ""
    sourcePaths = []
    textParts = []
    lastAssistantMessageId = null
  }

  for (const message of messages) {
    if (message.role === "user") {
      flushTurn()
      requestText = messageText(message).trim()
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
    const text = messageText(message).trim()
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
