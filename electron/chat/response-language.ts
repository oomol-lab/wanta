import type { appLocales } from "../app-locale.ts"

import { francAll } from "franc-min"

export type DetectedResponseLanguage = (typeof appLocales)[keyof typeof appLocales]["language"]

const chineseInstructionPattern =
  /请|請|帮|幫|分析|总结|總結|查看|查找|搜索|获取|獲取|创建|建立|生成|写|寫|解释|解釋|比较|比較|翻译|翻譯|下载|下載|上传|上傳|发送|發送|更新|删除|刪除|添加|移除|过去|過去|最近|怎么|怎麼|如何|什么|什麼/u
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
  return (
    chineseInstructionPattern.test(text) ||
    englishInstructionPattern.test(text) ||
    /ください|して|해주세요|하세요|(?:analysez|résumez|expliquez|créez|analiza|resume|explica|crea|проанализируй|объясни|создай)/iu.test(
      text,
    )
  )
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

/** Classify only substantive, high-confidence instructions; uncertain text stays unresolved. */
export function detectResponseLanguage(text: string): DetectedResponseLanguage | undefined {
  const excerpt = instructionExcerpt(text)
  if (!excerpt) return undefined
  const kanaCount = excerpt.match(/[\p{Script=Hiragana}\p{Script=Katakana}]/gu)?.length ?? 0
  const hangulCount = excerpt.match(/\p{Script=Hangul}/gu)?.length ?? 0
  if (kanaCount >= 3) return "Japanese"
  if (hangulCount >= 4) return "Korean"
  const hanCount = excerpt.match(/\p{Script=Han}/gu)?.length ?? 0
  if (hanCount >= 2 && (chineseInstructionPattern.test(excerpt) || hanCount >= 8)) {
    const traditional = /[請幫總結獲創寫釋較譯載傳發刪過麼這個為與體臺灣檔裡後頁設開關顯權應訊務據]/u.test(excerpt)
    const simplified = /[请帮总结获创写释较译载传发删过么这个为与体台湾档里后页设开关显权应讯务据]/u.test(excerpt)
    if (traditional && !simplified) return "Traditional Chinese"
    if (simplified && !traditional) return "Simplified Chinese"
    return undefined
  }
  if (latinWords(excerpt).length < 3 && (excerpt.match(/\p{Script=Cyrillic}/gu)?.length ?? 0) < 12) return undefined
  if (
    /\b(?:I (?:need|want|would like)|(?:can|could|would) you|please (?:help|review|summarize|explain|check|write))\b/iu.test(
      excerpt,
    )
  )
    return "English"
  if (/\b(?:analysez|résumez|expliquez|veuillez|s’il vous plaît)\b/iu.test(excerpt)) return "French"
  if (/(?:^|\s)(?:проанализируй(?:те)?|объясни(?:те)?|создай(?:те)?|пожалуйста|напиши(?:те)?)(?:\s|$)/iu.test(excerpt))
    return "Russian"
  const ranked = francAll(excerpt)
  const first = ranked[0]
  if (!first || first[0] === "und" || (ranked[1] && first[1] - ranked[1][1] < 0.05)) return undefined
  const languages: Record<string, DetectedResponseLanguage> = {
    eng: "English",
    fra: "French",
    spa: "Spanish",
    rus: "Russian",
  }
  // English action words are not decisive: other languages also use words such as “resume”.
  return languages[first[0]]
}
