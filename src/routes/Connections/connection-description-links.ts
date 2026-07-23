export type ConnectionDescriptionSegment = { kind: "text"; value: string } | { kind: "url"; value: string }

const httpUrlCandidatePattern = /https?:\/\/[^\s<>"'`“”‘’]+/giu
const trailingSentencePunctuation = new Set([".", ",", ";", ":", "!", "?", "。", "，", "；", "：", "！", "？", "、"])
const closingDelimiters = new Map([
  [")", "("],
  ["]", "["],
  ["}", "{"],
  ["）", "（"],
  ["】", "【"],
  ["》", "《"],
  ["〉", "〈"],
  ["」", "「"],
  ["』", "『"],
])

function characterCount(value: string, target: string): number {
  let count = 0
  for (const character of value) {
    if (character === target) {
      count += 1
    }
  }
  return count
}

function withoutTrailingProsePunctuation(candidate: string): string {
  let value = candidate
  while (value) {
    const lastCharacter = value.at(-1)
    if (!lastCharacter) {
      break
    }
    if (trailingSentencePunctuation.has(lastCharacter)) {
      value = value.slice(0, -1)
      continue
    }

    const openingDelimiter = closingDelimiters.get(lastCharacter)
    if (openingDelimiter && characterCount(value, lastCharacter) > characterCount(value, openingDelimiter)) {
      value = value.slice(0, -1)
      continue
    }
    break
  }
  return value
}

function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value)
    return url.protocol === "http:" || url.protocol === "https:"
  } catch {
    return false
  }
}

function appendTextSegment(segments: ConnectionDescriptionSegment[], value: string): void {
  if (!value) {
    return
  }
  const previous = segments.at(-1)
  if (previous?.kind === "text") {
    previous.value += value
    return
  }
  segments.push({ kind: "text", value })
}

export function connectionDescriptionSegments(text: string): ConnectionDescriptionSegment[] {
  const segments: ConnectionDescriptionSegment[] = []
  let textStart = 0

  for (const match of text.matchAll(httpUrlCandidatePattern)) {
    const candidate = match[0]
    const candidateStart = match.index
    appendTextSegment(segments, text.slice(textStart, candidateStart))

    const url = withoutTrailingProsePunctuation(candidate)
    if (!url || !isHttpUrl(url)) {
      appendTextSegment(segments, candidate)
    } else {
      segments.push({ kind: "url", value: url })
      appendTextSegment(segments, candidate.slice(url.length))
    }
    textStart = candidateStart + candidate.length
  }

  appendTextSegment(segments, text.slice(textStart))
  return segments
}
