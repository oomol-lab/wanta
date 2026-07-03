import { describe, expect, it } from "vitest"
import { buildDailySpendBuckets, usageCategory } from "./usage.ts"

describe("billing usage helpers", () => {
  it("spreads total spend across daily buckets when the stats response has no daily items", () => {
    const buckets = buildDailySpendBuckets([], 30, 19.47)

    expect(buckets).toHaveLength(30)
    expect(buckets.every((bucket) => bucket.credit > 0)).toBe(true)
    expect(buckets.every((bucket) => bucket.estimated)).toBe(true)
    expect(sumCredits(buckets)).toBeCloseTo(19.47)
  })

  it("uses bucketed daily values instead of the fallback total when dated items exist", () => {
    const now = Date.now()
    const buckets = buildDailySpendBuckets(
      [
        {
          source: "SERVICE_LLM",
          subject: "oopilot",
          time: now,
          totalCredit: "6.05",
          eventCount: 1,
        },
      ],
      30,
      19.47,
    )

    expect(sumCredits(buckets)).toBeCloseTo(6.05)
    expect(buckets.filter((bucket) => bucket.credit > 0)).toHaveLength(1)
    expect(buckets.some((bucket) => bucket.estimated)).toBe(false)
  })

  it("accepts string date fields from stats items", () => {
    const buckets = buildDailySpendBuckets(
      [
        {
          source: "SERVICE_FUSION_API",
          subject: "image",
          time: 0,
          date: new Date().toISOString(),
          totalCredit: "12.98",
        } as never,
      ],
      30,
    )

    expect(sumCredits(buckets)).toBeCloseTo(12.98)
    expect(buckets.some((bucket) => bucket.estimated)).toBe(false)
  })

  it("classifies spend by user-facing billing buckets", () => {
    expect(usageCategory("SERVICE_LLM", "oopilot")).toBe("model")
    expect(usageCategory("SERVICE_FUSION_API", "tts")).toBe("api")
    expect(usageCategory("SERVICE_AUTH_LINK", "google_sheets.read")).toBe("link")
    expect(usageCategory("SERVICE_OOMOL_CONNECTOR", "hubspot.search")).toBe("link")
    expect(usageCategory("SERVICE_OTHER", "auth_link")).toBe("link")
    expect(usageCategory("SERVICE_OTHER", "shared_link.create")).toBe("link")
    expect(usageCategory("SERVICE_OTHER", "oauth_token")).toBe("link")
  })
})

function sumCredits(buckets: Array<{ credit: number }>): number {
  return buckets.reduce((sum, bucket) => sum + bucket.credit, 0)
}
