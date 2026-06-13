export const SESSION_TITLE_MAX_COLUMNS = 32
export const SESSION_TITLE_FALLBACK = "New chat"

const urlPattern = /https?:\/\/[^\s]+/gi
const oldEllipsisPattern = /\.{3}$/

export interface BuildSessionTitleInput {
  text: string
  attachmentNames?: string[]
}

export function buildFallbackSessionTitle(input: BuildSessionTitleInput): string {
  const normalized = normalizeTitleText(input.text)
  const textWithoutUrls = normalizeTitleText(normalized.replace(urlPattern, " "))
  const source = textWithoutUrls || titleFromFirstUrl(normalized) || input.attachmentNames?.find((name) => name.trim())
  return trimTitleToColumns(source ?? SESSION_TITLE_FALLBACK)
}

export function sanitizeGeneratedSessionTitle(raw: string, fallbackInput: BuildSessionTitleInput): string {
  const firstLine = raw.split(/\r?\n/).find((line) => line.trim()) ?? ""
  const withoutPrefix = firstLine.replace(/^(title|标题)\s*[:：]\s*/i, "")
  const stripped = stripWrappingPunctuation(withoutPrefix)
  const normalized = normalizeTitleText(stripped)

  if (!normalized || isMostlyUrlTitle(normalized)) {
    return buildFallbackSessionTitle(fallbackInput)
  }

  return trimTitleToColumns(normalized)
}

export function shouldAutoRefreshSessionTitle(title: string, allowPlaceholder: boolean): boolean {
  const normalized = normalizeTitleText(title)
  if (!normalized) {
    return true
  }
  if (allowPlaceholder && isPlaceholderTitle(normalized)) {
    return true
  }
  return (
    isMostlyUrlTitle(normalized) ||
    (oldEllipsisPattern.test(normalized) && displayColumns(normalized) >= SESSION_TITLE_MAX_COLUMNS - 2)
  )
}

export function isPlaceholderTitle(title: string): boolean {
  const normalized = normalizeTitleText(title)
  return normalized === SESSION_TITLE_FALLBACK || normalized === "新会话" || /^New session\b/i.test(normalized)
}

export function trimTitleToColumns(title: string, maxColumns = SESSION_TITLE_MAX_COLUMNS): string {
  const normalized = normalizeTitleText(title)
  if (!normalized) {
    return SESSION_TITLE_FALLBACK
  }

  if (displayColumns(normalized) <= maxColumns) {
    return normalized
  }

  const ellipsis = "..."
  const budget = Math.max(1, maxColumns - displayColumns(ellipsis))
  let columns = 0
  let output = ""
  for (const char of Array.from(normalized)) {
    const width = charDisplayColumns(char)
    if (columns + width > budget) {
      break
    }
    output += char
    columns += width
  }
  return `${output.trimEnd()}${ellipsis}`
}

function normalizeTitleText(value: string): string {
  return value.replace(/\s+/g, " ").trim()
}

function stripWrappingPunctuation(value: string): string {
  return value
    .trim()
    .replace(/^["'`“”‘’「『【《]+/, "")
    .replace(/["'`“”‘’」』】》.。!！?？]+$/, "")
}

function titleFromFirstUrl(value: string): string | undefined {
  const match = value.match(urlPattern)?.[0]
  if (!match) {
    return undefined
  }
  try {
    const url = new URL(match)
    const host = url.hostname.replace(/^www\./, "")
    return host ? `Review ${host}` : undefined
  } catch {
    return undefined
  }
}

function isMostlyUrlTitle(value: string): boolean {
  const normalized = normalizeTitleText(value)
  if (!normalized) {
    return false
  }
  if (/^https?:\/\//i.test(normalized)) {
    return true
  }
  const withoutUrls = normalizeTitleText(normalized.replace(urlPattern, " "))
  return Boolean(withoutUrls.length === 0 && normalized.match(urlPattern))
}

function displayColumns(value: string): number {
  return Array.from(value).reduce((total, char) => total + charDisplayColumns(char), 0)
}

function charDisplayColumns(char: string): number {
  const codePoint = char.codePointAt(0) ?? 0
  if (
    (codePoint >= 0x1100 && codePoint <= 0x115f) ||
    (codePoint >= 0x2e80 && codePoint <= 0xa4cf) ||
    (codePoint >= 0xac00 && codePoint <= 0xd7a3) ||
    (codePoint >= 0xf900 && codePoint <= 0xfaff) ||
    (codePoint >= 0xfe10 && codePoint <= 0xfe6f) ||
    (codePoint >= 0xff00 && codePoint <= 0xff60) ||
    (codePoint >= 0xffe0 && codePoint <= 0xffe6)
  ) {
    return 2
  }
  return 1
}
