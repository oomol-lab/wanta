import { describe, expect, it } from "vitest"
import { buildDailySpendBuckets, buildSubjectSummaries, formatCredit, formatPercent, usageCategory } from "./usage.ts"

describe("billing usage helpers", () => {
  it("does not invent daily spend when the stats response has no daily items", () => {
    const buckets = buildDailySpendBuckets([], 30, 19.47)

    expect(buckets).toHaveLength(30)
    expect(buckets.every((bucket) => bucket.credit === 0)).toBe(true)
    expect(buckets.every((bucket) => !bucket.estimated)).toBe(true)
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

  it("preserves non-zero sub-cent spend", () => {
    expect(formatCredit(0)).toBe("$0")
    expect(formatCredit(0.003)).toBe("<$0.01")
    expect(formatCredit(0.0372)).toBe("$0.04")
  })

  it("keeps small non-zero percentages visible", () => {
    expect(formatPercent(0)).toBe("0%")
    expect(formatPercent(0.03)).toBe("<0.1%")
    expect(formatPercent(0.318)).toBe("0.3%")
    expect(formatPercent(1.4)).toBe("1%")
  })

  it("preserves and merges current and legacy connector subject totals", () => {
    const summaries = buildSubjectSummaries(
      {
        items: [],
        sourceTotals: {},
        subjectTotals: {
          SERVICE_AUTH_LINK: {
            "service-google-sheets": { totalCredit: "0.03" },
          },
          SERVICE_OOMOL_CONNECTOR: {
            "service-google-sheets": { totalCredit: "0.01" },
          },
        },
        total: {},
      },
      {
        items: [],
        sourceTotals: {},
        subjectTotals: {
          SERVICE_OOMOL_CONNECTOR: {
            "service-google-sheets": { eventCount: 12, totalUsage: "24" },
          },
        },
        total: {},
      },
    )

    expect(summaries).toEqual([
      {
        appId: "google-sheets",
        category: "link",
        credit: 0.04,
        displayName: "Google Sheets",
        eventCount: 12,
        source: "SERVICE_OOMOL_CONNECTOR",
        subject: "google-sheets",
        subjects: ["service-google-sheets"],
        totalUsage: 24,
      },
    ])
  })

  it("uses the connection provider catalog to aggregate connector operation subjects by app", () => {
    const providers = [
      {
        displayName: "Google Sheets",
        iconUrl: "https://example.com/google-sheets.svg",
        service: "google-sheets",
      },
    ] as never
    const summaries = buildSubjectSummaries(
      {
        items: [],
        sourceTotals: {},
        subjectTotals: {
          SERVICE_OOMOL_CONNECTOR: {
            "google_sheets.read": { totalCredit: "0.02" },
            "google_sheets.write": { totalCredit: "0.03" },
          },
        },
        total: {},
      },
      {
        items: [],
        sourceTotals: {},
        subjectTotals: {
          SERVICE_OOMOL_CONNECTOR: {
            "google_sheets.read": { eventCount: 8 },
            "google_sheets.write": { eventCount: 2 },
          },
        },
        total: {},
      },
      providers,
    )

    expect(summaries).toEqual([
      {
        appId: "google-sheets",
        category: "link",
        credit: 0.05,
        displayName: "Google Sheets",
        eventCount: 10,
        iconUrl: "https://example.com/google-sheets.svg",
        source: "SERVICE_OOMOL_CONNECTOR",
        subject: "google-sheets",
        subjects: ["google_sheets.read", "google_sheets.write"],
        totalUsage: 0,
      },
    ])
  })
})

function sumCredits(buckets: Array<{ credit: number }>): number {
  return buckets.reduce((sum, bucket) => sum + bucket.credit, 0)
}
