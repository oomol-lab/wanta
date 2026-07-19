import { describe, expect, it, vi } from "vitest"
import { createSharedRequest, waitForSharedRequest } from "./shared-request.ts"

describe("shared request", () => {
  it("keeps the underlying request alive while another consumer still waits", async () => {
    let resolve: (value: string) => void = () => undefined
    const load = vi.fn(
      (_signal: AbortSignal) =>
        new Promise<string>((innerResolve) => {
          resolve = innerResolve
        }),
    )
    const request = createSharedRequest(load)
    const firstController = new AbortController()
    const secondController = new AbortController()
    const first = waitForSharedRequest(request, firstController.signal)
    const second = waitForSharedRequest(request, secondController.signal)
    const cancellation = new Error("first consumer cancelled")

    firstController.abort(cancellation)

    await expect(first).rejects.toBe(cancellation)
    expect(request.controller.signal.aborted).toBe(false)
    resolve("done")
    await expect(second).resolves.toBe("done")
    expect(load).toHaveBeenCalledOnce()
  })

  it("aborts the underlying request after its final consumer leaves", async () => {
    const load = vi.fn(
      (signal: AbortSignal) =>
        new Promise<string>((_resolve, reject) => {
          signal.addEventListener("abort", () => reject(signal.reason), { once: true })
        }),
    )
    const request = createSharedRequest(load)
    const controller = new AbortController()
    const consumer = waitForSharedRequest(request, controller.signal)

    controller.abort(new Error("cancelled"))

    await expect(consumer).rejects.toThrow("cancelled")
    expect(request.controller.signal.aborted).toBe(true)
  })
})
