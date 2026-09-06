import type { LocalArtifactItem } from "../../../electron/chat/common.ts"
import type { ArtifactFileStrip } from "./ArtifactBrowser.tsx"
import type { ArtifactPreview } from "./ArtifactPreviewPane.tsx"
import type { ArtifactSelection } from "./GeneratedArtifacts.tsx"
import type { AppContextValue } from "@/components/AppContext"
import type { Root } from "react-dom/client"

// @vitest-environment happy-dom
import * as React from "react"
import { act } from "react"
import { createRoot } from "react-dom/client"
import { afterEach, beforeEach, expect, it, vi } from "vitest"
import { ArtifactsPanel } from "./GeneratedArtifacts.tsx"
import { AppContext } from "@/components/AppContext"
import { I18nContext, translate } from "@/i18n/i18n"

const captured = vi.hoisted(() => ({
  browser: null as React.ComponentProps<typeof ArtifactFileStrip> | null,
  preview: null as React.ComponentProps<typeof ArtifactPreview> | null,
  error: vi.fn(),
  report: vi.fn(),
}))
vi.mock("./ArtifactBrowser.tsx", () => ({
  ArtifactFileStrip: (props: React.ComponentProps<typeof ArtifactFileStrip>) => {
    captured.browser = props
    return null
  },
  ImageGalleryPanel: () => null,
}))
vi.mock("./ArtifactPreviewPane.tsx", () => ({
  ArtifactPreview: (props: React.ComponentProps<typeof ArtifactPreview>) => {
    captured.preview = props
    return null
  },
  ArtifactsEmptyState: () => <span>Empty</span>,
}))
vi.mock("./ArtifactContextMenu.tsx", () => ({ ArtifactContextMenu: () => null }))
vi.mock("sonner", () => ({ toast: { error: captured.error } }))
vi.mock("@/lib/renderer-diagnostics", () => ({ reportRendererHandledError: captured.report }))
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const file: LocalArtifactItem = { kind: "file", name: "a.txt", path: "/tmp/a.txt", mime: "text/plain" }
const folder: LocalArtifactItem = { kind: "directory", name: "dir", path: "/tmp/dir", mime: "inode/directory" }
const nested = { ...file, name: "nested.txt", path: "/tmp/dir/nested.txt" }
const subfolder = { ...folder, name: "sub", path: "/tmp/dir/sub" }
const deep = { ...file, name: "deep.txt", path: "/tmp/dir/sub/deep.txt" }
const group = (items: LocalArtifactItem[]) => ({ items, totalItems: items.length, truncated: false })
const result = (...items: LocalArtifactItem[]) => ({ groups: [group(items)] })
const selection: ArtifactSelection = { messageId: "m", group: group([file, folder]), selectedPath: file.path }
const invoke = vi.fn()
const context = { chatService: { invoke } } as unknown as AppContextValue
const i18n = {
  locale: "zh-CN" as const,
  setLocale: () => undefined,
  t: (key: Parameters<typeof translate>[1], vars?: Parameters<typeof translate>[2]) => translate("zh-CN", key, vars),
}
let container: HTMLDivElement
let root: Root | null

async function render(command: ArtifactSelection | null = selection, maximized = false) {
  await act(async () =>
    root!.render(
      <React.StrictMode>
        <AppContext.Provider value={context}>
          <I18nContext.Provider value={i18n}>
            <ArtifactsPanel
              selection={command}
              maximized={maximized}
              windowControlsOnRight
              onCollapse={() => undefined}
              onToggleMaximized={() => undefined}
            />
          </I18nContext.Provider>
        </AppContext.Provider>
      </React.StrictMode>,
    ),
  )
}
async function enter(path: string) {
  await act(async () =>
    captured.browser!.onEnterFolder(captured.browser!.entries.find((entry) => entry.item.path === path)!),
  )
}
async function unmount() {
  await act(async () => root!.unmount())
  root = null
}
function deferred() {
  let resolve!: (value: ReturnType<typeof result>) => void
  let reject!: (error: Error) => void
  const promise = new Promise<ReturnType<typeof result>>((yes, no) => {
    resolve = yes
    reject = no
  })
  return { promise, resolve, reject }
}
beforeEach(() => {
  vi.clearAllMocks()
  invoke.mockReset().mockResolvedValue(result(nested, subfolder))
  captured.browser = null
  captured.preview = null
  container = document.createElement("div")
  document.body.append(container)
  root = createRoot(container)
})
afterEach(async () => {
  if (root) await unmount()
  container.remove()
})

