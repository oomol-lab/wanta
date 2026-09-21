import type { Root } from "react-dom/client"

// @vitest-environment happy-dom
import * as React from "react"
import { act } from "react"
import { createRoot } from "react-dom/client"
import { afterEach, expect, it, vi } from "vitest"
import { KnowledgeRoute } from "./index.tsx"
import { I18nContext, translate } from "@/i18n/i18n"
import * as api from "@/lib/knowledge-client"
vi.mock("@/lib/knowledge-client", () => ({
  listKnowledgeFiles: vi.fn(),
  uploadKnowledgeFile: vi.fn(),
  deleteKnowledgeFile: vi.fn(),
  retrieveKnowledge: vi.fn(),
}))
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
let root: Root | undefined
const file = {
  id: "f",
  name: "policy.pdf",
  size_bytes: 100,
  status: "ready" as const,
  created_at: "now",
  updated_at: "now",
}
function render(team: string, writable = true) {
  root ??= createRoot(document.body.appendChild(document.createElement("div")))
  root.render(
    <I18nContext.Provider value={{ locale: "en", setLocale: () => {}, t: (key, vars) => translate("en", key, vars) }}>
      <KnowledgeRoute key={team} teamId={team} writable={writable} />
    </I18nContext.Provider>,
  )
}
afterEach(async () => {
  await act(async () => root?.unmount())
  root = undefined
  document.body.replaceChildren()
  vi.clearAllMocks()
  vi.useRealTimers()
})
it("aborts old-team requests and ignores their late response", async () => {
  let finish!: (value: { items: (typeof file)[]; next_cursor: string }) => void
  vi.mocked(api.listKnowledgeFiles)
    .mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve
        }),
    )
    .mockResolvedValue({ items: [{ ...file, name: "new-team.pdf" }], next_cursor: "" })
  await act(async () => render("old-team"))
  const oldSignal = vi.mocked(api.listKnowledgeFiles).mock.calls[0][2]!
  await act(async () => render("new-team"))
  expect(oldSignal.aborted).toBe(true)
  await act(async () => finish({ items: [file], next_cursor: "" }))
  expect(document.body.textContent).toContain("new-team.pdf")
  expect(document.body.textContent).not.toContain("policy.pdf")
})
it("loads subsequent pages without dropping the first page and gates writes", async () => {
  vi.mocked(api.listKnowledgeFiles).mockImplementation(async (_team, cursor) =>
    cursor
      ? { items: [{ ...file, id: "f2", name: "second.pdf" }], next_cursor: "" }
      : { items: [file], next_cursor: "cursor-1" },
  )
  await act(async () => render("team", false))
  const button = [...document.querySelectorAll("button")].find((b) => b.textContent === "Load more")!
  await act(async () => button.click())
  expect(document.body.textContent).toContain("policy.pdf")
  expect(document.body.textContent).toContain("second.pdf")
  expect(vi.mocked(api.listKnowledgeFiles).mock.calls.some((call) => call[1] === "cursor-1")).toBe(true)
  expect(document.querySelector<HTMLButtonElement>('[aria-label="Delete file policy.pdf"]')?.disabled).toBe(true)
  expect([...document.querySelectorAll("button")].find((b) => b.textContent === "Upload file")?.disabled).toBe(true)
})
it("polls processing files until ready", async () => {
  vi.useFakeTimers()
  vi.mocked(api.listKnowledgeFiles)
    .mockResolvedValueOnce({ items: [{ ...file, status: "indexing" }], next_cursor: "" })
    .mockResolvedValue({ items: [file], next_cursor: "" })
  await act(async () => render("team"))
  expect(document.body.textContent).toContain("Indexing")
  await act(async () => {
    await vi.advanceTimersByTimeAsync(3000)
  })
  expect(document.body.textContent).toContain("Ready")
  await act(async () => {
    await vi.advanceTimersByTimeAsync(6000)
  })
  expect(api.listKnowledgeFiles).toHaveBeenCalledTimes(2)
})

async function selectUpload() {
  const picker = document.querySelector<HTMLInputElement>('input[type="file"]')!
  Object.defineProperty(picker, "files", { configurable: true, value: [new File(["data"], "guide.pdf")] })
  await act(async () => picker.dispatchEvent(new Event("change", { bubbles: true })))
}
function buttonNamed(name: string) {
  return [...document.querySelectorAll("button")].find((button) => button.textContent === name)!
}
it("cancels a stalled upload immediately and ignores its late completion during another upload", async () => {
  vi.mocked(api.listKnowledgeFiles).mockResolvedValue({ items: [file], next_cursor: "" })
  let rejectOld!: (error: Error) => void
  vi.mocked(api.uploadKnowledgeFile)
    .mockImplementationOnce(
      () =>
        new Promise((_resolve, reject) => {
          rejectOld = reject
        }),
    )
    .mockImplementation(() => new Promise(() => {}))
  await act(async () => render("team"))
  await selectUpload()
  const oldSignal = vi.mocked(api.uploadKnowledgeFile).mock.calls[0][2]!
  expect(buttonNamed("Upload file").disabled).toBe(true)
  await act(async () => buttonNamed("Cancel upload").click())
  expect(oldSignal.aborted).toBe(true)
  expect(buttonNamed("Upload file").disabled).toBe(false)
  expect(document.querySelector<HTMLButtonElement>('[aria-label="Delete file policy.pdf"]')?.disabled).toBe(false)
  await selectUpload()
  const newSignal = vi.mocked(api.uploadKnowledgeFile).mock.calls[1][2]!
  await act(async () => rejectOld(new Error("late failure")))
  expect(newSignal.aborted).toBe(false)
  expect(buttonNamed("Upload file").disabled).toBe(true)
  expect(document.querySelector('[role="alert"]')).toBeNull()
  await act(async () => render("different-team"))
  expect(newSignal.aborted).toBe(true)
})
it("clears a failed pagination request on retry", async () => {
  let failed = false
  vi.mocked(api.listKnowledgeFiles).mockImplementation(async (_team, cursor) => {
    if (!cursor) return { items: [file], next_cursor: "next" }
    if (!failed) {
      failed = true
      throw new Error("list failed")
    }
    return { items: [{ ...file, id: "second", name: "second.pdf" }], next_cursor: "" }
  })
  await act(async () => render("team"))
  await act(async () => buttonNamed("Load more").click())
  expect(document.querySelector('[role="alert"]')?.textContent).toBe("list failed")
  await act(async () => buttonNamed("Load more").click())
  expect(document.body.textContent).toContain("second.pdf")
  expect(document.querySelector('[role="alert"]')).toBeNull()
})
it("does not erase upload failures when the list refreshes", async () => {
  vi.mocked(api.listKnowledgeFiles).mockResolvedValue({ items: [file], next_cursor: "" })
  vi.mocked(api.uploadKnowledgeFile).mockRejectedValue(new Error("upload failed"))
  await act(async () => render("team"))
  await selectUpload()
  await act(async () => document.querySelector<HTMLButtonElement>('[aria-label="Refresh"]')!.click())
  expect(document.querySelector('[role="alert"]')?.textContent).toBe("upload failed")
})
