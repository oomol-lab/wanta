// @vitest-environment happy-dom
import * as React from "react"
import { act } from "react"
import { createRoot } from "react-dom/client"
import { afterEach, expect, it, vi } from "vitest"
const mocks = vi.hoisted(() => ({
  render: vi.fn(),
  destroy: vi.fn(),
  viewer: vi.fn(),
  handlers: new Map<string, (event: object) => void>(),
}))
vi.mock("docx-preview", () => ({ renderAsync: mocks.render }))
vi.mock("@/i18n/i18n", () => ({ useT: () => (key: string) => key }))
vi.mock("pdfjs-dist", () => ({
  GlobalWorkerOptions: {},
  getDocument: () => ({ promise: Promise.resolve({ numPages: 3 }), destroy: mocks.destroy }),
}))
vi.mock("pdfjs-dist/web/pdf_viewer.mjs", () => ({
  EventBus: class {
    on(name: string, fn: (event: object) => void) {
      mocks.handlers.set(name, fn)
    }
    off(name: string) {
      mocks.handlers.delete(name)
    }
  },
  PDFLinkService: class {
    setViewer() {}
    setDocument() {}
  },
  PDFViewer: class {
    constructor() {
      mocks.viewer()
    }
    setDocument() {}
  },
  LinkTarget: { BLANK: 2 },
  ScrollMode: { VERTICAL: 0 },
}))
import ArtifactDocxPreview from "./ArtifactDocxPreview.tsx"
import ArtifactPdfPreview from "./ArtifactPdfPreview.tsx"
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
const container = document.createElement("div")
document.body.append(container)
let root = createRoot(container)
afterEach(async () => {
  await act(async () => root.unmount())
  root = createRoot(container)
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  vi.clearAllMocks()
})
it("DOCX ignores stale completion, revokes detached blobs and reports only committed render success", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({ ok: true, arrayBuffer: async () => new ArrayBuffer(1) })),
  )
  const revoke = vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {})
  const completions: (() => void)[] = []
  const signals: AbortSignal[] = []
  mocks.render.mockImplementation(
    (_buffer, body: HTMLElement) =>
      new Promise<void>((resolve) => {
        completions.push(() => {
          body.innerHTML = '<img src="blob:render-' + completions.length + '">'
          resolve()
        })
      }),
  )
  const loaded = vi.fn()
  const failed = vi.fn()
  const render = (source: string) =>
    act(async () =>
      root.render(
        <ArtifactDocxPreview source={source} name="doc" onResourceLoaded={loaded} onResourceError={failed} />,
      ),
    )
  await render("a")
  signals.push(vi.mocked(fetch).mock.calls[0]![1]!.signal!)
  await render("b")
  expect(signals[0]!.aborted).toBe(true)
  await act(async () => completions[0]!())
  expect(loaded).not.toHaveBeenCalled()
  expect(container.querySelector("img")).toBeNull()
  expect(revoke).toHaveBeenCalled()
  await act(async () => completions[1]!())
  expect(loaded).toHaveBeenCalledTimes(1)
  expect(container.querySelector("img")).not.toBeNull()
  expect(failed).not.toHaveBeenCalled()
  await render("b")
  expect(mocks.render).toHaveBeenCalledTimes(2)
})
it("PDF reuses viewer on ordinary rerenders, counts only successful page rendering and destroys on unmount", async () => {
  const loaded = vi.fn(),
    failed = vi.fn(),
    retry = vi.fn()
  const render = () =>
    act(async () =>
      root.render(
        <ArtifactPdfPreview
          source="blob:pdf"
          name="pdf"
          onResourceLoaded={loaded}
          onResourceError={failed}
          onRetry={retry}
        />,
      ),
    )
  await render()
  await render()
  expect(mocks.viewer).toHaveBeenCalledTimes(1)
  expect(loaded).not.toHaveBeenCalled()
  await act(async () => mocks.handlers.get("pagesloaded")!({ pagesCount: 3 }))
  expect(loaded).not.toHaveBeenCalled()
  await act(async () => mocks.handlers.get("pagerendered")!({ error: new Error("render failed") }))
  expect(failed).toHaveBeenCalledTimes(1)
  expect(loaded).not.toHaveBeenCalled()
  await act(async () =>
    Array.from(container.querySelectorAll("button"))
      .find((button) => button.textContent === "artifacts.retry")!
      .click(),
  )
  expect(retry).toHaveBeenCalledTimes(1)
  await act(async () => mocks.handlers.get("pagerendered")!({}))
  expect(loaded).not.toHaveBeenCalled()
  await act(async () => root.render(null))
  expect(mocks.destroy).toHaveBeenCalledTimes(1)
  expect(mocks.handlers.size).toBe(0)
})

it("PDF signals success once per document and ignores later successes after failure or disposal", async () => {
  const loaded = vi.fn()
  const failed = vi.fn()
  const render = (source: string) =>
    act(async () =>
      root.render(<ArtifactPdfPreview source={source} name="pdf" onResourceLoaded={loaded} onResourceError={failed} />),
    )
  const pageRendered = (event: object = {}) => act(async () => mocks.handlers.get("pagerendered")!(event))
  await render("blob:first")
  const staleHandler = mocks.handlers.get("pagerendered")!
  await pageRendered()
  await pageRendered()
  await pageRendered()
  expect(loaded).toHaveBeenCalledTimes(1)
  await pageRendered({ error: new Error("later page failed") })
  expect(failed).toHaveBeenCalledTimes(1)
  await pageRendered()
  await pageRendered()
  expect(loaded).toHaveBeenCalledTimes(1)
  await render("blob:second")
  expect(mocks.viewer).toHaveBeenCalledTimes(2)
  expect(mocks.destroy).toHaveBeenCalledTimes(1)
  await act(async () => staleHandler({}))
  expect(loaded).toHaveBeenCalledTimes(1)
  await pageRendered()
  await pageRendered()
  expect(loaded).toHaveBeenCalledTimes(2)
})