it("keeps the folder chosen when returning to the root breadcrumb", async () => {
  await render()
  expect(captured.preview!.item?.path).toBe(file.path)
  await enter(folder.path)
  expect(captured.preview!.item?.path).toBe(nested.path)
  await act(async () => captured.browser!.onNavigateBreadcrumb(-1))
  expect(captured.browser!.browseLevels).toHaveLength(0)
  expect(captured.preview!.item?.path).toBe(folder.path)
  await render(selection, true)
  expect(captured.preview!.item?.path).toBe(folder.path)
})

it("keeps the departed subfolder selected at an intermediate breadcrumb", async () => {
  await render()
  await enter(folder.path)
  invoke.mockResolvedValueOnce(result(deep))
  await enter(subfolder.path)
  await act(async () => captured.browser!.onNavigateBreadcrumb(0))
  expect(captured.browser!.browseLevels.map((level) => level.path)).toEqual([folder.path])
  expect(captured.preview!.item?.path).toBe(subfolder.path)
})

it("applies a new selection object as a command even when its selectedPath is unchanged", async () => {
  await render()
  await enter(folder.path)
  await act(async () => captured.preview!.onModeChange!("info"))
  await render(selection, true)
  expect(captured.preview!.item?.path).toBe(nested.path)
  expect(captured.preview!.mode).toBe("info")
  await render({ ...selection })
  expect(captured.browser!.browseLevels).toHaveLength(0)
  expect(captured.preview!.item?.path).toBe(file.path)
  expect(captured.preview!.mode).toBe("preview")
  await render({ ...selection, selectedPath: folder.path })
  expect(captured.preview!.item?.path).toBe(folder.path)
})

it("falls back to the first entry for missing paths and clears on a null command", async () => {
  await render({ ...selection, selectedPath: "/missing" })
  expect(captured.preview!.item?.path).toBe(file.path)
  await render(null)
  expect(container.textContent).toContain("Empty")
  await render({ ...selection, selectedPath: undefined })
  expect(captured.preview!.item?.path).toBe(file.path)
})

it.each(["selection", "breadcrumb", "file"] as const)(
  "ignores a folder response superseded by %s navigation",
  async (navigation) => {
    const pending = deferred()
    invoke.mockReturnValueOnce(pending.promise)
    await render()
    await enter(folder.path)
    if (navigation === "selection") await render({ ...selection })
    else if (navigation === "breadcrumb") await act(async () => captured.browser!.onNavigateBreadcrumb(-1))
    else await act(async () => captured.browser!.onSelect(file.path))
    await act(async () => pending.resolve(result(nested)))
    expect(captured.browser!.browseLevels).toHaveLength(0)
    expect(captured.preview!.item?.path).toBe(file.path)
  },
)

it("allows only the latest overlapping folder request to navigate", async () => {
  const first = deferred()
  const second = deferred()
  invoke.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise)
  await render()
  await enter(folder.path)
  await enter(folder.path)
  await act(async () => second.resolve(result(nested)))
  await act(async () => first.resolve(result(deep)))
  expect(captured.browser!.browseLevels).toHaveLength(1)
  expect(captured.preview!.item?.path).toBe(nested.path)
})

it.each(["empty", "error"] as const)("ignores a stale %s folder result after unmount", async (outcome) => {
  const pending = deferred()
  invoke.mockReturnValueOnce(pending.promise)
  await render()
  await enter(folder.path)
  await unmount()
  await act(async () => {
    if (outcome === "error") pending.reject(new Error("late failure"))
    else pending.resolve({ groups: [] })
  })
  expect(invoke).toHaveBeenCalledTimes(1)
  expect(captured.error).not.toHaveBeenCalled()
  expect(captured.report).not.toHaveBeenCalled()
})
