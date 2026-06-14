import { describe, expect, it } from "vitest"
import { assistantResponseActionTextByMessageId, copyableMessageText, visibleUserText } from "./message-text.ts"

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

describe("assistantResponseActionTextByMessageId", () => {
  it("shows actions only on the last assistant message in one response", () => {
    const actions = assistantResponseActionTextByMessageId([
      { id: "user-1", role: "user", parts: [{ kind: "text", partId: "u1", text: "下载图片" }] },
      { id: "assistant-1", role: "assistant", parts: [{ kind: "text", partId: "a1", text: "先加载技能。" }] },
      { id: "assistant-2", role: "assistant", parts: [{ kind: "text", partId: "a2", text: "再获取页面内容。" }] },
    ])

    expect(actions.has("assistant-1")).toBe(false)
    expect(actions.get("assistant-2")).toBe("先加载技能。\n\n再获取页面内容。")
  })

  it("starts a new assistant response after each user message", () => {
    const actions = assistantResponseActionTextByMessageId([
      { id: "user-1", role: "user", parts: [{ kind: "text", partId: "u1", text: "第一问" }] },
      { id: "assistant-1", role: "assistant", parts: [{ kind: "text", partId: "a1", text: "第一答" }] },
      { id: "user-2", role: "user", parts: [{ kind: "text", partId: "u2", text: "第二问" }] },
      { id: "assistant-2", role: "assistant", parts: [{ kind: "text", partId: "a2", text: "第二答" }] },
    ])

    expect(actions.get("assistant-1")).toBe("第一答")
    expect(actions.get("assistant-2")).toBe("第二答")
  })

  it("does not show actions for the active streaming assistant response", () => {
    const actions = assistantResponseActionTextByMessageId(
      [
        { id: "user-1", role: "user", parts: [{ kind: "text", partId: "u1", text: "下载图片" }] },
        { id: "assistant-1", role: "assistant", parts: [{ kind: "text", partId: "a1", text: "先加载技能。" }] },
        { id: "assistant-2", role: "assistant", parts: [{ kind: "text", partId: "a2", text: "再获取页面内容。" }] },
      ],
      "assistant-2",
    )

    expect(actions.size).toBe(0)
  })
})
