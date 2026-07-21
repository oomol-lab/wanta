import { franc } from "franc-min"

export type DetectedResponseLanguage = "English" | "Simplified Chinese"

const chineseInstructionPattern =
  /请|帮|分析|总结|查看|查找|搜索|获取|创建|生成|写|解释|比较|翻译|下载|上传|发送|更新|删除|添加|移除|过去|最近|怎么|如何|什么/u
const englishInstructionPattern =
  /\b(?:analy[sz]e|answer|calculate|check|compare|create|draft|explain|extract|fetch|find|generate|get|help|identify|list|make|prepare|produce|provide|report|review|search|show|summari[sz]e|tell|translate|write)\b|\bI\s+(?:need|want|would like)\b|\b(?:can|could|would)\s+you\b/iu
const preamblePattern = /^(?:background|context|data|example|input|note|reference|source)\s*[:：]?$/iu

function removeExcludedContent(text: string): string {
  return text
    .replace(/```[\s\S]*?```/gu, " ")
    .replace(/`[^`\r\n]*`/gu, " ")
    .replace(/https?:\/\/\S+/giu, " ")
    .replace(/\b[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}\b/gu, " ")
    .replace(/(?:^|\s)(?:~|\.{0,2})?\/(?:[^\s/]+\/)*[^\s]*/gu, " ")
    .replace(/(?:^|\s)[A-Za-z]:\\(?:[^\s\\]+\\)*[^\s]*/gu, " ")
}

function latinWords(text: string): string[] {
  return text.toLocaleLowerCase("en").match(/[a-z]+(?:['’-][a-z]+)*/gu) ?? []
}

function isInstructionBearing(text: string): boolean {
  return chineseInstructionPattern.test(text) || englishInstructionPattern.test(text)
}

function colonInstruction(line: string): string {
  const separator = line.search(/[:：]/u)
  if (separator < 0) return line
  const before = line.slice(0, separator).trim()
  const after = line.slice(separator + 1).trim()
  if (isInstructionBearing(before)) return before
  if (isInstructionBearing(after)) return after
  return line
}

function instructionExcerpt(text: string): string {
  const lines = removeExcludedContent(text)
    .split(/\r?\n/u)
    .map((line) => (/^\s*>/u.test(line) ? "" : line.trim()))
    .filter((line) => line && !preamblePattern.test(line))
  const instructionLines = lines.map(colonInstruction).filter(isInstructionBearing)
  return instructionLines.at(-1) ?? lines.at(-1) ?? ""
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
  const words = latinWords(excerpt)

  if (kanaCount === 0 && hanCount >= 2 && (chineseInstructionPattern.test(excerpt) || hanCount >= 8)) {
    return "Simplified Chinese"
  }
  if (hanCount === 0 && words.length >= 3 && (englishInstructionPattern.test(excerpt) || franc(excerpt) === "eng")) {
    return "English"
  }
  return undefined
}
