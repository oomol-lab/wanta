// @vitest-environment happy-dom
import type { LocalArtifactItem, LocalArtifactThumbnailResult } from "../../../electron/chat/common.ts"
import type { AppContextValue } from "@/components/AppContext"

import * as React from "react"
import { act } from "react"
import { flushSync } from "react-dom"
import { createRoot } from "react-dom/client"
import { afterEach, expect, it, vi } from "vitest"
import { scheduleArtifactPreviewLoad } from "./artifact-preview-scheduler.ts"
import { useLocalArtifactThumbnail } from "./artifact-thumbnail-cache.ts"
import { AppContext } from "@/components/AppContext"

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let nextId = 0
function artifact(): LocalArtifactItem {
  const name = `thumbnail-test-${++nextId}.png`
  return { path: `/tmp/${name}`, name, kind: "file", mime: "image/png", size: 10, modifiedAt: 1 }
}
function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: Error) => void
  const promise = new Promise<T>((yes, no) => {
    resolve = yes
    reject = no
  })
  return { promise, resolve, reject }
}
const cleanups: (() => Promise<void>)[] = []
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup()
})

function harness(invoke: ReturnType<typeof vi.fn>) {
  const context = { chatService: { invoke } } as unknown as AppContextValue
  const container = document.createElement("div")
  document.body.append(container)
  const root = createRoot(container)
  const renders: { id: string; item: LocalArtifactItem | null; source: string | null }[] = []
  function Consumer({ id, item }: { id: string; item: LocalArtifactItem | null }) {
    const source = useLocalArtifactThumbnail(item)
    renders.push({ id, item, source })
    return source ? <img data-consumer={id} src={source} /> : null
  }
  function tree(items: (LocalArtifactItem | null)[], strict = false, generation = 0) {
    const children = items.map((item, index) => (
      <Consumer key={`${generation}:${index}`} id={String(index)} item={item} />
    ))
    return (
      <AppContext.Provider value={context}>
        {strict ? <React.StrictMode>{children}</React.StrictMode> : children}
      </AppContext.Provider>
    )
  }
  cleanups.push(async () => {
    await act(async () => root.unmount())
    container.remove()
  })
  return {
    renders,
    source: (id = "0") => container.querySelector(`img[data-consumer="${id}"]`)?.getAttribute("src") ?? null,
    render: async (items: (LocalArtifactItem | null)[], strict = false) => {
      await act(async () => root.render(tree(items, strict)))
    },
    replaceSameTick: async (item: LocalArtifactItem) => {
      await act(async () => {
        flushSync(() => root.render(tree([item], false, 0)))
        flushSync(() => root.render(tree([item], false, 1)))
      })
    },
  }
}

it("keeps the in-flight subscription and loaded image for semantic-equal item objects", async () => {
  const item = artifact()
  const pending = deferred<LocalArtifactThumbnailResult>()
  const invoke = vi.fn(() => pending.promise)
  const panel = harness(invoke)
  await panel.render([item])
  await panel.render([{ ...item }])
  expect(invoke).toHaveBeenCalledTimes(1)
  await act(async () => pending.resolve({ dataUrl: "data:image/png;base64,stable" }))
  expect(panel.source()).toBe("data:image/png;base64,stable")
  const start = panel.renders.length
  await panel.render([{ ...item }])
  expect(invoke).toHaveBeenCalledTimes(1)
  expect(panel.renders.slice(start).every(({ source }) => source === "data:image/png;base64,stable")).toBe(true)
})

