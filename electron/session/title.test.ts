import { describe, expect, it } from "vitest"
import {
  buildFallbackSessionTitle,
  sanitizeGeneratedSessionTitle,
  shouldAutoRefreshSessionTitle,
  trimTitleToColumns,
} from "./title.ts"

describe("session title helpers", () => {
  it("normalizes whitespace for fallback titles", () => {
    expect(buildFallbackSessionTitle({ text: "  查   Hacker News\n热门故事  " })).toBe("查 Hacker News 热门故事")
  })

  it("does not use a bare URL as the fallback title", () => {
    expect(buildFallbackSessionTitle({ text: "https://detail.example.com/offer/123.html" })).toBe(
      "Review detail.example.com",
    )
  })

  it("trims by display columns", () => {
    expect(trimTitleToColumns("检查图卡编码与点击对话并调整侧边任务栏的新建机制")).toBe(
      "检查图卡编码与点击对话并调整...",
    )
    expect(trimTitleToColumns("Search 1688 product images with Metaso and Puppeteer")).toBe(
      "Search 1688 product images wi...",
    )
  })

  it("cleans model output before storing it", () => {
    expect(
      sanitizeGeneratedSessionTitle("标题：查找 1688 商品图片。\nextra", {
        text: "https://detail.example.com/offer/123.html",
      }),
    ).toBe("查找 1688 商品图片")
  })

  it("falls back when the model returns a URL", () => {
    expect(
      sanitizeGeneratedSessionTitle("https://detail.example.com/offer/123.html", {
        text: "https://detail.example.com/offer/123.html",
      }),
    ).toBe("Review detail.example.com")
  })

  it("only auto-refreshes placeholders and obviously generated titles", () => {
    expect(shouldAutoRefreshSessionTitle("新会话", true)).toBe(true)
    expect(shouldAutoRefreshSessionTitle("New session - 2026-06-13T14:16:14.494Z", true)).toBe(true)
    expect(shouldAutoRefreshSessionTitle("https://detail.example.com/offe...", false)).toBe(true)
    expect(shouldAutoRefreshSessionTitle("查找 1688 商品图片", false)).toBe(false)
  })
})
