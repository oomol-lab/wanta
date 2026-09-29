import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { createFlowHost } from "./host.ts"
import { openFlowBaseUrl } from "@/lib/domain"

vi.mock("sonner", () => ({ toast: { dismiss: vi.fn(), error: vi.fn(() => "error"), success: vi.fn(() => "success") } }))

class FakeSocket extends EventTarget {
  static instances: FakeSocket[] = []
  close = vi.fn(() => this.dispatchEvent(new Event("close")))
  constructor(readonly url: URL) {
    super()
    FakeSocket.instances.push(this)
  }
  message(value: unknown) {
    const event = new Event("message")
    Object.assign(event, { data: typeof value === "string" ? value : JSON.stringify(value) })
    this.dispatchEvent(event)
  }
}

const hosts: ReturnType<typeof createFlowHost>[] = []
function host(writable = true) {
  const value = createFlowHost({ teamName: "team / A", writable, readOnlyMessage: "Read only", openExternal: vi.fn() })
  hosts.push(value)
  return value
}
beforeEach(() => {
  vi.useFakeTimers()
  FakeSocket.instances = []
  vi.stubGlobal("WebSocket", FakeSocket)
})
afterEach(() => {
  hosts.splice(0).forEach((value) => value.dispose())
  vi.useRealTimers()
  vi.unstubAllGlobals()
  vi.clearAllMocks()
})

describe("Flow host requests", () => {
  it("preserves Request bodies, merges init overrides and enforces the current team", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => new Response(null, { status: 204 }))
    vi.stubGlobal("fetch", fetchMock)
    const controller = new AbortController()
    await host().request(
      new Request(`${openFlowBaseUrl}/v1/flows/a`, {
        method: "POST",
        body: "payload",
        signal: controller.signal,
        headers: { "content-type": "text/plain", "x-original": "yes", "x-oo-team-name": "wrong" },
      }),
      { headers: { "x-init": "yes" }, method: "PATCH" },
    )
    const [request, init] = fetchMock.mock.calls[0]!
    expect(await (request as Request).text()).toBe("payload")
    expect(init?.method).toBe("PATCH")
    expect(init?.credentials).toBe("include")
    expect(init?.redirect).toBe("error")
    expect(new Headers(init?.headers).get("x-original")).toBe("yes")
    expect(new Headers(init?.headers).get("x-init")).toBe("yes")
    expect(new Headers(init?.headers).get("x-oo-team-name")).toBe("team / A")
    controller.abort()
    expect(init?.signal?.aborted).toBe(true)
  })

  it("aborts outstanding requests and rejects later requests when disposed", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => new Response("{}"))
    vi.stubGlobal("fetch", fetchMock)
    const value = host()
    await value.request("/v1/flows")
    const signal = fetchMock.mock.calls[0]![1]!.signal!
    expect(signal.aborted).toBe(false)
    value.dispose()
    expect(signal.aborted).toBe(true)
    await expect(value.request("/v1/flows")).rejects.toThrow()
    expect(fetchMock).toHaveBeenCalledOnce()
  })

  it("rejects foreign origins and credentials without fetching", async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal("fetch", fetchMock)
    const value = host()
    await expect(value.request("https://example.com/v1/flows")).rejects.toThrow(/configured/)
    await expect(value.request("//example.com/v1/flows")).rejects.toThrow(/configured/)
    await expect(value.request("/v1/flows", { headers: { authorization: "secret" } })).rejects.toThrow(
      /credential|authorization/,
    )
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it("allows reads but blocks mutations in a read-only workspace", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => new Response("{}"))
    vi.stubGlobal("fetch", fetchMock)
    const value = host(false)
    expect((await value.request("/v1/flows")).status).toBe(200)
    for (const method of ["POST", "PUT", "PATCH", "DELETE"]) {
      const response = await value.request("/v1/flows", { method })
      expect(response.status).toBe(403)
      expect(await response.json()).toEqual({ error: { code: "permission.denied", message: "Read only" } })
    }
    expect(fetchMock).toHaveBeenCalledOnce()
  })

  it("opens only the resolved external URL and propagates failures", async () => {
    const openExternal = vi.fn().mockResolvedValue(undefined)
    const value = createFlowHost({ teamName: "a", writable: true, readOnlyMessage: "", openExternal })
    hosts.push(value)
    expect(await value.openExternalPage(async () => "https://example.com/authorize")).toBe(true)
    expect(openExternal).toHaveBeenCalledWith("https://example.com/authorize")
    await expect(value.openExternalPage(async () => "file:///tmp/a")).rejects.toThrow(/Invalid/)
    openExternal.mockRejectedValueOnce(new Error("Cannot open"))
    await expect(value.openExternalPage(async () => "https://example.com/")).rejects.toThrow("Cannot open")
    expect(openExternal).toHaveBeenCalledTimes(2)
  })

  it("does not open a late authorization result after the scope is disposed", async () => {
    const openExternal = vi.fn()
    const value = createFlowHost({ teamName: "a", writable: true, readOnlyMessage: "", openExternal })
    hosts.push(value)
    let finish!: (url: string) => void
    const opening = value.openExternalPage(
      () =>
        new Promise((resolve) => {
          finish = resolve
        }),
    )
    value.dispose()
    finish("https://example.com/")
    await expect(opening).rejects.toThrow()
    expect(openExternal).not.toHaveBeenCalled()
  })
})

