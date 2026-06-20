import { describe, expect, it } from "vitest"
import {
  buildFallbackSessionTitle,
  isGeneratedSessionTitleAcceptable,
  sanitizeGeneratedSessionTitle,
  shouldAutoRefreshSessionTitle,
  trimTitleToColumns,
} from "./title.ts"

describe("session title helpers", () => {
  it("normalizes whitespace for fallback titles", () => {
    expect(buildFallbackSessionTitle({ text: "  查   Hacker News\n热门故事  " })).toBe("查 Hacker News 热门故事")
  })

  it("does not use a bare URL as the fallback title", () => {
    expect(buildFallbackSessionTitle({ text: "https://detail.example.com/offer/123.html" })).toBe("detail.example.com")
  })

  it("normalizes titles without hard truncating words", () => {
    expect(trimTitleToColumns("分析一下我最近三天的 Gmail")).toBe("分析一下我最近三天的 Gmail")
    expect(trimTitleToColumns("Search 1688 product images with Metaso and Puppeteer")).toBe(
      "Search 1688 product images with Metaso and Puppeteer",
    )
  })

  it("compacts request-like fallback titles", () => {
    expect(buildFallbackSessionTitle({ text: "你帮我将这个店铺中商品相关的图片都抓下来" })).toBe("抓取店铺商品图片")
  })

  it("cleans model output before storing it", () => {
    expect(
      sanitizeGeneratedSessionTitle('{"title":"查找 1688 商品图片"}', {
        text: "https://detail.example.com/offer/123.html",
      }),
    ).toBe("查找 1688 商品图片")
  })

  it("validates generated titles by language-aware length rules", () => {
    expect(isGeneratedSessionTitleAcceptable("Gmail 三日报告")).toBe(true)
    expect(isGeneratedSessionTitleAcceptable("抓取店铺商品图片")).toBe(true)
    expect(isGeneratedSessionTitleAcceptable("1688 Product Images")).toBe(true)
    expect(isGeneratedSessionTitleAcceptable("分析一下我最近三天的 Gmail")).toBe(false)
    expect(isGeneratedSessionTitleAcceptable("Search 1688 product images with Metaso")).toBe(false)
    expect(isGeneratedSessionTitleAcceptable("分析一下我最近三天的 Gma")).toBe(false)
  })

  it("falls back when the model returns a URL", () => {
    expect(
      sanitizeGeneratedSessionTitle("https://detail.example.com/offer/123.html", {
        text: "https://detail.example.com/offer/123.html",
      }),
    ).toBe("detail.example.com")
  })

  it("only auto-refreshes placeholders and obviously generated titles", () => {
    expect(shouldAutoRefreshSessionTitle("新会话", true)).toBe(true)
    expect(shouldAutoRefreshSessionTitle("New session - 2026-06-13T14:16:14.494Z", true)).toBe(true)
    expect(shouldAutoRefreshSessionTitle("https://detail.example.com/offe...", false)).toBe(true)
    expect(shouldAutoRefreshSessionTitle("查找 1688 商品图片", false)).toBe(false)
  })
})
