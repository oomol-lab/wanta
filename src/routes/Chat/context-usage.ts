import type { ChatMessage, ChatTokenUsage } from "../../../electron/chat/common.ts"
import type { ModelCatalog } from "../../../electron/models/common.ts"

import { compactionThresholdTokens, contextLimitTokens } from "../../../electron/models/limits.ts"

export interface ContextUsageInfo {
  usedTokens: number
  contextWindowTokens?: number
  inputLimitTokens?: number
  limitTokens?: number
  limitKind?: "compaction" | "context"
  maxOutputTokens?: number
  compactionThresholdTokens?: number
  percent?: number
}

export interface ContextUsageBudget {
  contextWindowTokens?: number
  inputLimitTokens?: number
  contextLimitTokens?: number
  maxOutputTokens?: number
  compactionThresholdTokens?: number
}

function positiveNumber(value: number | undefined): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : 0
}

export function contextTokensFromUsage(usage: ChatTokenUsage): number {
  const total = positiveNumber(usage.total)
  if (total > 0) {
    return total
  }
  return (
    positiveNumber(usage.input) +
    positiveNumber(usage.output) +
    positiveNumber(usage.cache.read) +
    positiveNumber(usage.cache.write)
  )
}

export function latestContextTokenUsage(messages: ChatMessage[]): ChatTokenUsage | undefined {
  return messages.findLast((message) => message.role === "assistant" && message.tokenUsage)?.tokenUsage
}

export function selectedModelContextBudget(catalog: ModelCatalog | null): ContextUsageBudget | undefined {
  if (!catalog) {
    return undefined
  }
  const model =
    catalog.selected.kind === "custom"
      ? catalog.customModels.find((item) => item.id === catalog.selected.id)
      : catalog.builtins.find((item) => item.id === catalog.selected.id)
  if (!model) {
    return undefined
  }
  const contextLimit = contextLimitTokens({
    contextWindow: model.contextWindow,
    inputTokenLimit: model.inputTokenLimit,
  })
  const threshold = compactionThresholdTokens({
    contextWindow: model.contextWindow,
    inputTokenLimit: model.inputTokenLimit,
    maxOutputTokens: model.maxOutputTokens,
  })
  return {
    ...(model.contextWindow ? { contextWindowTokens: model.contextWindow } : {}),
    ...(model.inputTokenLimit ? { inputLimitTokens: model.inputTokenLimit } : {}),
    ...(contextLimit ? { contextLimitTokens: contextLimit } : {}),
    ...(model.maxOutputTokens ? { maxOutputTokens: model.maxOutputTokens } : {}),
    ...(threshold !== undefined ? { compactionThresholdTokens: threshold } : {}),
  }
}

export function selectedModelContextWindow(catalog: ModelCatalog | null): number | undefined {
  return selectedModelContextBudget(catalog)?.contextLimitTokens
}

export function buildContextUsageInfo(messages: ChatMessage[], catalog: ModelCatalog | null): ContextUsageInfo | null {
  const budget = selectedModelContextBudget(catalog)
  const usage = latestContextTokenUsage(messages)
  const usedTokens = usage ? contextTokensFromUsage(usage) : 0
  if (!budget?.contextLimitTokens && usedTokens === 0) {
    return null
  }
  const limitTokens = budget?.compactionThresholdTokens ?? budget?.contextLimitTokens
  const percent =
    limitTokens === undefined
      ? undefined
      : limitTokens <= 0
        ? usedTokens > 0
          ? 100
          : 0
        : Math.min(100, Math.max(0, Math.round((usedTokens / limitTokens) * 100)))
  return {
    usedTokens,
    ...(budget?.contextWindowTokens ? { contextWindowTokens: budget.contextWindowTokens } : {}),
    ...(budget?.inputLimitTokens ? { inputLimitTokens: budget.inputLimitTokens } : {}),
    ...(limitTokens === undefined ? {} : { limitTokens }),
    ...(budget?.maxOutputTokens ? { maxOutputTokens: budget.maxOutputTokens } : {}),
    ...(budget?.compactionThresholdTokens !== undefined
      ? { compactionThresholdTokens: budget.compactionThresholdTokens, limitKind: "compaction" as const }
      : limitTokens !== undefined
        ? { limitKind: "context" as const }
        : {}),
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
