import { afterEach, describe, expect, it, vi } from "vitest"
import { BrowserPage } from "./page.ts"

const mocks = vi.hoisted(() => {
  const contents = {
    capturePage: vi.fn(),
    close: vi.fn(),
    focus: vi.fn(),
    getTitle: () => "Test",
    getURL: () => "https://example.com",
    isDestroyed: vi.fn(() => false),
    isLoading: () => false,
    loadURL: vi.fn(),
    navigationHistory: { canGoBack: () => false, canGoForward: () => false },
    on: vi.fn(),
    setWindowOpenHandler: vi.fn(),
    setZoomFactor: vi.fn(),
  }
  const view = { setBounds: vi.fn(), setBackgroundColor: vi.fn(), webContents: contents }
  const page = { on: vi.fn(), screenshot: vi.fn() }
  return { contents, page, view, waitForScreenshots: vi.fn() }
})

vi.mock("electron", () => ({
  nativeTheme: { on: vi.fn(), off: vi.fn(), shouldUseDarkColors: false },
  WebContentsView: class {
    constructor() {
      return mocks.view
    }
  },
}))
vi.mock("./playwright-relay.ts", () => ({
  PlaywrightWebContentsRelay: class {
    connect() {
      return Promise.resolve(mocks.page)
    }
    dispose() {
      return Promise.resolve()
    }
    waitForScreenshots() {
      return mocks.waitForScreenshots()
    }
  },
}))

const narrow = { x: 700, y: 48, width: 380, height: 672 }
const wide = { x: 0, y: 48, width: 1080, height: 672 }
const pages: BrowserPage[] = []

afterEach(async () => {
  await Promise.all(pages.splice(0).map((page) => page.dispose()))
  vi.clearAllMocks()
})

async function setup() {
  const contentView = { addChildView: vi.fn(), removeChildView: vi.fn() }
  const page = new BrowserPage({
    mainWindow: { contentView } as never,
    partitionSession: {} as never,
    sessionId: "test",
    stateChanged: vi.fn(),
    zoomFactorForUrl: () => 1,
  })
  pages.push(page)
  await page.initialize()
  page.show(narrow)
  mocks.view.setBounds.mockClear()
  return { contentView, page }
}

function capture() {
  const result = Promise.withResolvers<Buffer>()
  mocks.page.screenshot.mockReturnValueOnce(result.promise)
  return result
}

