import type { BrowserManager } from "./node.ts"

import { describe, expect, it, vi } from "vitest"
import { BrowserControlServer, parseBrowserControlRequest } from "./control-server.ts"

describe("browser control request", () => {
  it("keeps the runtime session outside action arguments", () => {
    expect(
      parseBrowserControlRequest({
        action: "click",
        args: { sessionId: "model-selected", target: "e4" },
        sessionId: "runtime-session",
      }),
    ).toEqual({ action: "click", sessionId: "runtime-session", target: "e4" })
  })

  it("preserves intentional empty fill text", () => {
    expect(
      parseBrowserControlRequest({
        action: "type",
        args: { target: "e2", text: "" },
        sessionId: "session",
      }),
    ).toMatchObject({ action: "type", target: "e2", text: "" })
  })

  it("bounds scroll distance", () => {
    expect(
      parseBrowserControlRequest({
        action: "scroll",
        args: { deltaY: 50_000 },
        sessionId: "session",
      }),
    ).toMatchObject({ deltaY: 5_000 })
  })
})

describe("browser control server", () => {
  it("requires its bearer token before dispatching a browser action", async () => {
    const execute = vi.fn(async () => ({ ok: true }))
    const server = new BrowserControlServer({ execute } as unknown as BrowserManager)
    try {
      const connection = await server.connection()
      const unauthorized = await fetch(`${connection.url}/v1/browser`, {
        body: JSON.stringify({ action: "read", sessionId: "session" }),
        headers: { "content-type": "application/json" },
        method: "POST",
      })
      expect(unauthorized.status).toBe(404)
      expect(execute).not.toHaveBeenCalled()

      const authorized = await fetch(`${connection.url}/v1/browser`, {
        body: JSON.stringify({ action: "read", sessionId: "session" }),
        headers: {
          authorization: `Bearer ${connection.token}`,
          "content-type": "application/json",
        },
        method: "POST",
      })
      expect(authorized.status).toBe(200)
      expect(execute).toHaveBeenCalledWith(
        { action: "read", sessionId: "session", target: undefined },
        expect.anything(),
      )
    } finally {
      await server.dispose()
    }
  })

  it("aborts an in-flight action when the tool request disconnects", async () => {
    let markStarted = (): void => undefined
    const started = new Promise<void>((resolve) => {
      markStarted = resolve
    })
    let markAborted = (): void => undefined
    const aborted = new Promise<void>((resolve) => {
      markAborted = resolve
    })
    const execute = vi.fn(
      async (_request: unknown, signal?: AbortSignal): Promise<{ ok: true }> =>
        new Promise((resolve) => {
          markStarted()
          signal?.addEventListener(
            "abort",
            () => {
              markAborted()
              resolve({ ok: true })
            },
            { once: true },
          )
        }),
    )
    const server = new BrowserControlServer({ execute } as unknown as BrowserManager)
    try {
      const connection = await server.connection()
      const controller = new AbortController()
      const request = fetch(`${connection.url}/v1/browser`, {
        body: JSON.stringify({ action: "read", sessionId: "session" }),
        headers: {
          authorization: `Bearer ${connection.token}`,
          "content-type": "application/json",
        },
        method: "POST",
        signal: controller.signal,
      })
      await started
      controller.abort()

      await expect(request).rejects.toThrow()
      await aborted
    } finally {
      await server.dispose()
    }
  })
})
