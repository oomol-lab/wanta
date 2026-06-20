export const SESSION_TITLE_FALLBACK = "New chat"
export const SESSION_TITLE_MAX_CJK_CHARS = 8
export const SESSION_TITLE_MAX_LATIN_WORDS = 4
export const SESSION_TITLE_MAX_MIXED_LATIN_WORDS = 2
export const SESSION_TITLE_MAX_OTHER_CHARS = 32

const urlPattern = /https?:\/\/[^\s]+/gi
const oldEllipsisPattern = /\.{3}$/
const leadingChineseRequestPattern = /^(?:请|麻烦)?(?:你|您)?(?:帮(?:我|忙)|给我|替我)(?:一下|下)?(?:把|将)?/
const leadingChineseObjectMarkerPattern = /^(?:把|将)/
const leadingChinesePointerPattern = /^(?:这个|那个|这些|那些)/
const trailingChineseFetchActionPattern = /(?:都)?(抓取|抓|下载|保存|提取)(?:下来|出来|一下|下)?$/

export interface BuildSessionTitleInput {
  text: string
  attachmentNames?: string[]
}

export interface SanitizedGeneratedSessionTitle {
  title: string
  usedFallback: boolean
}

export function buildFallbackSessionTitle(input: BuildSessionTitleInput): string {
  const normalized = normalizeTitleText(input.text)
  const textWithoutUrls = normalizeTitleText(normalized.replace(urlPattern, " "))
  const source = textWithoutUrls || titleFromFirstUrl(normalized) || input.attachmentNames?.find((name) => name.trim())
  return normalizeSessionTitle(compactTitleText(source ?? SESSION_TITLE_FALLBACK))
}

export function sanitizeGeneratedSessionTitle(
  raw: string,
  fallbackInput: BuildSessionTitleInput,
): SanitizedGeneratedSessionTitle {
  const title = titleFromGeneratedOutput(raw)
  const withoutPrefix = title.replace(/^(title|标题)\s*[:：]\s*/i, "")
  const stripped = stripWrappingPunctuation(withoutPrefix)
  const normalized = normalizeTitleText(stripped)

  if (!normalized || containsHttpUrl(normalized)) {
    return { title: buildFallbackSessionTitle(fallbackInput), usedFallback: true }
  }

  return { title: normalizeSessionTitle(compactTitleText(normalized)), usedFallback: false }
}

export function isGeneratedSessionTitleAcceptable(title: string): boolean {
  const normalized = normalizeTitleText(title)
  if (
    !normalized ||
    containsHttpUrl(normalized) ||
    oldEllipsisPattern.test(normalized) ||
    normalized.includes("…") ||
    /[.!?。！？,，;；:：]$/.test(normalized)
  ) {
    return false
  }

  const cjkChars = cjkCharacters(normalized)
  const latinWords = latinTitleWords(normalized)
  if (cjkChars.length > 0) {
    return cjkChars.length <= SESSION_TITLE_MAX_CJK_CHARS && latinWords.length <= SESSION_TITLE_MAX_MIXED_LATIN_WORDS
  }
  if (latinWords.length > 0) {
    return latinWords.length <= SESSION_TITLE_MAX_LATIN_WORDS
  }
  return graphemeLength(normalized) <= SESSION_TITLE_MAX_OTHER_CHARS
}

export function shouldAutoRefreshSessionTitle(title: string, allowPlaceholder: boolean): boolean {
  const normalized = normalizeTitleText(title)
  if (!normalized) {
    return true
  }
  if (allowPlaceholder && isPlaceholderTitle(normalized)) {
    return true
  }
  return containsHttpUrl(normalized) || oldEllipsisPattern.test(normalized) || normalized.includes("…")
}

export function isPlaceholderTitle(title: string): boolean {
  const normalized = normalizeTitleText(title)
  return normalized === SESSION_TITLE_FALLBACK || normalized === "新会话" || /^New session\b/i.test(normalized)
}

export function trimTitleToColumns(title: string): string {
  return normalizeSessionTitle(title)
}

function normalizeSessionTitle(title: string): string {
  return normalizeTitleText(title) || SESSION_TITLE_FALLBACK
}

function compactTitleText(value: string): string {
  const normalized = normalizeTitleText(value)
  const compactedChinese = compactChineseRequestTitle(normalized)
  return compactedChinese || normalized
}

function compactChineseRequestTitle(value: string): string | undefined {
  if (!containsCjk(value)) {
    return undefined
  }
  let title = value
    .replace(leadingChineseRequestPattern, "")
    .replace(leadingChineseObjectMarkerPattern, "")
    .replace(leadingChinesePointerPattern, "")
    .trim()

  title = title
    .replace(/店铺中?商品相关的图片/g, "店铺商品图片")
    .replace(/商品相关的图片/g, "商品图片")
    .replace(/相关的/g, "")
    .replace(/中的/g, "")
    .trim()

  const fetchActionMatch = title.match(trailingChineseFetchActionPattern)
  if (fetchActionMatch) {
    const action = fetchActionMatch[1] === "抓" ? "抓取" : fetchActionMatch[1]
    const object = title.replace(trailingChineseFetchActionPattern, "").replace(leadingChinesePointerPattern, "").trim()
    return object ? `${action}${object}` : title
  }

  return title || undefined
}

function containsCjk(value: string): boolean {
  return /[\u3400-\u9fff]/.test(value)
}

function cjkCharacters(value: string): string[] {
  return Array.from(value.matchAll(/[\u3400-\u9fff]/g), (match) => match[0])
}

function latinTitleWords(value: string): string[] {
  return value.match(/[A-Za-z0-9][A-Za-z0-9+.#'’-]*/g) ?? []
}

function graphemeLength(value: string): number {
  return Array.from(value).length
}

function normalizeTitleText(value: string): string {
  return value.replace(/\s+/g, " ").trim()
}

function titleFromGeneratedOutput(raw: string): string {
  const trimmed = raw.trim()
  if (!trimmed) {
    return ""
  }
  const unfenced = stripMarkdownFence(trimmed)
  const parsedTitle = titleFromJsonObject(unfenced)
  if (parsedTitle !== undefined) {
    return parsedTitle
  }

  return unfenced.split(/\r?\n/).find((line) => line.trim()) ?? ""
}

function titleFromJsonObject(value: string): string | undefined {
  try {
    const parsed = JSON.parse(value) as { title?: unknown }
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return typeof parsed.title === "string" ? parsed.title : ""
    }
    return ""
  } catch {
    return undefined
  }
}

function stripMarkdownFence(value: string): string {
  return value
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "")
    .trim()
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
    return host || undefined
  } catch {
    return undefined
  }
}

function containsHttpUrl(value: string): boolean {
  const normalized = normalizeTitleText(value)
  if (!normalized) {
    return false
  }
  return Boolean(normalized.match(urlPattern))
}
