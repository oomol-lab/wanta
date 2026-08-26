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
