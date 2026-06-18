import * as React from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { afterEach, describe, expect, it, vi } from "vitest"
import { clampShimmerSpread, Shimmer } from "./shimmer.tsx"

const motionMocks = vi.hoisted(() => ({
  useReducedMotion: vi.fn(() => false),
}))

vi.mock("motion/react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("motion/react")>()
  return {
    ...actual,
    useReducedMotion: motionMocks.useReducedMotion,
  }
})

function htmlAttribute(html: string, name: string): string {
  const match = html.match(new RegExp(`${name}="([^"]*)"`))
  if (!match) {
    throw new Error(`Missing ${name} attribute in rendered HTML.`)
  }
  return match[1]
}

describe("Shimmer", () => {
  afterEach(() => {
    motionMocks.useReducedMotion.mockClear()
    motionMocks.useReducedMotion.mockReturnValue(false)
  })

  it("uses a near-white shimmer highlight over muted text", () => {
    const html = renderToStaticMarkup(
      React.createElement(
        Shimmer,
        { as: "span", className: "min-w-0 truncate" } as React.ComponentProps<typeof Shimmer>,
        "Loading",
      ),
    )
    const classNames = new Set(htmlAttribute(html, "class").split(/\s+/))
    const style = htmlAttribute(html, "style")

    expect(classNames.has("text-transparent")).toBe(true)
    expect(classNames.has("truncate")).toBe(true)
    expect(classNames.has("bg-[length:250%_100%,auto]")).toBe(true)
    expect(classNames.has("[background-repeat:no-repeat,padding-box]")).toBe(true)
    expect([...classNames].some((className) => className.includes("var(--shimmer-highlight)"))).toBe(true)
    expect(style).toContain("--spread:32px")
    expect(style).toContain("--shimmer-highlight:color-mix(in oklab, var(--color-background) 12%, white)")
    expect(style).toContain(
      "background-image:var(--bg), linear-gradient(var(--color-muted-foreground), var(--color-muted-foreground))",
    )
  })

  it("keeps the shimmer band within a consistent visual range", () => {
    expect(clampShimmerSpread(-1)).toBe(18)
    expect(clampShimmerSpread(32)).toBe(32)
    expect(clampShimmerSpread(200)).toBe(56)
    expect(clampShimmerSpread(Number.NaN)).toBe(32)
  })

  it("prefers static text style when reduced motion is enabled", () => {
    motionMocks.useReducedMotion.mockReturnValue(true)
    const html = renderToStaticMarkup(
      React.createElement(
        Shimmer,
        { as: "span", className: "min-w-0 truncate" } as React.ComponentProps<typeof Shimmer>,
        "Loading",
      ),
    )
    const classNames = new Set(htmlAttribute(html, "class").split(/\s+/))

    expect(classNames.has("text-muted-foreground")).toBe(true)
    expect(classNames.has("text-transparent")).toBe(false)
    expect(html.includes("--spread")).toBe(false)
    expect(html.includes("--shimmer-highlight")).toBe(false)
  })
})
