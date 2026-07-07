import assert from "node:assert/strict"
import { test } from "vitest"
import {
  COMPACTION_RESERVED_BUFFER_TOKENS,
  DEFAULT_MAX_OUTPUT_TOKENS,
  compactionThresholdTokens,
  contextLimitTokens,
  effectiveMaxOutputTokens,
} from "./limits.ts"

test("effectiveMaxOutputTokens falls back for missing or invalid values", () => {
  assert.equal(effectiveMaxOutputTokens(undefined), DEFAULT_MAX_OUTPUT_TOKENS)
  assert.equal(effectiveMaxOutputTokens(0), DEFAULT_MAX_OUTPUT_TOKENS)
  assert.equal(effectiveMaxOutputTokens(-1), DEFAULT_MAX_OUTPUT_TOKENS)
  assert.equal(effectiveMaxOutputTokens(Number.NaN), DEFAULT_MAX_OUTPUT_TOKENS)
  assert.equal(effectiveMaxOutputTokens(Number.POSITIVE_INFINITY), DEFAULT_MAX_OUTPUT_TOKENS)
  assert.equal(effectiveMaxOutputTokens(4096), 4096)
})

test("contextLimitTokens prefers input limits over context windows", () => {
  assert.equal(contextLimitTokens({ contextWindow: 200_000, inputTokenLimit: 128_000 }), 128_000)
  assert.equal(contextLimitTokens({ contextWindow: 200_000 }), 200_000)
  assert.equal(contextLimitTokens({ inputTokenLimit: 64_000 }), 64_000)
  assert.equal(contextLimitTokens({}), undefined)
  assert.equal(contextLimitTokens({ contextWindow: 0, inputTokenLimit: -1 }), undefined)
  assert.equal(contextLimitTokens({ contextWindow: Number.NaN, inputTokenLimit: Number.POSITIVE_INFINITY }), undefined)
})

test("compactionThresholdTokens reserves output budget and clamps at zero", () => {
  assert.equal(compactionThresholdTokens({}), undefined)
  assert.equal(compactionThresholdTokens({ contextWindow: 200_000 }), 200_000 - COMPACTION_RESERVED_BUFFER_TOKENS)
  assert.equal(
    compactionThresholdTokens({ contextWindow: 200_000, inputTokenLimit: 128_000 }),
    128_000 - COMPACTION_RESERVED_BUFFER_TOKENS,
  )
  assert.equal(compactionThresholdTokens({ contextWindow: 200_000, maxOutputTokens: 4096 }), 195_904)
  assert.equal(compactionThresholdTokens({ contextWindow: 10_000 }), 0)
  assert.equal(compactionThresholdTokens({ contextWindow: 10_000, maxOutputTokens: 0 }), 0)
})
