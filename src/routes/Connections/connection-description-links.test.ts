import type { ConnectionDescriptionSegment } from "./connection-description-links.ts"

import { describe, expect, it } from "vitest"
import { connectionDescriptionSegments } from "./connection-description-links.ts"

function urls(segments: ConnectionDescriptionSegment[]): string[] {
  return segments.filter((segment) => segment.kind === "url").map((segment) => segment.value)
}

function reconstructedText(segments: ConnectionDescriptionSegment[]): string {
  return segments.map((segment) => segment.value).join("")
}

describe("connectionDescriptionSegments", () => {
  it("keeps the sentence period out of the AccuWeather URL", () => {
    const text = "Sign in to the developer portal: https://developer.accuweather.com/subscriptions."
    const segments = connectionDescriptionSegments(text)

    expect(urls(segments)).toEqual(["https://developer.accuweather.com/subscriptions"])
    expect(segments.at(-1)).toEqual({ kind: "text", value: "." })
    expect(reconstructedText(segments)).toBe(text)
  })

  it.each([
    [".", "."],
    [",", ","],
    [";", ";"],
    [":", ":"],
    ["!", "!"],
    ["?", "?"],
    ["。", "。"],
    ["，", "，"],
    ["；", "；"],
    ["：", "："],
    ["！", "！"],
    ["？", "？"],
  ])("keeps trailing %s punctuation as text", (punctuation, expectedText) => {
    const text = `See https://example.com/docs${punctuation}`
    const segments = connectionDescriptionSegments(text)

    expect(urls(segments)).toEqual(["https://example.com/docs"])
    expect(segments.at(-1)).toEqual({ kind: "text", value: expectedText })
    expect(reconstructedText(segments)).toBe(text)
  })

  it.each([
    ["See (https://example.com/docs).", "https://example.com/docs"],
    ["See [https://example.com/docs].", "https://example.com/docs"],
    ["See {https://example.com/docs}.", "https://example.com/docs"],
    ["See “https://example.com/docs”.", "https://example.com/docs"],
    ["请查看（https://example.com/docs）。", "https://example.com/docs"],
  ])("keeps prose delimiters outside the URL in %s", (text, expectedUrl) => {
    const segments = connectionDescriptionSegments(text)

    expect(urls(segments)).toEqual([expectedUrl])
    expect(reconstructedText(segments)).toBe(text)
  })

  it("preserves balanced delimiters that belong to the URL", () => {
    const text = "See https://example.com/Function_(mathematics) and https://example.com/docs/[advanced]."
    const segments = connectionDescriptionSegments(text)

    expect(urls(segments)).toEqual([
      "https://example.com/Function_(mathematics)",
      "https://example.com/docs/[advanced]",
    ])
    expect(reconstructedText(segments)).toBe(text)
  })

  it("preserves ports, queries, fragments, and multiple URLs", () => {
    const text = "Use https://example.com:8443/docs?tab=api#keys, then visit http://localhost:3000/setup."
    const segments = connectionDescriptionSegments(text)

    expect(urls(segments)).toEqual(["https://example.com:8443/docs?tab=api#keys", "http://localhost:3000/setup"])
    expect(reconstructedText(segments)).toBe(text)
  })

  it("leaves unsupported and malformed URL text untouched", () => {
    const text = "Use ftp://example.com or https:// when configuring the provider."
    const segments = connectionDescriptionSegments(text)

    expect(urls(segments)).toEqual([])
    expect(segments).toEqual([{ kind: "text", value: text }])
  })

  it("returns plain text unchanged when it contains no URL", () => {
    const text = "Copy the API key from the provider dashboard."

    expect(connectionDescriptionSegments(text)).toEqual([{ kind: "text", value: text }])
  })
})
