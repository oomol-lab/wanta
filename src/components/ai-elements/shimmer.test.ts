import * as React from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it } from "vitest"
import { Shimmer } from "./shimmer.tsx"

describe("Shimmer", () => {
  it("uses a bright shimmer highlight instead of the page background", () => {
    const html = renderToStaticMarkup(
      React.createElement(
        Shimmer,
        { as: "span", className: "min-w-0 truncate" } as React.ComponentProps<typeof Shimmer>,
        "Loading",
      ),
    )

    expect(html).toContain("text-transparent")
    expect(html).toContain("truncate")
    expect(html).toContain("bg-[length:250%_100%,auto]")
    expect(html).toContain("[background-repeat:no-repeat,padding-box]")
    expect(html).toContain("var(--shimmer-highlight)")
    expect(html).toContain("color-mix(in oklab, var(--color-foreground) 35%, white)")
    expect(html).toContain("var(--bg), linear-gradient(var(--color-muted-foreground), var(--color-muted-foreground))")
  })
})
