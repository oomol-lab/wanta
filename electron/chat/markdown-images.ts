const imageExtensionSource = "(?:avif|bmp|gif|jpe?g|png|svg|webp)"
const absoluteLocalPathStartSource = "(?:file:\\/\\/|\\/|[A-Za-z]:[\\\\/])"
const localMarkdownImagePattern = new RegExp(
  `!\\[([^\\]\\n]*)\\]\\(\\s*(${absoluteLocalPathStartSource}[^<>\\n]*?\\.${imageExtensionSource})(\\s+(?:"[^"\\n]*"|'[^'\\n]*'|\\([^\\)\\n]*\\)))?\\s*\\)`,
  "gi",
)
const markdownImagePattern =
  /!\[[^\]\n]*\]\(\s*(?:<([^>\n]+)>|([^\s)<]+))(?:\s+(?:"[^"\n]*"|'[^'\n]*'|\([^)\n]*\)))?\s*\)/gi
const localImagePathPattern = new RegExp(
  `(?:(?<![A-Za-z0-9])(?:file:\\/\\/|[A-Za-z]:[\\\\/])|(?<![:/])\\/)[^<>"'\\u0060，。；：、\\n]*?\\.${imageExtensionSource}(?=$|[\\s<>"'\\u0060，。；：、,;:!?)\\]])`,
  "gi",
)
const exactLocalImagePathPattern = new RegExp(
  `^(?:file:\\/\\/|\\/|[A-Za-z]:[\\\\/]).*?\\.${imageExtensionSource}$`,
  "i",
)

function fenceStart(line: string): { character: "`" | "~"; length: number } | null {
  const match = /^(?: {0,3})(`{3,}|~{3,})/.exec(line)
  const marker = match?.[1]
  if (!marker) {
    return null
  }
  return { character: marker[0] as "`" | "~", length: marker.length }
}

function isFenceEnd(line: string, fence: { character: "`" | "~"; length: number }): boolean {
  const marker = fence.character.repeat(fence.length)
  return new RegExp(`^ {0,3}${marker}${fence.character}*\\s*$`).test(line)
}

function mapInlineCode(
  markdown: string,
  transform: (prose: string) => string,
  visitCode?: (code: string) => void,
): string {
  let result = ""
  let cursor = 0
  while (cursor < markdown.length) {
    const open = markdown.indexOf("`", cursor)
    if (open < 0) {
      return result + transform(markdown.slice(cursor))
    }
    let markerLength = 1
    while (markdown[open + markerLength] === "`") {
      markerLength += 1
    }
    const marker = "`".repeat(markerLength)
    let close = open + markerLength
    while (close < markdown.length) {
      close = markdown.indexOf(marker, close)
      if (close < 0) {
        return result + transform(markdown.slice(cursor))
      }
      if (markdown[close - 1] !== "`" && markdown[close + markerLength] !== "`") {
        break
      }
      close += markerLength
    }
    result += transform(markdown.slice(cursor, open))
    const codeEnd = close + markerLength
    const code = markdown.slice(open + markerLength, close)
    visitCode?.(code)
    result += markdown.slice(open, codeEnd)
    cursor = codeEnd
  }
  return result
}

function mapMarkdownBlocks(markdown: string, transform: (prose: string) => string): string {
  const lines = markdown.match(/.*(?:\r?\n|$)/g)?.filter(Boolean) ?? []
  let result = ""
  let prose = ""
  let fence: { character: "`" | "~"; length: number } | null = null
  const flushProse = (): void => {
    if (prose) {
      result += transform(prose)
      prose = ""
    }
  }

  for (const line of lines) {
    if (fence) {
      result += line
      if (isFenceEnd(line.replace(/\r?\n$/, ""), fence)) {
        fence = null
      }
      continue
    }
    const nextFence = fenceStart(line)
    if (nextFence) {
      flushProse()
      result += line
      fence = nextFence
      continue
    }
    if (/^(?: {4}|\t)/.test(line)) {
      flushProse()
      result += line
      continue
    }
    prose += line
  }
  flushProse()
  return result
}

/** 只变换 Markdown 正文，跳过 fenced、indented 与 inline code。 */
export function mapMarkdownProse(markdown: string, transform: (prose: string) => string): string {
  return mapMarkdownBlocks(markdown, (prose) => mapInlineCode(prose, transform))
}

function normalizeLocalImageProse(markdown: string): string {
  return markdown.replace(localMarkdownImagePattern, (match, alt: string, path: string, title?: string) => {
    const trimmedPath = path.trim()
    if (!/\s/.test(trimmedPath)) {
      return match
    }
    return `![${alt}](<${trimmedPath}>${title ?? ""})`
  })
}

export function normalizeLocalImageMarkdown(markdown: string): string {
  return mapMarkdownProse(markdown, normalizeLocalImageProse)
}

export function extractMarkdownImageSources(markdown: string): string[] {
  const sources: string[] = []
  mapMarkdownProse(normalizeLocalImageMarkdown(markdown), (prose) => {
    for (const match of prose.matchAll(markdownImagePattern)) {
      const source = (match[1] ?? match[2] ?? "").trim()
      if (source) {
        sources.push(source)
      }
    }
    return prose
  })
  return sources
}

export function extractLocalImagePaths(markdown: string): string[] {
  const paths: string[] = []
  const appendMatches = (prose: string): string => {
    const localOnlyProse = prose.replace(/https?:\/\/[^\s<>"'`，。；：、]+/gi, "")
    for (const match of localOnlyProse.matchAll(localImagePathPattern)) {
      const candidate = match[0]?.trim()
      if (candidate && !paths.includes(candidate)) {
        paths.push(candidate)
      }
    }
    return prose
  }
  mapMarkdownBlocks(markdown, (prose) =>
    mapInlineCode(prose, appendMatches, (code) => {
      const candidate = code.trim()
      if (exactLocalImagePathPattern.test(candidate) && !paths.includes(candidate)) {
        paths.push(candidate)
      }
    }),
  )
  return paths
}
