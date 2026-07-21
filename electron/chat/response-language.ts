export type DetectedResponseLanguage = "English" | "Simplified Chinese"

const englishInstructionWords = new Set([
  "about",
  "analyze",
  "and",
  "can",
  "check",
  "compare",
  "create",
  "days",
  "explain",
  "fetch",
  "find",
  "for",
  "from",
  "generate",
  "get",
  "help",
  "how",
  "in",
  "into",
  "last",
  "list",
  "make",
  "me",
  "my",
  "of",
  "on",
  "past",
  "please",
  "review",
  "search",
  "show",
  "summarise",
  "summarize",
  "the",
  "these",
  "this",
  "to",
  "translate",
  "what",
  "which",
  "with",
  "write",
  "you",
])

const chineseInstructionPattern =
  /请|帮|分析|总结|查看|查找|搜索|获取|创建|生成|写|解释|比较|翻译|下载|上传|发送|更新|删除|添加|移除|过去|最近|怎么|如何|什么/u

function instructionExcerpt(text: string): string {
  const withoutCode = text.replace(/```[\s\S]*?```/gu, " ").trim()
  const firstLine =
    withoutCode
      .split(/\r?\n/u)
      .find((line) => line.trim())
      ?.trim() ?? ""
  const separator = firstLine.search(/[:：]/u)
  return separator >= 6 ? firstLine.slice(0, separator) : firstLine
}

/**
 * Detect only high-confidence English and Simplified Chinese instructions. Other
 * languages and short language-neutral replies deliberately remain unresolved.
 */
export function detectResponseLanguage(text: string): DetectedResponseLanguage | undefined {
  const excerpt = instructionExcerpt(text)
  if (!excerpt) return undefined

  const hanCount = excerpt.match(/\p{Script=Han}/gu)?.length ?? 0
  const kanaCount = excerpt.match(/[\p{Script=Hiragana}\p{Script=Katakana}]/gu)?.length ?? 0
  const latinWords = excerpt.toLocaleLowerCase("en").match(/[a-z]+(?:['’-][a-z]+)*/gu) ?? []
  const englishSignalCount = latinWords.filter((word) => englishInstructionWords.has(word)).length

  if (kanaCount === 0 && hanCount >= 2 && (chineseInstructionPattern.test(excerpt) || hanCount >= 8)) {
    return "Simplified Chinese"
  }
  if (hanCount === 0 && latinWords.length >= 4 && englishSignalCount >= 2) {
    return "English"
  }
  return undefined
}
