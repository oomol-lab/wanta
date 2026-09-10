import type { LocalArtifactItem, LocalArtifactPreviewResult } from "../../../electron/chat/common.ts"

// @vitest-environment happy-dom
import * as React from "react"
import { act } from "react"
import { createRoot } from "react-dom/client"
import { afterEach, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  locale: "zh-CN",
  loadLocale: vi.fn(),
  mount: vi.fn(),
  dispose: vi.fn(),
  disposeUnit: vi.fn(),
  create: vi.fn(),
  state: {
    loading: false,
    preview: null as LocalArtifactPreviewResult | null,
    reload: vi.fn(),
    retry: vi.fn(),
    resourceLoaded: vi.fn(),
  },
}))
vi.mock("./artifact-preview-cache.ts", () => ({
  useLocalArtifactPreview: () => mocks.state,
  artifactPreviewCacheKey: (item: LocalArtifactItem) => JSON.stringify(item),
}))
vi.mock("@univerjs/core", () => ({
  LocaleType: { EN_US: "en", ZH_CN: "zh" },
  LogLevel: { WARN: 1, SILENT: 0 },
  Univer: class {
    constructor() {
      mocks.mount()
    }
    registerPlugin() {}
    dispose() {
      mocks.dispose()
    }
  },
}))
vi.mock("@univerjs/core/facade", () => ({
  FUniver: {
    newAPI: () => ({
      createWorkbook: (snapshot: { id: string }) => {
        mocks.create(snapshot.id)
        return { setEditable: vi.fn(), getId: () => snapshot.id }
      },
      disposeUnit: mocks.disposeUnit,
    }),
  },
}))
vi.mock("@univerjs/preset-sheets-core", () => ({ UniverSheetsCorePreset: () => ({ plugins: [] }) }))
vi.mock("@univerjs/preset-sheets-core/locales/zh-CN", () => ({ default: {} }))
vi.mock("./artifact-univer-locales.ts", () => ({
  univerLocales: { "zh-CN": "zh", en: "en", ja: "ja" },
  loadUniverMessages: mocks.loadLocale,
}))
vi.mock("./artifact-univer-snapshot.ts", () => ({
  workbookSnapshotFromPreview: (preview: LocalArtifactPreviewResult) => ({ id: preview.text }),
}))
vi.mock("@/components/theme-context", () => ({ useTheme: () => ({ effectiveTheme: "light" }) }))
vi.mock("@/i18n/i18n", () => {
  const t = (key: string, values?: Record<string, unknown>) => key + (values ? JSON.stringify(values) : "")
  return { useT: () => t, useI18n: () => ({ locale: mocks.locale, t }) }
})
vi.mock("@/components/ai-elements/code-block", () => ({
  CodeBlock: () => null,
  CodeBlockActions: () => null,
  CodeBlockCopyButton: () => null,
  CodeBlockFilename: () => null,
  CodeBlockHeader: () => null,
  CodeBlockTitle: () => null,
}))
vi.mock("@/components/ai-elements/message", () => ({ MessageResponse: () => null }))
vi.mock("@/lib/renderer-diagnostics", () => ({ reportRendererIssue: vi.fn() }))
import { ArtifactPreview, ArtifactConsumablePreview } from "./ArtifactPreviewPane.tsx"
import { ErrorBoundary } from "@/components/ErrorBoundary"

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
const container = document.createElement("div")
document.body.append(container)
let root = createRoot(container)
afterEach(async () => {
  await act(async () => root.unmount())
  root = createRoot(container)
  mocks.locale = "zh-CN"
  mocks.loadLocale.mockReset()
  vi.restoreAllMocks()
  vi.clearAllMocks()
})
const item = (name: string): LocalArtifactItem => ({
  name,
  path: "/tmp/" + name,
  kind: "file",
  mime: "text/csv",
  size: 10,
  modifiedAt: 1,
})
const cache = new Map()
const noop = () => {}
async function renderSheet(
  name: string,
  preview: LocalArtifactPreviewResult | null,
  mode: "preview" | "info" = "preview",
) {
  mocks.state.preview = preview
  mocks.state.loading = !preview
  await act(async () =>
    root.render(
      <ArtifactPreview
        item={item(name)}
        group={null}
        mode={mode}
        onContextMenu={noop}
        previewCache={cache}
        onOpen={noop}
      />,
    ),
  )
  // Resolve the actual module, then let act flush React.lazy's retry and commit.
  // A fixed delay can expire before Vite transforms the module in a busy worker.
  await act(async () => {
    await import("./ArtifactUniverSpreadsheetPreview.tsx")
  })
  await vi.waitFor(
    async () => {
      await act(async () => {})
      expect(container.querySelector('[aria-readonly="true"]')).not.toBeNull()
    },
    { timeout: 3000 },
  )
}
it("reuses one Univer through XLSX/CSV loading gaps and info, disposing old workbooks before new content", async () => {
  const a = { kind: "spreadsheet", mime: "text/csv", text: "a" } as LocalArtifactPreviewResult
  const b = { ...a, text: "b" }
  await renderSheet("a.xlsx", a)
  expect(mocks.mount).toHaveBeenCalledTimes(1)
  expect(mocks.create).toHaveBeenLastCalledWith("a")
  await renderSheet("b.csv", null)
  expect(mocks.disposeUnit).toHaveBeenCalledWith("a")
  expect(container.querySelector('[aria-readonly="true"]')?.getAttribute("style")).toContain("hidden")
  expect(mocks.mount).toHaveBeenCalledTimes(1)
  await renderSheet("b.csv", b)
  await renderSheet("b.csv", b, "info")
  await renderSheet("b.csv", b)
  expect(mocks.mount).toHaveBeenCalledTimes(1)
  expect(mocks.create.mock.calls).toEqual([["a"], ["b"]])
  await act(async () => root.render(null))
  await vi.waitFor(() => expect(mocks.dispose).toHaveBeenCalledTimes(1), { timeout: 3000 })
})
it("reports image success only on load and offers explicit retry after final resource failure", async () => {
  await act(async () =>
    root.render(
      <ArtifactConsumablePreview
        item={item("a.png")}
        preview={{ kind: "image", mime: "image/png", resourceUrl: "blob:a" }}
        onOpen={noop}
        onResourceLoaded={mocks.state.resourceLoaded}
        onResourceError={mocks.state.reload}
        onRetry={mocks.state.retry}
      />,
    ),
  )
  expect(mocks.state.resourceLoaded).not.toHaveBeenCalled()
  await act(async () => container.querySelector("img")!.dispatchEvent(new Event("load")))
  expect(mocks.state.resourceLoaded).toHaveBeenCalledTimes(1)
  await act(async () => container.querySelector("img")!.dispatchEvent(new Event("error")))
  expect(mocks.state.reload).toHaveBeenCalledTimes(1)
  await act(async () =>
    Array.from(container.querySelectorAll("button"))
      .find((button) => button.textContent === "artifacts.retry")!
      .click(),
  )
  expect(mocks.state.retry).toHaveBeenCalledTimes(1)
})
it("renders unknown archive totals as shown count without inventing a total", async () => {
  const preview = {
    kind: "archive",
    mime: "application/zip",
    truncated: true,
    archive: { format: "zip", totalEntries: null, entries: [{ path: "a.txt", kind: "file", size: 1 }] },
  } as LocalArtifactPreviewResult
  await act(async () => root.render(<ArtifactConsumablePreview item={item("a.zip")} preview={preview} onOpen={noop} />))
  expect(container.textContent).toContain('artifacts.archiveShownCount{"count":1}')
  expect(container.textContent).toContain("artifacts.archiveTruncated")
  expect(container.textContent).not.toContain("artifacts.archiveCount")
})
it("resetKey preserves healthy children and recovers an errored subtree", async () => {
  let mounts = 0
  let fail = false
  function Child() {
    React.useEffect(() => {
      mounts++
    }, [])
    if (fail) throw new Error("test failure")
    return <span>healthy</span>
  }
  const render = (key: string) =>
    act(async () =>
      root.render(
        <ErrorBoundary resetKey={key} fallback={<span>failed</span>}>
          <Child />
        </ErrorBoundary>,
      ),
    )
  await render("a")
  await render("b")
  expect(mounts).toBe(1)
  const log = vi.spyOn(console, "error").mockImplementation(() => {})
  fail = true
  await render("b")
  expect(container.textContent).toBe("failed")
  fail = false
  await render("c")
  expect(container.textContent).toBe("healthy")
  expect(mounts).toBe(2)
  log.mockRestore()
})

