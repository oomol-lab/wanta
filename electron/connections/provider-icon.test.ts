import { describe, expect, it } from "vitest"
import { normalizeProviderIconPosition, normalizeProviderIconSprite } from "./provider-icon.ts"
import { mergeConnectionSummary } from "./summary.ts"

const sprite = {
  version: "v1",
  pixelRatio: 2,
  iconSize: 64,
  bleed: 2,
  width: 256,
  height: 128,
  lightUrl: "https://example.com/light.png",
  darkUrl: "https://example.com/dark.png",
}

describe("provider sprite metadata", () => {
  it("maps the shared descriptor and per-provider coordinates while preserving legacy icons", () => {
    const result = mergeConnectionSummary({
      apps: [],
      providerMeta: { iconSprite: sprite },
      providers: [
        { service: "github", iconSpritePosition: { x: 66, y: 2 } },
        { service: "legacy", iconUrl: "https://example.com/legacy.png" },
      ],
    })
    expect(result.providers[0]).toMatchObject({ iconSprite: sprite, iconSpritePosition: { x: 66, y: 2 } })
    expect(result.providers[1].iconUrl).toBe("https://example.com/legacy.png")
    expect(result.providers[1].iconSpritePosition).toBeUndefined()
    expect(
      mergeConnectionSummary({ apps: [], providers: [{ service: "legacy" }] }).providers[0].iconSprite,
    ).toBeUndefined()
  })

  it.each([
    { width: 0 },
    { height: Number.NaN },
    { iconSize: 300 },
    { pixelRatio: -1 },
    { bleed: -1 },
    { version: "" },
    { lightUrl: "javascript:alert(1)" },
    { darkUrl: "https://user:pass@example.com/image" },
  ])("ignores malformed descriptors: %j", (overrides) => {
    expect(normalizeProviderIconSprite({ ...sprite, ...overrides })).toBeUndefined()
  })

  it.each([
    { x: -1, y: 0 },
    { x: 193, y: 0 },
    { x: 0, y: 65 },
    { x: 0, y: Infinity },
    { x: "0", y: 0 },
  ])("rejects coordinates outside the sheet: %j", (position) => {
    expect(normalizeProviderIconPosition(position, sprite)).toBeUndefined()
  })
})
