import { describe, expect, it } from "vitest"
import { formatToolOutputPreview, toolOutputPreviewLimitChars } from "./tool-output-preview.ts"

describe("formatToolOutputPreview", () => {
  it("pretty prints a JSON result that fits inside the preview limit", () => {
    expect(formatToolOutputPreview('{"project":"PostHog","count":2}')).toEqual({
      text: '{\n  "project": "PostHog",\n  "count": 2\n}',
      truncated: false,
    })
  })

  it("keeps a non-JSON result unchanged", () => {
    expect(formatToolOutputPreview("connector returned plain text")).toEqual({
      text: "connector returned plain text",
      truncated: false,
    })
  })

  it("bounds oversized output before attempting JSON formatting", () => {
    const output = `{"rows":"${"x".repeat(toolOutputPreviewLimitChars)}"}`

    expect(formatToolOutputPreview(output)).toEqual({
      text: `${output.slice(0, toolOutputPreviewLimitChars)}\n…`,
      truncated: true,
    })
  })

  it("bounds JSON whose indentation expands beyond the preview limit", () => {
    const output = JSON.stringify(Array.from({ length: 4_000 }, () => ({ x: 1 })))
    const preview = formatToolOutputPreview(output)
    expect(preview.truncated).toBe(true)
    expect(preview.text).toHaveLength(toolOutputPreviewLimitChars + 2)
  })
})
