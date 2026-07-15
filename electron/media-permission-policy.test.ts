import { describe, expect, it } from "vitest"
import { isAudioOnlyMediaRequest, isTrustedRendererUrl } from "./media-permission-policy.ts"

describe("isAudioOnlyMediaRequest", () => {
  it("allows microphone-only requests and rejects broader media access", () => {
    expect(isAudioOnlyMediaRequest(["audio"])).toBe(true)
    expect(isAudioOnlyMediaRequest(["audio", "video"])).toBe(false)
    expect(isAudioOnlyMediaRequest(["video"])).toBe(false)
    expect(isAudioOnlyMediaRequest([])).toBe(false)
    expect(isAudioOnlyMediaRequest(undefined)).toBe(false)
  })
})

describe("isTrustedRendererUrl", () => {
  it("allows only the configured development server origin", () => {
    expect(isTrustedRendererUrl("http://localhost:5273/chat", "http://localhost:5273", "file:///app/dist/")).toBe(true)
    expect(isTrustedRendererUrl("http://localhost:5274/chat", "http://localhost:5273", "file:///app/dist/")).toBe(false)
    expect(isTrustedRendererUrl("https://example.test/", "http://localhost:5273", "file:///app/dist/")).toBe(false)
  })

  it("allows only files inside the packaged renderer directory", () => {
    expect(isTrustedRendererUrl("file:///app/dist/index.html", undefined, "file:///app/dist/")).toBe(true)
    expect(isTrustedRendererUrl("file:///tmp/untrusted.html", undefined, "file:///app/dist/")).toBe(false)
    expect(isTrustedRendererUrl(undefined, undefined, "file:///app/dist/")).toBe(false)
  })
})
