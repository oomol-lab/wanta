import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => {
  const emulateMedia = vi.fn()
  const page = { emulateMedia }
  const browser = {
    close: vi.fn(),
    contexts: vi.fn(() => [{ pages: () => [page] }]),
  }
  return {
    browser,
    connectOverCDP: vi.fn(async () => browser),
    emulateMedia,
    page,
  }
})

vi.mock("playwright-core", () => ({
  chromium: { connectOverCDP: mocks.connectOverCDP },
}))

import { PlaywrightWebContentsRelay } from "./playwright-relay.ts"

describe("PlaywrightWebContentsRelay", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.emulateMedia.mockResolvedValue(undefined)
  })

  it("leaves page color scheme under Electron theme control", async () => {
    const debuggerApi = {
      attach: vi.fn(),
      detach: vi.fn(),
      isAttached: vi.fn(() => false),
      off: vi.fn(),
      on: vi.fn(),
      sendCommand: vi.fn(async () => ({
        targetInfo: {
          attached: false,
          canAccessOpener: false,
          targetId: "page",
          title: "",
          type: "page",
          url: "about:blank",
        },
      })),
    }
    const contents = {
      debugger: debuggerApi,
      getUserAgent: vi.fn(() => "Wanta"),
      isDestroyed: vi.fn(() => false),
    }

    const relay = new PlaywrightWebContentsRelay(contents as never)
    await expect(relay.connect()).resolves.toBe(mocks.page)

    expect(mocks.connectOverCDP).toHaveBeenCalledOnce()
    expect(mocks.emulateMedia).toHaveBeenCalledWith({ colorScheme: null })
  })
})
