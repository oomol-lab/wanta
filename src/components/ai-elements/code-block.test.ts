import assert from "node:assert/strict"
import { describe, test } from "vitest"
import { tokenizedCodeStyle } from "./code-block.tsx"

describe("tokenizedCodeStyle", () => {
  test("keeps light colors and dark theme CSS variables from Shiki dual-theme output", () => {
    const style = tokenizedCodeStyle({
      bg: "#fff;--shiki-dark-bg:#24292e",
      fg: "#24292e;--shiki-dark:#e1e4e8",
    }) as Record<string, string>

    assert.equal(style.backgroundColor, "#fff")
    assert.equal(style.color, "#24292e")
    assert.equal(style["--shiki-dark-bg"], "#24292e")
    assert.equal(style["--shiki-dark"], "#e1e4e8")
  })
})
