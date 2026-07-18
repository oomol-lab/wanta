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
})
