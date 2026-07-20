export type ComposerTriggerKind = "context" | "skill" | "slash"

export interface ComposerTrigger {
  end: number
  kind: ComposerTriggerKind
  query: string
  start: number
}

function isWhitespace(value: string): boolean {
  return /\s/.test(value)
}

function isTriggerBoundary(value: string | undefined): boolean {
  return value === undefined || isWhitespace(value)
}

function isContextTriggerBoundary(value: string | undefined): boolean {
  return value === undefined || isWhitespace(value)
}

function isQueryTerminator(value: string): boolean {
  return isWhitespace(value)
}

export function detectComposerTrigger(
  text: string,
  selectionStart: number,
  selectionEnd = selectionStart,
): ComposerTrigger | null {
  if (selectionStart !== selectionEnd || selectionStart < 0 || selectionStart > text.length) {
    return null
  }

  let start = selectionStart - 1
  while (start >= 0 && !isQueryTerminator(text[start] ?? "")) {
    start -= 1
  }
  start += 1

  const marker = text[start]
  if (marker !== "/" && marker !== "$" && marker !== "@") {
    return null
  }

  if (!isTriggerBoundary(start > 0 ? text[start - 1] : undefined)) {
    return null
  }

  if (marker === "@" && !isContextTriggerBoundary(start > 0 ? text[start - 1] : undefined)) {
    return null
  }

  const query = text.slice(start + 1, selectionStart)
  if (query.includes("/") || query.includes("$") || query.includes("@")) {
    return null
  }

  return {
    end: selectionStart,
    kind: marker === "/" ? "slash" : marker === "$" ? "skill" : "context",
    query,
    start,
  }
}

export function replaceComposerTrigger(text: string, trigger: ComposerTrigger, replacement: string): string {
  return `${text.slice(0, trigger.start)}${replacement}${text.slice(trigger.end)}`
}
