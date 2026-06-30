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

  it("does NOT inject CORS for an origin outside the renderer allowlist", () => {
    const responseHeaders = { "content-type": ["application/json"] }
    for (const origin of ["https://evil.example.com", "https://chat.oomol.com", "http://localhost.evil.com"]) {
      const result = applyOomolCors({ method: "GET", origin, requestedHeaders: undefined, responseHeaders })
      expect(result.responseHeaders["Access-Control-Allow-Origin"]).toBeUndefined()
      expect(result.responseHeaders).toBe(responseHeaders)
      expect(result.statusLine).toBeUndefined()
    }
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
    // 回显 Access-Control-Request-Headers，确保任意自定义请求头都能通过预检。
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
    expect(result.responseHeaders["Access-Control-Allow-Headers"]?.[0]).toContain("x-oo-organization-id")
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
    // 只保留一个 ACAO（本地注入的值）；服务端冲突的那份被移除。
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
