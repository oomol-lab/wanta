import { expect, test } from "vitest"
import {
  extractLocalImagePaths,
  extractMarkdownImageSources,
  localImagePreviewMarkerPrefix,
  normalizeLocalImageMarkdown,
  rewriteLocalImageMarkdown,
} from "./markdown-images.ts"

test("normalizeLocalImageMarkdown wraps local image paths containing spaces", () => {
  const path =
    "/Users/me/Library/Application Support/wanta/agent/artifacts/ses_example/1783833651476-turn/mucha-corgi.png"

  expect(normalizeLocalImageMarkdown(`![穆夏风柯基](${path})`)).toBe(`![穆夏风柯基](<${path}>)`)
})

test("normalizeLocalImageMarkdown preserves titles and valid destinations", () => {
  expect(normalizeLocalImageMarkdown('![image](/Users/me/output files/image.png "Preview")')).toBe(
    '![image](</Users/me/output files/image.png> "Preview")',
  )
  expect(normalizeLocalImageMarkdown("![image](</Users/me/output files/image.png> 'Preview')")).toBe(
    "![image](</Users/me/output files/image.png> 'Preview')",
  )
  expect(normalizeLocalImageMarkdown("![image](/tmp/output.png)")).toBe("![image](/tmp/output.png)")
})

test("normalizeLocalImageMarkdown supports Windows paths and excludes home-relative paths", () => {
  expect(normalizeLocalImageMarkdown(String.raw`![image](C:\Users\me\output files\image.png)`)).toBe(
    String.raw`![image](<C:\Users\me\output files\image.png>)`,
  )
  expect(normalizeLocalImageMarkdown("![image](~/output files/image.png)")).toBe("![image](~/output files/image.png)")
})

test("rewriteLocalImageMarkdown preserves placement with a renderer-safe marker", () => {
  expect(rewriteLocalImageMarkdown(String.raw`Result: ![Windows](C:\Users\me\output.png)`)).toBe(
    `Result: ![Windows](${localImagePreviewMarkerPrefix}C%3A%5CUsers%5Cme%5Coutput.png)`,
  )
  expect(rewriteLocalImageMarkdown("Result: ![macOS](</Users/me/output files/image.png>)")).toBe(
    `Result: ![macOS](${localImagePreviewMarkerPrefix}%2FUsers%2Fme%2Foutput%20files%2Fimage.png)`,
  )
  expect(rewriteLocalImageMarkdown("![remote](https://example.com/image.png)")).toBe(
    "![remote](https://example.com/image.png)",
  )
})

test("rewriteLocalImageMarkdown preserves optional image titles", () => {
  expect(rewriteLocalImageMarkdown(String.raw`![quoted](C:\Users\me\image.png "Preview")`)).toBe(
    `![quoted](${localImagePreviewMarkerPrefix}C%3A%5CUsers%5Cme%5Cimage.png "Preview")`,
  )
  expect(rewriteLocalImageMarkdown(`![parenthesized](/tmp/image.png (Preview))`)).toBe(
    `![parenthesized](${localImagePreviewMarkerPrefix}%2Ftmp%2Fimage.png (Preview))`,
  )
})

test("markdown image helpers ignore fenced and indented code", () => {
  const markdown = [
    "![real](/Users/me/output files/real.png)",
    "```md",
    "![fenced](/Users/me/output files/fenced.png)",
    "```",
    "    ![indented](/Users/me/output files/indented.png)",
  ].join("\n")

  expect(normalizeLocalImageMarkdown(markdown)).toBe(
    [
      "![real](</Users/me/output files/real.png>)",
      "```md",
      "![fenced](/Users/me/output files/fenced.png)",
      "```",
      "    ![indented](/Users/me/output files/indented.png)",
    ].join("\n"),
  )
  expect(extractMarkdownImageSources(markdown)).toEqual(["/Users/me/output files/real.png"])
})

test("extractMarkdownImageSources reads local, remote, data, and titled images", () => {
  expect(
    extractMarkdownImageSources(
      [
        "![local](/Users/me/output files/image.png)",
        "![remote](https://example.com/image.png)",
        "![data](<data:image/png;base64,abc>)",
        '![title](https://example.com/titled.png "Preview")',
      ].join("\n"),
    ),
  ).toEqual([
    "/Users/me/output files/image.png",
    "https://example.com/image.png",
    "data:image/png;base64,abc",
    "https://example.com/titled.png",
  ])
})

test("markdown image helpers ignore inline code examples", () => {
  const markdown = [
    "`![example](/Users/me/output files/example.png)`",
    "![real](/Users/me/output files/real.png)",
  ].join("\n")

  expect(normalizeLocalImageMarkdown(markdown)).toBe(
    ["`![example](/Users/me/output files/example.png)`", "![real](</Users/me/output files/real.png>)"].join("\n"),
  )
  expect(extractMarkdownImageSources(markdown)).toEqual(["/Users/me/output files/real.png"])
})

test("extractLocalImagePaths ignores code examples but keeps explicit inline paths", () => {
  expect(
    extractLocalImagePaths(
      [
        "Saved to `/Users/me/output files/real.png`.",
        "```text",
        "/Users/me/output files/fenced.png",
        "```",
        "Inline example: `![image](/Users/me/output files/example.png)`.",
        "Remote: https://example.com/remote.png",
      ].join("\n"),
    ),
  ).toEqual(["/Users/me/output files/real.png"])
})
