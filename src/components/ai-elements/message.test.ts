import { describe, expect, it } from "vitest"
import { compactLocalPath, messageResponseControls, normalizeSingleLocalPathCodeFences } from "./message.tsx"

describe("messageResponseControls", () => {
  it("keeps code blocks copyable but disables text downloads by default", () => {
    expect(messageResponseControls(undefined)).toEqual({
      table: false,
      code: {
        copy: true,
        download: false,
      },
    })
  })

  it("preserves explicit controls overrides", () => {
    expect(messageResponseControls({ code: { download: true } })).toEqual({
      table: false,
      code: {
        copy: true,
        download: true,
      },
    })
    expect(messageResponseControls({ table: true, code: false })).toEqual({
      table: true,
      code: false,
    })
  })
})

describe("normalizeSingleLocalPathCodeFences", () => {
  it("turns a path-only fenced block into inline code", () => {
    expect(
      normalizeSingleLocalPathCodeFences(
        ["文件路径：", "```", "/Users/me/Library/Application Support/lumo/agent/artifacts/turn/image.png", "```"].join(
          "\n",
        ),
      ),
    ).toBe("文件路径：\n`/Users/me/Library/Application Support/lumo/agent/artifacts/turn/image.png`")
  })

  it("leaves real code blocks unchanged", () => {
    const markdown = ["```ts", "const path = '/tmp/image.png'", "console.log(path)", "```"].join("\n")

    expect(normalizeSingleLocalPathCodeFences(markdown)).toBe(markdown)
  })
})

describe("compactLocalPath", () => {
  it("keeps short paths readable", () => {
    expect(compactLocalPath("/tmp/image.png")).toBe("/tmp/image.png")
  })

  it("middle-truncates long local paths", () => {
    expect(compactLocalPath("/Users/me/Library/Application Support/lumo/agent/artifacts/turn/image.png", 32)).toBe(
      "/Users/me/Libr.../turn/image.png",
    )
  })

  it("decodes file URLs before compacting", () => {
    expect(compactLocalPath("file:///Users/me/output%20files/report.pdf")).toBe("/Users/me/output files/report.pdf")
  })

  it("normalizes Windows file URLs before compacting", () => {
    expect(compactLocalPath("file:///C:/Users/me/output%20files/report.pdf")).toBe(
      "C:/Users/me/output files/report.pdf",
    )
  })
})
