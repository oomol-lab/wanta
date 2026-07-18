import { describe, expect, it, vi } from "vitest"
import { fetchWithRetry } from "./network-download.ts"

describe("fetchWithRetry", () => {
  it("retries transient HTTP failures with a bounded attempt count", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response("unavailable", { status: 503 }))
      .mockResolvedValueOnce(new Response("ok", { status: 200 }))

    const response = await fetchWithRetry("https://example.com/file", {}, { backoffMs: 0, fetcher })

    expect(response.status).toBe(200)
    expect(fetcher).toHaveBeenCalledTimes(2)
  })

  it("does not retry deterministic client errors", async () => {
    const fetcher = vi.fn<typeof fetch>(async () => new Response("missing", { status: 404 }))

    const response = await fetchWithRetry("https://example.com/file", {}, { backoffMs: 0, fetcher })

    expect(response.status).toBe(404)
    expect(fetcher).toHaveBeenCalledOnce()
  })

  it("retries network errors and returns the final response", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockRejectedValueOnce(new TypeError("network failed"))
      .mockResolvedValueOnce(new Response("ok", { status: 200 }))

    await expect(fetchWithRetry("https://example.com/file", {}, { backoffMs: 0, fetcher })).resolves.toMatchObject({
      status: 200,
    })
    expect(fetcher).toHaveBeenCalledTimes(2)
  })

  it("retries after an individual request timeout", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockImplementationOnce(
        async (_input, init) =>
          new Promise<Response>((_resolve, reject) => {
            const signal = init?.signal
            if (signal?.aborted) reject(signal.reason)
            else signal?.addEventListener("abort", () => reject(signal.reason), { once: true })
          }),
      )
      .mockResolvedValueOnce(new Response("ok", { status: 200 }))

    const response = await fetchWithRetry(
      "https://example.com/file",
      {},
      {
        attempts: 2,
        backoffMs: 0,
        fetcher,
        timeoutMs: 5,
      },
    )

    expect(response.status).toBe(200)
    expect(fetcher).toHaveBeenCalledTimes(2)
  })

  it("preserves a Request input signal and cancels retry backoff", async () => {
    const controller = new AbortController()
    const request = new Request("https://example.com/file", { signal: controller.signal })
    const fetcher = vi.fn<typeof fetch>(async () => new Response("unavailable", { status: 503 }))

    const response = fetchWithRetry(request, {}, { backoffMs: 10_000, fetcher })
    await vi.waitFor(() => expect(fetcher).toHaveBeenCalledOnce())
    controller.abort(new Error("Download was cancelled."))

    await expect(response).rejects.toThrow("Download was cancelled.")
    expect(fetcher).toHaveBeenCalledOnce()
  })
})
