import { afterEach, describe, expect, it, vi } from "vitest"
import { oomolAuthRequiredEventName, oomolFetch } from "./oomol-http.ts"

describe("oomolFetch", () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it("uses the httpOnly session cookie transport without renderer credential headers", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => new Response("{}"))
    vi.stubGlobal("fetch", fetchMock)

    await oomolFetch("/v1/demo", { headers: { "X-Test": "1" } })

    expect(fetchMock).toHaveBeenCalledOnce()
    const [, init] = fetchMock.mock.calls[0] ?? []
    expect(init?.credentials).toBe("include")
    const headers = new Headers(init?.headers)
    expect(headers.get("Accept")).toBe("application/json")
    expect(headers.get("X-Test")).toBe("1")
    expect(headers.get("Authorization")).toBeNull()
    expect(headers.get("Cookie")).toBeNull()
  })

  it("rejects renderer Authorization and Cookie headers", async () => {
    expect(() => oomolFetch("/v1/demo", { headers: { Authorization: "Bearer secret" } })).toThrow(
      /must not set authorization/i,
    )

    expect(() => oomolFetch("/v1/demo", { headers: new Headers({ Cookie: "oomol-token=secret" }) })).toThrow(
      /must not set cookie/i,
    )
  })

  it("combines caller cancellation with the request deadline", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => new Response("{}"))
    vi.stubGlobal("fetch", fetchMock)
    const controller = new AbortController()

    await oomolFetch("/v1/demo", { signal: controller.signal, timeoutMs: 30_000 })
    controller.abort()

    const requestSignal = fetchMock.mock.calls[0]?.[1]?.signal
    expect(requestSignal).toBeInstanceOf(AbortSignal)
    expect(requestSignal).not.toBe(controller.signal)
    expect(requestSignal?.aborted).toBe(true)
  })

  it("notifies the renderer auth gate when a direct OOMOL request returns 401", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => new Response("unauthorized", { status: 401 }))
    const dispatchEvent = vi.fn()
    vi.stubGlobal("fetch", fetchMock)
    vi.stubGlobal("window", { dispatchEvent })
    vi.stubGlobal(
      "CustomEvent",
      class CustomEventMock<T> extends Event {
        readonly detail: T

        constructor(type: string, init: CustomEventInit<T>) {
          super(type)
          this.detail = init.detail as T
        }
      },
    )

    await oomolFetch("/v1/demo")

    expect(dispatchEvent).toHaveBeenCalledOnce()
    const [event] = dispatchEvent.mock.calls[0] ?? []
    expect(event).toMatchObject({
      detail: { requestedAt: expect.any(Number), status: 401 },
      type: oomolAuthRequiredEventName,
    })
  })
})
