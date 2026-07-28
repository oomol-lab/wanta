import { describe, expect, it } from "vitest"
import { isAllowedBrowserUrl, normalizeBrowserBounds, parseBrowserUrl } from "./policy.ts"

describe("browser URL policy", () => {
  it("normalizes ordinary host input", () => {
    expect(parseBrowserUrl("example.com/path").href).toBe("https://example.com/path")
  })

  it("normalizes a bare local development host with a port", () => {
    expect(parseBrowserUrl("localhost:5173").href).toBe("https://localhost:5173/")
  })

  it("allows web URLs and the internal blank page", () => {
    expect(isAllowedBrowserUrl("https://example.com")).toBe(true)
    expect(isAllowedBrowserUrl("http://localhost:3000")).toBe(true)
    expect(isAllowedBrowserUrl("about:blank")).toBe(true)
  })

  it("rejects local and active-content protocols", () => {
    expect(() => parseBrowserUrl("file:///tmp/private")).toThrow(/HTTP and HTTPS/)
    expect(() => parseBrowserUrl("javascript:alert(1)")).toThrow(/HTTP and HTTPS/)
  })
})

describe("browser bounds", () => {
  it("keeps a native view inside the window content bounds", () => {
    expect(
      normalizeBrowserBounds({ height: 500, width: 700, x: 600, y: -10 }, { height: 720, width: 1080, x: 0, y: 0 }),
    ).toEqual({ height: 500, width: 480, x: 600, y: 0 })
  })
})
