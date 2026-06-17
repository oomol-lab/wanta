import assert from "node:assert/strict"
import { afterEach, test, vi } from "vitest"
import { writeClipboardText } from "./clipboard.ts"

afterEach(() => {
  vi.unstubAllGlobals()
})

test("writeClipboardText uses navigator clipboard when available", async () => {
  const writeText = vi.fn(async (_text: string) => undefined)
  vi.stubGlobal("navigator", { clipboard: { writeText } })

  assert.equal(await writeClipboardText("diagnostics"), true)
  assert.equal(writeText.mock.calls[0]?.[0], "diagnostics")
})

test("writeClipboardText falls back to textarea copy when navigator clipboard rejects", async () => {
  const writeText = vi.fn(async () => {
    throw new Error("denied")
  })
  const textarea = {
    focus: vi.fn(),
    remove: vi.fn(),
    select: vi.fn(),
    setAttribute: vi.fn(),
    setSelectionRange: vi.fn(),
    style: {},
    value: "",
  }
  const append = vi.fn((_node: unknown) => undefined)
  const execCommand = vi.fn((_command: string) => true)
  vi.stubGlobal("navigator", { clipboard: { writeText } })
  vi.stubGlobal("document", {
    body: { append },
    createElement: vi.fn(() => textarea),
    execCommand,
  })

  assert.equal(await writeClipboardText("diagnostics"), true)
  assert.equal(textarea.value, "diagnostics")
  assert.equal(append.mock.calls[0]?.[0], textarea)
  assert.equal(execCommand.mock.calls[0]?.[0], "copy")
  assert.equal(textarea.remove.mock.calls.length, 1)
})
