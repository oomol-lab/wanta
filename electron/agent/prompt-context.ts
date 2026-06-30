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
  while (remaining.trimEnd().endsWith(wantaPromptContextEnd)) {
    const trimmedEnd = remaining.trimEnd()
    const tagStart = trimmedEnd.lastIndexOf(wantaPromptContextTag)
    if (tagStart === -1) {
      break
    }
    const tagEnd = trimmedEnd.indexOf(">", tagStart)
    if (tagEnd === -1) {
      break
    }
    const openingTag = trimmedEnd.slice(tagStart, tagEnd + 1)
    if (!openingTag.includes(wantaPromptContextVisibility)) {
      break
    }
    const blockEnd = trimmedEnd.indexOf(wantaPromptContextEnd, tagEnd + 1)
    if (blockEnd === -1 || blockEnd + wantaPromptContextEnd.length !== trimmedEnd.length) {
      break
    }
    remaining = trimmedEnd.slice(0, tagStart).trimEnd()
  }
  return remaining
}
