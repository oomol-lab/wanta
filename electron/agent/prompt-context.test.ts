import assert from "node:assert/strict"
import { test } from "vitest"
import { appendWantaPromptContext, stripWantaPromptContext } from "./prompt-context.ts"

test("stripWantaPromptContext removes hidden turn context blocks", () => {
  const text = appendWantaPromptContext("你好", "internal context")

  assert.equal(stripWantaPromptContext(text), "你好")
})

test("stripWantaPromptContext tolerates missing leading newlines", () => {
  const text = '你好<wanta_turn_context visibility="hidden_from_ui">internal</wanta_turn_context>'

  assert.equal(stripWantaPromptContext(text), "你好")
})

test("stripWantaPromptContext preserves visible text after the hidden block", () => {
  const text = [
    "before",
    '<wanta_turn_context visibility="hidden_from_ui">',
    "internal",
    "</wanta_turn_context>",
    "after",
  ].join("\n")

  assert.equal(stripWantaPromptContext(text), "before\n\nafter")
})
