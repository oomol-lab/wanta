const maxMermaidSourceLength = 30_000
const mermaidDirectivePattern = /%%\s*\{\s*(?:config|init)\s*:/iu
const mermaidClickPattern = /^\s*click\s+/imu
const mermaidPresentationDirectivePattern = /^\s*(?:classDef|linkStyle|style)\b.*(?:\r?\n|$)/gimu
const mermaidFencePattern =
  /(^|\n)([ \t]{0,3})(`{3,}|~{3,})([ \t]*mermaid(?:[ \t]+[^\r\n]*)?)(\r?\n)([\s\S]*?)(\r?\n)([ \t]*\3[ \t]*)(?=\n|$)/gi

function typographicQuotes(value: string): string {
  let opening = true
  return value.replace(/"/g, () => {
    const quote = opening ? "“" : "”"
    opening = !opening
    return quote
  })
}

function normalizeVisibleLabel(value: string): string {
  const leadingWhitespace = value.match(/^\s*/)?.[0] ?? ""
  const trailingWhitespace = value.match(/\s*$/)?.[0] ?? ""
  const trimmed = value.trim()
  if (trimmed.length >= 2 && trimmed.startsWith('"') && trimmed.endsWith('"')) {
    return `${leadingWhitespace}"${typographicQuotes(trimmed.slice(1, -1))}"${trailingWhitespace}`
  }
  return typographicQuotes(value)
}

/**
 * 只修正模型在可见标签中常见的排版字符，并移除会覆盖产品主题的展示指令。
 * 不猜测节点、箭头或关系，避免把语法修复变成不可预测的内容改写。
 */
export function normalizeMermaidSource(source: string): string {
  return source
    .replace(mermaidPresentationDirectivePattern, "")
    .split(/(\r?\n)/)
    .map((line) =>
      /^\r?\n$/.test(line)
        ? line
        : line
            .replace(/\|([^|\r\n]*)\|/g, (_match, label: string) => `|${normalizeVisibleLabel(label)}|`)
            .replace(/\[([^\]\r\n]*)\]/g, (_match, label: string) => `[${normalizeVisibleLabel(label)}]`),
    )
    .join("")
    .trimEnd()
}

/** 保持普通 Markdown 原样，仅规范化已经闭合的 Mermaid fenced block。 */
export function normalizeMermaidMarkdown(markdown: string): string {
  return markdown.replace(
    mermaidFencePattern,
    (
      _match,
      prefix: string,
      indent: string,
      fence: string,
      info: string,
      openingLineBreak: string,
      source: string,
      closingLineBreak: string,
      closingFence: string,
    ) =>
      `${prefix}${indent}${fence}${info}${openingLineBreak}${normalizeMermaidSource(source)}${closingLineBreak}${closingFence}`,
  )
}

export function mermaidParseErrorLine(error: string): number | null {
  const match = error.match(/parse error on line\s+(\d+)/iu)
  return match ? Number(match[1]) : null
}

export function isRetryableMermaidError(error: string): boolean {
  return /(?:failed to fetch|dynamically imported module|loading chunk|network error)/iu.test(error)
}

export function validateMermaidSource(source: string): void {
  if (source.length > maxMermaidSourceLength) {
    throw new Error("Mermaid source exceeds Wanta's rendering limit")
  }
  if (mermaidDirectivePattern.test(source)) {
    throw new Error("Mermaid configuration directives are not supported")
  }
  if (mermaidClickPattern.test(source)) {
    throw new Error("Mermaid click actions are not supported")
  }
}
