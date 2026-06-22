import { describe, expect, it } from "vitest"
import { htmlPreviewSrcDoc } from "./artifact-html-preview.ts"

describe("htmlPreviewSrcDoc", () => {
  it("keeps an existing doctype first when injecting preview head content", () => {
    const source = "<!doctype html><html><body><h1>Preview</h1></body></html>"
    const result = htmlPreviewSrcDoc(source)

    expect(result.toLowerCase().startsWith("<!doctype html>")).toBe(true)
    expect(result).toContain("<head>")
    expect(result).toContain('http-equiv="Content-Security-Policy"')
    expect(result.indexOf("<head>")).toBeGreaterThan(result.toLowerCase().indexOf("<!doctype html>"))
  })

  it("injects preview head content into existing head elements", () => {
    const source =
      '<!doctype html><html><head><title>x</title></head><body><img src="https://example.com/x.png"></body></html>'
    const result = htmlPreviewSrcDoc(source)

    expect(result).toContain('<head><meta http-equiv="Content-Security-Policy"')
    expect(result).toContain("<title>x</title>")
  })
})