it.each(["path", "size", "modifiedAt"] as const)(
  "never renders the old image under a changed %s key",
  async (field) => {
    const item = artifact()
    const changed = field === "path" ? artifact() : { ...item, [field]: 20 }
    const pending = deferred<LocalArtifactThumbnailResult>()
    const invoke = vi
      .fn()
      .mockResolvedValueOnce({ dataUrl: "data:image/png;base64,old" })
      .mockReturnValueOnce(pending.promise)
    const panel = harness(invoke)
    await panel.render([item])
    expect(panel.source()).toBe("data:image/png;base64,old")
    const start = panel.renders.length
    await panel.render([changed])
    expect(panel.source()).toBeNull()
    expect(panel.renders.slice(start).every(({ source }) => source === null)).toBe(true)
    await act(async () => pending.resolve({ dataUrl: "data:image/png;base64,new" }))
    expect(panel.source()).toBe("data:image/png;base64,new")
    expect(panel.renders.slice(start).some(({ source }) => source === "data:image/png;base64,old")).toBe(false)
    expect(invoke).toHaveBeenCalledTimes(2)
  },
)

it.each(["StrictMode", "same-tick replacement"] as const)(
  "reacquires a cancelled queued request during %s",
  async (mode) => {
    // Occupy the actual background pool: the thumbnail must still be queued when
    // effect cleanup cancels it and a second setup reacquires the same cache key.
    const blockers = Array.from({ length: 4 }, () => deferred<void>())
    const started = vi.fn()
    const jobs = blockers.map((blocker) =>
      scheduleArtifactPreviewLoad(() => {
        started()
        return blocker.promise
      }, "background"),
    )
    const invoke = vi.fn(async () => ({ dataUrl: "data:image/png;base64,reacquired" }))
    const item = artifact()
    const panel = harness(invoke)
    try {
      await act(async () => {
        await Promise.resolve()
      })
      expect(started).toHaveBeenCalledTimes(4)
      if (mode === "StrictMode") await panel.render([item], true)
      else await panel.replaceSameTick(item)
      expect(invoke).not.toHaveBeenCalled()
      await act(async () => {
        for (const blocker of blockers) blocker.resolve()
        await Promise.all(jobs)
      })
      expect(invoke).toHaveBeenCalledExactlyOnceWith("getLocalArtifactThumbnail", { path: item.path })
      expect(panel.source()).toBe("data:image/png;base64,reacquired")
      // A cancelled predecessor must not evict the replacement's successful cache.
      await panel.render([])
      await panel.render([item])
      expect(panel.source()).toBe("data:image/png;base64,reacquired")
      expect(invoke).toHaveBeenCalledTimes(1)
    } finally {
      await act(async () => {
        for (const blocker of blockers) blocker.resolve()
        await Promise.all(jobs)
      })
    }
  },
)

it.each(["null", "error"] as const)("retries a transient %s result when the item is reacquired", async (outcome) => {
  const item = artifact()
  const invoke = vi.fn()
  if (outcome === "null") invoke.mockResolvedValueOnce({ dataUrl: null })
  else invoke.mockRejectedValueOnce(new Error("temporary thumbnail failure"))
  invoke.mockResolvedValue({ dataUrl: "data:image/png;base64,recovered" })
  const panel = harness(invoke)
  await panel.render([item])
  expect(panel.source()).toBeNull()
  expect(invoke).toHaveBeenCalledTimes(1)
  await panel.render([])
  await panel.render([{ ...item }])
  expect(invoke).toHaveBeenCalledTimes(2)
  expect(panel.source()).toBe("data:image/png;base64,recovered")
  await panel.render([])
  await panel.render([item])
  expect(invoke).toHaveBeenCalledTimes(2)
})

it("cancelling one consumer leaves the other subscribed to the shared request", async () => {
  const item = artifact()
  const pending = deferred<LocalArtifactThumbnailResult>()
  const invoke = vi.fn(() => pending.promise)
  const panel = harness(invoke)
  await panel.render([item, { ...item }])
  expect(invoke).toHaveBeenCalledTimes(1)
  await panel.render([null, item])
  await act(async () => pending.resolve({ dataUrl: "data:image/png;base64,shared" }))
  expect(panel.source("0")).toBeNull()
  expect(panel.source("1")).toBe("data:image/png;base64,shared")
  await panel.render([item, item])
  expect(panel.source("0")).toBe("data:image/png;base64,shared")
  expect(invoke).toHaveBeenCalledTimes(1)
})
