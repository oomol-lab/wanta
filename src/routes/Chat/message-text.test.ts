import { describe, expect, it } from "vitest"
import { copyableMessageText, visibleUserText } from "./message-text.ts"

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

describe("copyableMessageText", () => {
  it("copies visible user text without the internal read-tool prelude", () => {
    expect(
      copyableMessageText({
        role: "user",
        parts: [
          {
            kind: "text",
            partId: "text-1",
            text: 'Called the Read tool with the following input: {"filePath":"/tmp/a.png"}  看一下这张图',
          },
        ],
      }),
    ).toBe("看一下这张图")
  })

  it("copies assistant text parts and skips tool parts", () => {
    expect(
      copyableMessageText({
        role: "assistant",
        parts: [
          { kind: "text", partId: "text-1", text: "第一段" },
          { kind: "tool", partId: "tool-1", callId: "call-1", tool: "bash", status: "completed", input: {} },
          { kind: "text", partId: "text-2", text: "第二段" },
        ],
      }),
    ).toBe("第一段\n\n第二段")
  })
})
