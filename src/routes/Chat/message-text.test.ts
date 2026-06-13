import { describe, expect, it } from "vitest"
import { visibleUserText } from "./message-text.ts"

describe("visibleUserText", () => {
  it("strips OpenCode read-tool prelude from attachment user messages", () => {
    expect(
      visibleUserText(
        'Called the Read tool with the following input: {"filePath":"/Users/me/Desktop/a.png"}你看一下这张图',
      ),
    ).toBe("你看一下这张图")
  })

  it("returns empty text when the internal read-tool prelude has no user text after it", () => {
    expect(visibleUserText('Called the Read tool with the following input: {"filePath":"/tmp/a.png"}')).toBe("")
  })

  it("keeps ordinary user text unchanged", () => {
    expect(visibleUserText("你看一下这张图")).toBe("你看一下这张图")
  })

  it("handles braces inside the internal JSON string", () => {
    expect(visibleUserText('Called the Read tool with the following input: {"filePath":"/tmp/{a}.png"}  hello')).toBe(
      "hello",
    )
  })
})
