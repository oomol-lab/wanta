export const DEFAULT_MAX_OUTPUT_TOKENS = 32_000
export const QWEN_37_MAX_OUTPUT_TOKENS = 65_536
export const COMPACTION_RESERVED_BUFFER_TOKENS = 20_000
export const STANDARD_INPUT_TOKEN_LIMIT_TOKENS = 256_000

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
  const inputLimit = positiveNumber(inputTokenLimit)
  const limit = inputLimit ?? positiveNumber(contextWindow)
  if (!limit) {
    return undefined
  }
  const outputLimit = effectiveMaxOutputTokens(maxOutputTokens)
  // Keep this aligned with OpenCode session/overflow.ts: explicit input limits reserve up to 20K,
  // while context-only models reserve the full configured output budget.
  const reserved = inputLimit ? Math.min(COMPACTION_RESERVED_BUFFER_TOKENS, outputLimit) : outputLimit
  return Math.max(0, limit - reserved)
}
