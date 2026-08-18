import { describe, expect, it } from "vitest"
import {
  isAllowedMainWindowSubframeNavigation,
  isAudioOnlyMediaRequest,
  isTrustedRendererUrl,
} from "./media-permission-policy.ts"

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
    expect(
      isTrustedRendererUrl("http://localhost:5273@example.test/chat", "http://localhost:5273", "file:///app/dist/"),
    ).toBe(false)
    expect(isTrustedRendererUrl("https://example.test/", "http://localhost:5273", "file:///app/dist/")).toBe(false)
  })

  it("allows only files inside the packaged renderer directory", () => {
    expect(isTrustedRendererUrl("file:///app/dist/index.html", undefined, "file:///app/dist/")).toBe(true)
    expect(isTrustedRendererUrl("file:///app/dist/assets/app.js", undefined, "file:///app/dist/")).toBe(true)
    expect(isTrustedRendererUrl("file:///tmp/untrusted.html", undefined, "file:///app/dist/")).toBe(false)
    expect(isTrustedRendererUrl("file:///app/dist/../untrusted.html", undefined, "file:///app/dist/")).toBe(false)
    expect(isTrustedRendererUrl("file:///app/dist/%2e%2e/untrusted.html", undefined, "file:///app/dist/")).toBe(false)
    expect(isTrustedRendererUrl("https://example.test/index.html", undefined, "file:///app/dist/")).toBe(false)
    expect(isTrustedRendererUrl(undefined, undefined, "file:///app/dist/")).toBe(false)
  })
})

describe("isAllowedMainWindowSubframeNavigation", () => {
  it("allows initial inline-frame documents and blocks navigations away from their injected policy", () => {
    expect(isAllowedMainWindowSubframeNavigation("about:blank")).toBe(true)
    expect(isAllowedMainWindowSubframeNavigation("about:srcdoc")).toBe(true)
    expect(isAllowedMainWindowSubframeNavigation("https://example.test/")).toBe(false)
    expect(isAllowedMainWindowSubframeNavigation("data:text/html,escaped")).toBe(false)
    expect(isAllowedMainWindowSubframeNavigation("file:///tmp/untrusted.html")).toBe(false)
  })
})
