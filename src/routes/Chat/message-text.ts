import type { ChatMessage } from "../../../electron/chat/common.ts"

const readToolPrefix = "Called the Read tool with the following input:"

export function visibleUserText(text: string): string {
  if (!text.startsWith(readToolPrefix)) {
    return text
  }

  const afterPrefix = text.slice(readToolPrefix.length).trimStart()
  const jsonEnd = jsonObjectEnd(afterPrefix)
  if (jsonEnd === -1) {
    return text
  }
  return afterPrefix.slice(jsonEnd + 1).trimStart()
}

export function copyableMessageText(message: Pick<ChatMessage, "parts" | "role">): string {
  const textParts = message.parts
    .filter((part) => part.kind === "text")
    .map((part) => part.text ?? "")
    .filter(Boolean)

  if (message.role === "user") {
    return visibleUserText(textParts.join("")).trim()
  }
  return textParts.join("\n\n").trim()
}

export function assistantResponseActionTextByMessageId(
  messages: Pick<ChatMessage, "id" | "parts" | "role">[],
  activeAssistantMessageId?: string,
): Map<string, string> {
  const textByMessageId = new Map<string, string>()
  let group: Pick<ChatMessage, "id" | "parts" | "role">[] = []

  const flushGroup = (): void => {
    const last = group.at(-1)
    if (!last) {
      return
    }
    if (last.id === activeAssistantMessageId) {
      group = []
      return
    }
    const text = group
      .map((message) => copyableMessageText(message))
      .filter(Boolean)
      .join("\n\n")
      .trim()
    if (text) {
      textByMessageId.set(last.id, text)
    }
    group = []
  }

  for (const message of messages) {
    if (message.role === "assistant") {
      group.push(message)
      continue
    }
    flushGroup()
  }
  flushGroup()
  return textByMessageId
}

export function reuseStableTextMap(previous: Map<string, string>, next: Map<string, string>): Map<string, string> {
  if (previous.size !== next.size) {
    return next
  }
  for (const [key, value] of next) {
    if (previous.get(key) !== value) {
      return next
    }
  }
  return previous
}

function jsonObjectEnd(text: string): number {
  if (!text.startsWith("{")) {
    return -1
  }

  let depth = 0
  let inString = false
  let escaped = false
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index]
    if (inString) {
      if (escaped) {
        escaped = false
      } else if (char === "\\") {
        escaped = true
      } else if (char === '"') {
        inString = false
      }
      continue
    }

    if (char === '"') {
      inString = true
      continue
    }
    if (char === "{") {
      depth += 1
      continue
    }
    if (char === "}") {
      depth -= 1
      if (depth === 0) {
        return index
      }
    }
  }
  return -1
}