describe("browser screenshot and native bounds coordination", () => {
  it("captures a hidden preview without CDP or deferring panel resize", async () => {
    const { contentView, page } = await setup()
    page.hide()
    contentView.addChildView.mockClear()
    const image = Promise.withResolvers<{ isEmpty(): boolean; toDataURL(): string }>()
    mocks.contents.capturePage.mockReturnValueOnce(image.promise)
    const preview = page.capturePreview()
    expect(contentView.addChildView).not.toHaveBeenCalled()
    expect(mocks.contents.capturePage).toHaveBeenCalledWith(undefined, { stayHidden: true })
    page.show(wide)
    expect(mocks.view.setBounds).toHaveBeenCalledWith(wide)
    image.resolve({ isEmpty: () => false, toDataURL: () => "data:image/png;base64,preview" })
    await expect(preview).resolves.toBe("data:image/png;base64,preview")
    expect(mocks.page.screenshot).not.toHaveBeenCalled()
  })

  it("omits an empty native preview", async () => {
    const { page } = await setup()
    mocks.contents.capturePage.mockResolvedValueOnce({ isEmpty: () => true })
    await expect(page.capturePreview()).resolves.toBeNull()
  })

  it.each(["crash", "dispose"])("omits a preview rejected after page %s", async (reason) => {
    const { page } = await setup()
    const capture = Promise.withResolvers<never>()
    mocks.contents.capturePage.mockReturnValueOnce(capture.promise)
    const preview = page.capturePreview()
    if (reason === "dispose") {
      await page.dispose()
    } else {
      const listener = mocks.contents.on.mock.calls.find(([event]) => event === "render-process-gone")?.[1]
      listener()
    }
    capture.reject(new Error("Render frame was disposed"))
    await expect(preview).resolves.toBeNull()
  })

  it("preserves unexpected capture failures on a live page", async () => {
    const { page } = await setup()
    const error = new Error("Capture failed")
    mocks.contents.capturePage.mockRejectedValueOnce(error)
    await expect(page.capturePreview()).rejects.toBe(error)
  })

  it("discards a successful capture if the page was disposed while waiting", async () => {
    const { page } = await setup()
    const capture = Promise.withResolvers<{ isEmpty(): boolean; toDataURL(): string }>()
    mocks.contents.capturePage.mockReturnValueOnce(capture.promise)
    const preview = page.capturePreview()
    await page.dispose()
    capture.resolve({ isEmpty: () => false, toDataURL: () => "stale" })
    await expect(preview).resolves.toBeNull()
  })

  it("applies only the latest bounds after CDP restores the capture viewport", async () => {
    const { contentView, page } = await setup()
    const image = capture()
    const screenshot = page.screenshot(true)
    page.show({ ...wide, width: 800 })
    page.show(wide)
    expect(contentView.removeChildView).not.toHaveBeenCalled()
    expect(mocks.view.setBounds).not.toHaveBeenCalled()
    image.resolve(Buffer.from("png"))
    await screenshot
    expect(mocks.view.setBounds).toHaveBeenCalledExactlyOnceWith(wide)
    expect(page.state().visible).toBe(true)
  })

  it("keeps a modal or closed panel hidden even if a resize was pending", async () => {
    const { page } = await setup()
    const image = capture()
    const screenshot = page.screenshot(false)
    page.show(wide)
    page.hide()
    image.resolve(Buffer.from("png"))
    await screenshot
    expect(mocks.view.setBounds).not.toHaveBeenCalled()
    expect(page.state().visible).toBe(false)
  })

  it("keeps the latest bounds when a resize returns to its original size during capture", async () => {
    const { contentView, page } = await setup()
    const image = capture()
    const screenshot = page.screenshot(true)
    page.show(wide)
    page.show(narrow)
    image.resolve(Buffer.from("png"))
    await screenshot
    expect(mocks.view.setBounds).not.toHaveBeenCalled()
    expect(contentView.removeChildView).not.toHaveBeenCalled()
    expect(page.state().visible).toBe(true)
  })

  it("waits for every overlapping capture before showing a hidden page", async () => {
    const { page } = await setup()
    page.hide()
    const first = capture()
    const screenshot1 = page.screenshot(true)
    const second = capture()
    const screenshot2 = page.screenshot(false)
    page.show(wide)
    first.resolve(Buffer.from("first"))
    await screenshot1
    expect(mocks.view.setBounds).not.toHaveBeenCalled()
    second.resolve(Buffer.from("second"))
    await screenshot2
    expect(mocks.view.setBounds).toHaveBeenCalledExactlyOnceWith(wide)
  })

  it("restores the pending view after capture failure", async () => {
    const { page } = await setup()
    const image = capture()
    const screenshot = page.screenshot(true)
    page.show(wide)
    image.reject(new Error("capture cancelled"))
    await expect(screenshot).rejects.toThrow("capture cancelled")
    expect(mocks.view.setBounds).toHaveBeenCalledExactlyOnceWith(wide)
  })

  it("does not reattach a disposed page when its capture settles", async () => {
    const { contentView, page } = await setup()
    const image = capture()
    const screenshot = page.screenshot(true)
    page.show(wide)
    await page.dispose()
    contentView.addChildView.mockClear()
    image.resolve(Buffer.from("png"))
    await screenshot
    expect(contentView.addChildView).not.toHaveBeenCalled()
  })

  it("waits for a cancelled capture's native command to finish restoring the viewport", async () => {
    const { page } = await setup()
    const nativeCapture = Promise.withResolvers<void>()
    mocks.waitForScreenshots.mockReturnValueOnce(nativeCapture.promise)
    const image = capture()
    const screenshot = page.screenshot(true)
    page.show(wide)
    image.reject(new Error("capture cancelled"))
    await vi.waitFor(() => expect(mocks.waitForScreenshots).toHaveBeenCalled())
    expect(mocks.view.setBounds).not.toHaveBeenCalled()
    nativeCapture.resolve()
    await expect(screenshot).rejects.toThrow("capture cancelled")
    expect(mocks.view.setBounds).toHaveBeenCalledExactlyOnceWith(wide)
  })

  it("keeps an unchanged visible view attached during capture", async () => {
    const { contentView, page } = await setup()
    const image = capture()
    const screenshot = page.screenshot(false)
    page.show(narrow)
    expect(contentView.removeChildView).not.toHaveBeenCalled()
    image.resolve(Buffer.from("png"))
    await screenshot
    expect(mocks.view.setBounds).not.toHaveBeenCalled()
  })
})
