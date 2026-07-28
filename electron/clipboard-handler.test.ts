import { beforeEach, describe, expect, it, vi } from "vitest"

const { handle, writeText } = vi.hoisted(() => ({
  handle: vi.fn(),
  writeText: vi.fn(),
}))

vi.mock("electron", () => ({
  clipboard: { writeText },
  ipcMain: { handle },
}))

import { WRITE_CLIPBOARD_TEXT_CHANNEL } from "./clipboard-common.ts"
import { registerClipboardHandler } from "./clipboard-handler.ts"

describe("registerClipboardHandler", () => {
  beforeEach(() => {
    writeText.mockReset()
    handle.mockReset()
  })

  it("writes validated text through Electron's native clipboard", () => {
    registerClipboardHandler()
    expect(handle).toHaveBeenCalledWith(WRITE_CLIPBOARD_TEXT_CHANNEL, expect.any(Function))

    const handler = handle.mock.calls[0]?.[1] as (event: unknown, text: unknown) => void
    handler({}, "UID: user-123")

    expect(writeText).toHaveBeenCalledWith("UID: user-123")
  })

  it("rejects non-string values", () => {
    registerClipboardHandler()
    const handler = handle.mock.calls[0]?.[1] as (event: unknown, text: unknown) => void

    expect(() => handler({}, { text: "not allowed" })).toThrow("Clipboard text must be a string.")
    expect(writeText).not.toHaveBeenCalled()
  })
})
