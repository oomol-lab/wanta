const wantaPromptContextTag = "<wanta_turn_context"
const wantaPromptContextVisibility = 'visibility="hidden_from_ui"'
const wantaPromptContextStart = `\n\n${wantaPromptContextTag} ${wantaPromptContextVisibility}>`
const wantaPromptContextEnd = "</wanta_turn_context>"

/** V2 prompt 没有每轮 system 字段；这里把 Wanta 内部上下文附到 prompt 末尾，并在展示历史时剥离。 */
export function appendWantaPromptContext(text: string, context: string | undefined): string {
  const normalizedContext = context?.trim()
  if (!normalizedContext) {
    return text
  }
  return `${text.trimEnd()}${wantaPromptContextStart}\n${normalizedContext}\n${wantaPromptContextEnd}`
}

export function stripWantaPromptContext(text: string): string {
  let remaining = text
  let cleaned = ""
  while (remaining.length > 0) {
    const tagStart = remaining.indexOf(wantaPromptContextTag)
    if (tagStart === -1) {
      cleaned += remaining
      break
    }
    const tagEnd = remaining.indexOf(">", tagStart)
    if (tagEnd === -1) {
      cleaned += remaining.slice(0, tagStart).trimEnd()
      break
    }
    const openingTag = remaining.slice(tagStart, tagEnd + 1)
    if (!openingTag.includes(wantaPromptContextVisibility)) {
      cleaned += remaining.slice(0, tagEnd + 1)
      remaining = remaining.slice(tagEnd + 1)
      continue
    }
    cleaned += remaining.slice(0, tagStart).trimEnd()
    const blockEnd = remaining.indexOf(wantaPromptContextEnd, tagEnd + 1)
    if (blockEnd === -1) {
      break
    }
    const afterStart = blockEnd + wantaPromptContextEnd.length
    const beforeNext = cleaned.trimEnd()
    const after = remaining.slice(afterStart).trimStart()
    cleaned = beforeNext
    remaining = after ? (beforeNext ? `\n\n${after}` : after) : ""
  }
  return cleaned
}
