// @vitest-environment happy-dom
import type { Root } from "react-dom/client"

import * as React from "react"
import { act } from "react"
import { createRoot } from "react-dom/client"
import { afterEach, expect, test, vi } from "vitest"
import { useSkillCatalog } from "./use-skill-catalog.ts"
import {
  clearSkillCatalogCache,
  listPublicSkillPackages,
  invalidatePublicSkillCatalog,
} from "@/lib/skills-catalog-client"

let root: Root | undefined
afterEach(async () => {
  await act(async () => root?.unmount())
  root = undefined
  clearSkillCatalogCache()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

async function mount(load = listPublicSkillPackages) {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true)
  root = createRoot(document.createElement("div"))
  let view!: ReturnType<typeof useSkillCatalog>
  function Probe({ enabled }: { enabled: boolean }) {
    view = useSkillCatalog({ enabled, load })
    return null
  }
  const render = async (enabled: boolean) => {
    await act(async () =>
      root!.render(
        <React.StrictMode>
          <Probe enabled={enabled} />
        </React.StrictMode>,
      ),
    )
  }
  await render(true)
  return {
    get view() {
      return view
    },
    render,
  }
}

test("empty successful pages settle and do not loop, including StrictMode and tab reentry", async () => {
  const fetchMock = vi.fn(async () => Response.json({ data: [] }))
  vi.stubGlobal("fetch", fetchMock)
  const probe = await mount()
  expect(probe.view.catalog.status).toBe("ready")
  expect(probe.view.catalog.items).toEqual([])
  const settledCalls = fetchMock.mock.calls.length
  await probe.render(false)
  await probe.render(true)
  expect(fetchMock).toHaveBeenCalledTimes(settledCalls)
  expect(probe.view.catalog.status).toBe("ready")
})

test("invalidation reloads a visible catalog even when its query did not change", async () => {
  let name = "old"
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => Response.json({ data: [{ name, skills: [{ name }] }] })),
  )
  const probe = await mount()
  expect(probe.view.catalog.items[0]?.name).toBe("old")
  name = "new"
  await act(async () => invalidatePublicSkillCatalog())
  expect(probe.view.catalog.items[0]?.name).toBe("new")
})

test("failed refresh preserves visible rows, exposes the error and can be retried", async () => {
  let failing = false
  vi.stubGlobal(
    "fetch",
    vi.fn(async () =>
      failing ? new Response("failed", { status: 503 }) : Response.json({ data: [{ name: "demo" }] }),
    ),
  )
  const probe = await mount()
  failing = true
  await act(async () => probe.view.loadPage({ forceRefresh: true }))
  expect(probe.view.catalog.status).toBe("load-error")
  expect(probe.view.catalog.items[0]?.name).toBe("demo")
  expect(probe.view.catalog.error).toContain("503")
  failing = false
  await act(async () => probe.view.loadPage({ forceRefresh: true }))
  expect(probe.view.catalog.status).toBe("ready")
})

test("a late cancelled page cannot replace a newer result or update an unmounted consumer", async () => {
  let resolveOld!: (value: { items: []; next: null; updatedAt: string }) => void
  let calls = 0
  const load = vi.fn(async () => {
    calls++
    if (calls <= 2) return { items: [], next: null, updatedAt: "initial" }
    if (calls === 3)
      return new Promise<{ items: []; next: null; updatedAt: string }>((resolve) => {
        resolveOld = resolve
      })
    return { items: [], next: "new-page", updatedAt: "new" }
  })
  const probe = await mount(load)
  let old!: Promise<void>
  await act(async () => {
    old = probe.view.loadPage({ next: "old-page" })
  })
  await act(async () => probe.view.loadPage({ forceRefresh: true }))
  await act(async () => {
    resolveOld({ items: [], next: null, updatedAt: "old" })
    await old
  })
  expect(probe.view.catalog.next).toBe("new-page")
})

test("switching tabs preserves previously appended pages", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input) => {
      const next = new URL(String(input)).searchParams.get("next")
      return Response.json({ data: [{ name: next ? "second" : "first" }], next: next ? null : "page-two" })
    }),
  )
  const probe = await mount()
  await act(async () => probe.view.loadPage({ next: probe.view.catalog.next }))
  expect(probe.view.catalog.items.map((item) => item.name)).toEqual(["first", "second"])
  await probe.render(false)
  await probe.render(true)
  expect(probe.view.catalog.items.map((item) => item.name)).toEqual(["first", "second"])
})

test("expired tab reentry refreshes while fresh appended pages remain intact", async () => {
  let now = Date.now()
  vi.spyOn(Date, "now").mockImplementation(() => now)
  const fetcher = vi.fn(async () => Response.json({ data: [{ name: "fresh" }] }))
  vi.stubGlobal("fetch", fetcher)
  const probe = await mount()
  const calls = fetcher.mock.calls.length
  await probe.render(false)
  now += 6 * 60_000
  await probe.render(true)
  expect(fetcher).toHaveBeenCalledTimes(calls + 1)
  expect(probe.view.catalog.status).toBe("ready")
})

test("appending a fresh page does not extend the oldest page lifetime", async () => {
  let now = Date.now()
  vi.spyOn(Date, "now").mockImplementation(() => now)
  const load = vi.fn(async () => ({ items: [], next: "next", updatedAt: new Date(now).toISOString() }))
  const probe = await mount(load)
  now += 4 * 60_000
  await act(async () => probe.view.loadPage({ next: "next" }))
  const calls = load.mock.calls.length
  await probe.render(false)
  await probe.render(true)
  expect(load).toHaveBeenCalledTimes(calls)
  await probe.render(false)
  now += 2 * 60_000
  await probe.render(true)
  expect(load).toHaveBeenCalledTimes(calls + 1)
})

test("debounced search cancels before dispatch and disabling the tab aborts its active request", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true)
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] })
  root = createRoot(document.createElement("div"))
  const requests: Array<{ query: string; signal: AbortSignal }> = []
  function Probe({ query, enabled }: { query: string; enabled: boolean }) {
    const load = React.useCallback(
      (input: { signal?: AbortSignal }) => {
        requests.push({ query, signal: input.signal! })
        return new Promise<{ items: []; next: null; updatedAt: string }>(() => undefined)
      },
      [query],
    )
    useSkillCatalog({ enabled, load, debounceMs: 300 })
    return null
  }
  try {
    await act(async () => root!.render(<Probe query="old" enabled />))
    await act(async () => vi.advanceTimersByTimeAsync(200))
    await act(async () => root!.render(<Probe query="new" enabled />))
    await act(async () => vi.advanceTimersByTimeAsync(299))
    expect(requests).toHaveLength(0)
    await act(async () => vi.advanceTimersByTimeAsync(1))
    expect(requests.map((request) => request.query)).toEqual(["new"])
    await act(async () => root!.render(<Probe query="new" enabled={false} />))
    expect(requests[0]?.signal.aborted).toBe(true)
  } finally {
    vi.useRealTimers()
  }
})
