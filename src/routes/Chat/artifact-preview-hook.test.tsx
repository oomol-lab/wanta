// @vitest-environment happy-dom
import type { LocalArtifactItem, LocalArtifactPreviewResult } from "../../../electron/chat/common.ts"
import type { AppContextValue } from "@/components/AppContext"

import * as React from "react"
import { act } from "react"
import { createRoot } from "react-dom/client"
import { afterEach, describe, expect, it, vi } from "vitest"
import { useLocalArtifactPreview } from "./artifact-preview-cache.ts"
import { AppContext } from "@/components/AppContext"

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

function artifact(name: string, mime: string): LocalArtifactItem {
  return { path: `/tmp/${name}`, name, kind: "file", mime, size: 10, modifiedAt: 1 }
}

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((settle) => {
    resolve = settle
  })
  return { promise, resolve }
}

describe("useLocalArtifactPreview", () => {
  const containers: HTMLElement[] = []

  afterEach(() => {
    for (const container of containers.splice(0)) {
      container.remove()
    }
  })

  it("never exposes the previous file preview under a newly selected item", async () => {
    const htmlItem = artifact("report.html", "text/html")
    const jsonItem = artifact("q_accounts.json", "application/json")
    const htmlRequest = deferred<LocalArtifactPreviewResult>()
    const jsonRequest = deferred<LocalArtifactPreviewResult>()
    const invoke = vi.fn((_method: string, request: { path: string }) =>
      request.path === htmlItem.path ? htmlRequest.promise : jsonRequest.promise,
    )
    const appContext = { chatService: { invoke } } as unknown as AppContextValue
    const cache = new Map()
    let latest: ReturnType<typeof useLocalArtifactPreview> | undefined

    function Harness({ item }: { item: LocalArtifactItem }) {
      latest = useLocalArtifactPreview(item, cache)
      return null
    }

    const container = document.createElement("div")
    containers.push(container)
    document.body.append(container)
    const root = createRoot(container)

    await act(async () => {
      root.render(
        <AppContext.Provider value={appContext}>
          <Harness item={htmlItem} />
        </AppContext.Provider>,
      )
    })
    expect(latest).toMatchObject({ loading: true, preview: null })

    await act(async () => {
      root.render(
        <AppContext.Provider value={appContext}>
          <Harness item={jsonItem} />
        </AppContext.Provider>,
      )
    })
    expect(latest).toMatchObject({ loading: true, preview: null })

    await act(async () => {
      htmlRequest.resolve({ kind: "text", mime: "text/html", text: "<h1>old report</h1>" })
      await htmlRequest.promise
    })
    expect(latest).toMatchObject({ loading: true, preview: null })

    await act(async () => {
      jsonRequest.resolve({ kind: "text", mime: "application/json", text: '{"results":[]}' })
      await jsonRequest.promise
    })
    expect(latest).toMatchObject({
      loading: false,
      preview: { kind: "text", mime: "application/json", text: '{"results":[]}' },
    })

    await act(async () => root.unmount())
  })
})

async function mountPreviewHook(invoke: ReturnType<typeof vi.fn>, initialItem: LocalArtifactItem) {
  const cache = new Map()
  const appContext = { chatService: { invoke } } as unknown as AppContextValue
  let latest!: ReturnType<typeof useLocalArtifactPreview>
  function Harness({ item }: { item: LocalArtifactItem }) {
    latest = useLocalArtifactPreview(item, cache)
    return null
  }
  const container = document.createElement("div")
  document.body.append(container)
  const root = createRoot(container)
  const render = async (item: LocalArtifactItem) => {
    await act(async () =>
      root.render(
        <AppContext.Provider value={appContext}>
          <Harness item={item} />
        </AppContext.Provider>,
      ),
    )
  }
  await render(initialItem)
  return {
    get latest() {
      return latest
    },
    render,
    async dispose() {
      await act(async () => root.unmount())
      container.remove()
    },
  }
}

it("bounds automatic retries until the actual resource loads successfully", async () => {
  const item = artifact("retry.png", "image/png")
  const invoke = vi.fn(async () => ({ kind: "image", mime: item.mime, resourceUrl: "wanta-resource://artifact/test" }))
  const harness = await mountPreviewHook(invoke, item)
  try {
    await act(async () => {
      harness.latest.reload()
    })
    expect(invoke).toHaveBeenCalledTimes(2)
    await act(async () => {
      harness.latest.reload()
    })
    expect(invoke).toHaveBeenCalledTimes(2)
    await act(async () => {
      harness.latest.resourceLoaded()
    })
    await act(async () => {
      harness.latest.reload()
    })
    expect(invoke).toHaveBeenCalledTimes(3)
    await act(async () => {
      harness.latest.reload()
    })
    expect(invoke).toHaveBeenCalledTimes(3)
  } finally {
    await harness.dispose()
  }
})

it("explicit retry recovers after automatic retry is exhausted without starting another automatic loop", async () => {
  const item = artifact("manual-retry.png", "image/png")
  const invoke = vi.fn(async () => ({ kind: "image", mime: item.mime, resourceUrl: "wanta-resource://artifact/test" }))
  const harness = await mountPreviewHook(invoke, item)
  try {
    await act(async () => {
      harness.latest.reload()
    })
    await act(async () => {
      harness.latest.retry()
    })
    expect(invoke).toHaveBeenCalledTimes(3)
    await act(async () => {
      harness.latest.reload()
    })
    expect(invoke).toHaveBeenCalledTimes(3)
  } finally {
    await harness.dispose()
  }
})

it("equivalent item objects keep the existing in-flight subscription", async () => {
  const item = artifact("stable.txt", "text/plain")
  const request = deferred<LocalArtifactPreviewResult>()
  const invoke = vi.fn(() => request.promise)
  const harness = await mountPreviewHook(invoke, item)
  try {
    const reload = harness.latest.reload
    await harness.render({ ...item })
    expect(invoke).toHaveBeenCalledTimes(1)
    expect(harness.latest.reload).toBe(reload)
    await act(async () => {
      request.resolve({ kind: "text", mime: item.mime, text: "ready" })
    })
    expect(harness.latest).toMatchObject({ loading: false, preview: { text: "ready" } })
  } finally {
    await harness.dispose()
  }
})

it("reselecting a transiently failed file in the same panel performs a fresh load", async () => {
  const item = artifact("recover.txt", "text/plain")
  const other = artifact("other.txt", "text/plain")
  const invoke = vi
    .fn()
    .mockResolvedValueOnce({ kind: "unsupported", mime: item.mime, reason: "read_failed" })
    .mockResolvedValue({ kind: "text", mime: item.mime, text: "recovered" })
  const harness = await mountPreviewHook(invoke, item)
  try {
    expect(harness.latest.preview?.reason).toBe("read_failed")
    await harness.render(other)
    await harness.render(item)
    expect(invoke).toHaveBeenCalledTimes(3)
    expect(harness.latest).toMatchObject({ loading: false, preview: { text: "recovered" } })
  } finally {
    await harness.dispose()
  }
})
