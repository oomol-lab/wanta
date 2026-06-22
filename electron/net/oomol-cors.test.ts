import { describe, expect, it } from "vitest"
import { applyOomolCors } from "./oomol-cors.ts"

describe("applyOomolCors", () => {
  it("leaves responses untouched when there is no Origin (not a cross-site request)", () => {
    const responseHeaders = { "content-type": ["application/json"] }
    const result = applyOomolCors({
      method: "GET",
      origin: undefined,
      requestedHeaders: undefined,
      responseHeaders,
    })
    expect(result.statusLine).toBeUndefined()
    expect(result.responseHeaders).toBe(responseHeaders)
  })

  it("reflects the request Origin and allows credentials on a normal GET", () => {
    const result = applyOomolCors({
      method: "GET",
      origin: "http://localhost:5273",
      requestedHeaders: undefined,
      responseHeaders: { "content-type": ["application/json"] },
    })
    expect(result.responseHeaders["Access-Control-Allow-Origin"]).toEqual(["http://localhost:5273"])
    expect(result.responseHeaders["Access-Control-Allow-Credentials"]).toEqual(["true"])
    expect(result.responseHeaders["Vary"]).toEqual(["Origin"])
    expect(result.statusLine).toBeUndefined()
  })

  it("reflects a file:// / null origin (packaged renderer) verbatim", () => {
    const result = applyOomolCors({
      method: "GET",
      origin: "null",
      requestedHeaders: undefined,
      responseHeaders: {},
    })
    expect(result.responseHeaders["Access-Control-Allow-Origin"]).toEqual(["null"])
    expect(result.responseHeaders["Access-Control-Allow-Credentials"]).toEqual(["true"])
  })

  it("never emits a wildcard Access-Control-Allow-Origin (illegal with credentials)", () => {
    const result = applyOomolCors({
      method: "GET",
      origin: "http://localhost:5273",
      requestedHeaders: undefined,
      responseHeaders: {},
    })
    expect(result.responseHeaders["Access-Control-Allow-Origin"]).not.toEqual(["*"])
  })

  it("answers a preflight OPTIONS with 200 + methods/headers/max-age", () => {
    const result = applyOomolCors({
      method: "OPTIONS",
      origin: "http://localhost:5273",
      requestedHeaders: "x-oo-organization-name,content-type",
      responseHeaders: {},
    })
    expect(result.statusLine).toBe("HTTP/1.1 200 OK")
    expect(result.responseHeaders["Access-Control-Allow-Methods"]?.[0]).toContain("POST")
    // Access-Control-Request-Headers is reflected so any custom header passes preflight.
    expect(result.responseHeaders["Access-Control-Allow-Headers"]).toEqual(["x-oo-organization-name,content-type"])
    expect(result.responseHeaders["Access-Control-Max-Age"]).toEqual(["600"])
  })

  it("falls back to a default allow-headers list when the preflight omits the requested headers", () => {
    const result = applyOomolCors({
      method: "OPTIONS",
      origin: "null",
      requestedHeaders: undefined,
      responseHeaders: {},
    })
    expect(result.responseHeaders["Access-Control-Allow-Headers"]?.[0]).toContain("x-oo-organization-name")
  })

  it("strips any server-sent CORS headers to avoid duplicate-header CORS failures", () => {
    const result = applyOomolCors({
      method: "GET",
      origin: "http://localhost:5273",
      requestedHeaders: undefined,
      responseHeaders: {
        "Access-Control-Allow-Origin": ["https://chat.oomol.com"],
        "access-control-allow-credentials": ["true"],
        "content-type": ["application/json"],
      },
    })
    expect(result.responseHeaders["Access-Control-Allow-Origin"]).toEqual(["http://localhost:5273"])
    // Only one ACAO survives (ours); the server's conflicting copy is removed.
    const acaoKeys = Object.keys(result.responseHeaders).filter(
      (name) => name.toLowerCase() === "access-control-allow-origin",
    )
    expect(acaoKeys).toHaveLength(1)
    expect(result.responseHeaders["content-type"]).toEqual(["application/json"])
  })

  it("preserves and extends an existing Vary header", () => {
    const result = applyOomolCors({
      method: "GET",
      origin: "http://localhost:5273",
      requestedHeaders: undefined,
      responseHeaders: { Vary: ["Accept-Encoding"] },
    })
    expect(result.responseHeaders["Vary"]?.[0]).toContain("Accept-Encoding")
    expect(result.responseHeaders["Vary"]?.[0]).toContain("Origin")
  })
})