it("shows loading when revisiting a failed spreadsheet locale and recovers after retry", async () => {
  const { ArtifactUniverSpreadsheetPreview } = await import("./ArtifactUniverSpreadsheetPreview.tsx")
  vi.spyOn(console, "warn").mockImplementation(() => undefined)
  const renderLocale = async (locale: string) => {
    mocks.locale = locale
    await act(async () => root.render(<ArtifactUniverSpreadsheetPreview preview={null} />))
  }
  mocks.loadLocale
    .mockRejectedValueOnce(new Error("Japanese pack failed"))
    .mockRejectedValueOnce(new Error("English fallback failed"))
  await renderLocale("ja")
  expect(mocks.loadLocale.mock.calls.map(([locale]) => locale)).toEqual(["ja", "en"])
  expect(container.textContent).toContain("artifacts.previewUnavailable")
  let resolve!: (messages: object) => void
  mocks.loadLocale.mockReturnValueOnce(
    new Promise((done) => {
      resolve = done
    }),
  )
  await renderLocale("en")
  expect(container.textContent).toContain("artifacts.previewLoading")
  // Return before the intervening language finishes loading; its late result must be ignored.
  let resolveRetry!: (messages: object) => void
  mocks.loadLocale.mockReturnValueOnce(
    new Promise((done) => {
      resolveRetry = done
    }),
  )
  await renderLocale("ja")
  expect(container.textContent).toContain("artifacts.previewLoading")
  expect(container.textContent).not.toContain("artifacts.previewUnavailable")
  await act(async () => resolve({}))
  expect(container.textContent).toContain("artifacts.previewLoading")
  await act(async () => resolveRetry({}))
  expect(mocks.mount).toHaveBeenCalledTimes(1)
  expect(container.textContent).not.toContain("artifacts.previewUnavailable")
})
