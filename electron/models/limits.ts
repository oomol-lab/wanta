export const DEFAULT_MAX_OUTPUT_TOKENS = 32_000
export const COMPACTION_RESERVED_BUFFER_TOKENS = 20_000

function positiveNumber(value: number | undefined): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : undefined
}

export function effectiveMaxOutputTokens(maxOutputTokens: number | undefined): number {
  return positiveNumber(maxOutputTokens) ?? DEFAULT_MAX_OUTPUT_TOKENS
}

export function contextLimitTokens({
  contextWindow,
  inputTokenLimit,
}: {
  contextWindow?: number
  inputTokenLimit?: number
}): number | undefined {
  return positiveNumber(inputTokenLimit) ?? positiveNumber(contextWindow)
}

export function compactionThresholdTokens({
  contextWindow,
  inputTokenLimit,
  maxOutputTokens,
}: {
  contextWindow?: number
  inputTokenLimit?: number
  maxOutputTokens?: number
}): number | undefined {
  const limit = contextLimitTokens({ contextWindow, inputTokenLimit })
  if (!limit) {
    return undefined
  }
  const reserved = Math.min(COMPACTION_RESERVED_BUFFER_TOKENS, effectiveMaxOutputTokens(maxOutputTokens))
  return Math.max(0, limit - reserved)
}
