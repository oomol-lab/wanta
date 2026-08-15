import type { BrowserControlRequest, BrowserControlResult } from "../browser/node.ts"

import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { pathToFileURL } from "node:url"
import { describe, expect, test, vi } from "vitest"
import { createBrowserHostCapability } from "./browser-host-capability.ts"
import { HostCapabilityKernel } from "./host-capability.ts"

describe("browser host capability", () => {
  test("binds the Wanta session and never accepts an agent-supplied session", async () => {
    const requests: BrowserControlRequest[] = []
    const signals: Array<AbortSignal | undefined> = []
    const kernel = new HostCapabilityKernel()
    kernel.register(
      createBrowserHostCapability({
        execute: (request, signal) => {
          requests.push(request)
          signals.push(signal)
          return Promise.resolve({ title: "Example", url: "https://example.com" } as BrowserControlResult)
        },
      }),
    )

    const controller = new AbortController()
    const result = await kernel.execute(
      "browser",
      "browser_navigate",
      { bindings: {}, sessionId: "trusted-session" },
      { sessionId: "forged-session", url: "https://example.com" },
      controller.signal,
    )

    expect(requests).toEqual([{ action: "navigate", sessionId: "trusted-session", url: "https://example.com" }])
    expect(signals).toEqual([controller.signal])
    expect(JSON.parse(result.text)).toEqual({ title: "Example", url: "https://example.com" })
  })

  test("normalizes scroll defaults and bounds at the shared contract", async () => {
    const requests: BrowserControlRequest[] = []
    const kernel = new HostCapabilityKernel()
    kernel.register(
      createBrowserHostCapability({
        execute: (request) => {
          requests.push(request)
          return Promise.resolve({} as BrowserControlResult)
        },
      }),
    )

    await kernel.execute("browser", "browser_scroll", { bindings: {}, sessionId: "session-1" }, {})
    await kernel.execute(
      "browser",
      "browser_scroll",
      { bindings: {}, sessionId: "session-1" },
      { deltaX: -9000, deltaY: 9000 },
    )

    expect(requests).toEqual([
      { action: "scroll", deltaX: 0, deltaY: 600, sessionId: "session-1", target: undefined },
      { action: "scroll", deltaX: -5000, deltaY: 5000, sessionId: "session-1", target: undefined },
    ])
  })

  test("returns screenshots as MCP-native image content with a text fallback", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "wanta-browser-host-"))
    const screenshot = path.join(root, "browser.png")
    await writeFile(screenshot, Buffer.from([137, 80, 78, 71]))
    const kernel = new HostCapabilityKernel()
    kernel.register(
      createBrowserHostCapability({
        execute: () =>
          Promise.resolve({
            fileUrl: pathToFileURL(screenshot).href,
            title: "Example",
            url: "https://example.com",
          }),
      }),
    )
    try {
      const result = await kernel.execute("browser", "browser_screenshot", { bindings: {}, sessionId: "session-1" }, {})
      expect(JSON.parse(result.text)).toEqual({ title: "Example", url: "https://example.com" })
      expect(result.content).toEqual([
        { type: "text", text: result.text },
        { type: "image", data: Buffer.from([137, 80, 78, 71]).toString("base64"), mimeType: "image/png" },
      ])
    } finally {
      await rm(root, { force: true, recursive: true })
    }
  })

  test("rejects screenshots larger than the host capability limit before reading them", async () => {
    const read = vi.fn(async () => Buffer.from("must not be read"))
    const kernel = new HostCapabilityKernel()
    kernel.register(
      createBrowserHostCapability(
        {
          execute: () =>
            Promise.resolve({
              fileUrl: "file:///oversized-browser.png",
              title: "Large",
              url: "https://example.com",
            }),
        },
        { read, size: async () => 16 * 1024 * 1024 + 1 },
      ),
    )
    await expect(
      kernel.execute("browser", "browser_screenshot", { bindings: {}, sessionId: "session-1" }, {}),
    ).rejects.toThrow(/16 MiB/)
    expect(read).not.toHaveBeenCalled()
  })
})
