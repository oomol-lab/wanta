import type { ChatMessage, ChatTokenUsage } from "../../../electron/chat/common.ts"
import type { ModelCatalog } from "../../../electron/models/common.ts"

export interface ContextUsageInfo {
  usedTokens: number
  limitTokens?: number
  percent?: number
}

function positiveNumber(value: number | undefined): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : 0
}

export function contextTokensFromUsage(usage: ChatTokenUsage): number {
  return (
    positiveNumber(usage.input) +
    positiveNumber(usage.output) +
    positiveNumber(usage.reasoning) +
    positiveNumber(usage.cache.read) +
    positiveNumber(usage.cache.write)
  )
}

export function latestContextTokenUsage(messages: ChatMessage[]): ChatTokenUsage | undefined {
  return messages.findLast((message) => message.role === "assistant" && message.tokenUsage)?.tokenUsage
}

export function selectedModelContextWindow(catalog: ModelCatalog | null): number | undefined {
  if (!catalog) {
    return undefined
  }
  if (catalog.selected.kind !== "builtin") {
    return undefined
  }
  return catalog.builtins.find((model) => model.id === catalog.selected.id)?.contextWindow
}

export function buildContextUsageInfo(messages: ChatMessage[], catalog: ModelCatalog | null): ContextUsageInfo | null {
  const limitTokens = selectedModelContextWindow(catalog)
  const usage = latestContextTokenUsage(messages)
  const usedTokens = usage ? contextTokensFromUsage(usage) : 0
  if (!limitTokens && usedTokens === 0) {
    return null
  }
  const percent = limitTokens ? Math.min(100, Math.max(0, Math.round((usedTokens / limitTokens) * 100))) : undefined
  return {
    usedTokens,
    ...(limitTokens ? { limitTokens } : {}),
    ...(percent === undefined ? {} : { percent }),
  }
}

export function formatTokenCount(value: number): string {
  const rounded = Math.max(0, Math.round(value))
  if (rounded >= 1_000_000) {
    return `${formatCompactNumber(rounded / 1_000_000)}M`
  }
  if (rounded >= 1_000) {
    const thousands = formatCompactNumber(rounded / 1_000)
    return thousands === "1000" ? "1M" : `${thousands}K`
  }
  return String(rounded)
}

function formatCompactNumber(value: number): string {
  const fixed = value >= 10 ? value.toFixed(0) : value.toFixed(1)
  return fixed.replace(/\.0$/, "")
}