describe("Flow subscriptions", () => {
  it("uses independent authenticated WSS endpoints and validates events", async () => {
    const value = host()
    const catalogListener = vi.fn()
    const flowListener = vi.fn()
    const catalog = value.subscribeFlowCatalog(catalogListener)
    const flow = value.subscribeFlow("flow/1", flowListener)
    const [catalogSocket, flowSocket] = FakeSocket.instances
    expect(catalogSocket.url.protocol).toBe("wss:")
    expect(catalogSocket.url.searchParams.get("teamName")).toBe("team / A")
    expect(flowSocket.url.pathname).toBe("/v1/flows/flow%2F1/notifications")
    catalogSocket.dispatchEvent(new Event("open"))
    flowSocket.dispatchEvent(new Event("open"))
    await Promise.all([catalog.ready, flow.ready])
    catalogSocket.message("invalid")
    catalogSocket.message({ version: 1, kind: "flows.changed" })
    flowSocket.message({ version: 1, kind: "draft.changed", flowId: "other", revisionId: "r" })
    flowSocket.message({ version: 1, kind: "draft.changed", flowId: "flow/1" })
    flowSocket.message({ version: 1, kind: "draft.changed", flowId: "flow/1", revisionId: "r" })
    expect(catalogListener).toHaveBeenCalledOnce()
    expect(flowListener).toHaveBeenCalledExactlyOnceWith({
      version: 1,
      kind: "draft.changed",
      flowId: "flow/1",
      revisionId: "r",
    })
    flow.stop()
    expect(flowSocket.close).toHaveBeenCalledOnce()
    expect(catalogSocket.close).not.toHaveBeenCalled()
    value.dispose()
    expect(catalogSocket.close).toHaveBeenCalledOnce()
  })

  it("resyncs after reconnect and cancels pending reconnects on stop", async () => {
    const listener = vi.fn()
    const subscription = host().subscribeFlowCatalog(listener)
    FakeSocket.instances[0].dispatchEvent(new Event("open"))
    FakeSocket.instances[0].dispatchEvent(new Event("close"))
    await vi.advanceTimersByTimeAsync(1_250)
    expect(FakeSocket.instances).toHaveLength(2)
    FakeSocket.instances[1].dispatchEvent(new Event("open"))
    expect(listener).toHaveBeenCalledWith()
    FakeSocket.instances[1].dispatchEvent(new Event("close"))
    subscription.stop()
    await vi.advanceTimersByTimeAsync(60_000)
    expect(FakeSocket.instances).toHaveLength(2)
    FakeSocket.instances[1].message({ kind: "flows.changed", version: 1 })
    expect(listener).toHaveBeenCalledTimes(1)
  })

  it("forwards the current package's creation, run updates and access revision events", () => {
    const catalogListener = vi.fn()
    const flowListener = vi.fn()
    const value = host()
    value.subscribeFlowCatalog(catalogListener)
    value.subscribeFlow("a", flowListener)
    FakeSocket.instances[0].message({ version: 1, kind: "flow.created", flowId: "a" })
    FakeSocket.instances[0].message({ version: 1, kind: "flow.created" })
    FakeSocket.instances[1].message({ version: 1, kind: "run.changed", flowId: "a", runId: "r" })
    FakeSocket.instances[1].message({ version: 1, kind: "access.changed", flowId: "a", accessRevision: 2 })
    FakeSocket.instances[1].message({ version: 1, kind: "access.changed", flowId: "a", accessRevision: "2" })
    expect(catalogListener).toHaveBeenCalledExactlyOnceWith({ version: 1, kind: "flow.created", flowId: "a" })
    expect(flowListener.mock.calls).toEqual([
      [{ version: 1, kind: "run.changed", flowId: "a", runId: "r" }],
      [{ version: 1, kind: "access.changed", flowId: "a", accessRevision: 2 }],
    ])
  })

  it("releases the ready gate on timeout or early stop", async () => {
    const first = host().subscribeFlowCatalog(vi.fn())
    await vi.advanceTimersByTimeAsync(5_000)
    await first.ready
    const second = host().subscribeFlowCatalog(vi.fn())
    second.stop()
    await second.ready
  })
})
