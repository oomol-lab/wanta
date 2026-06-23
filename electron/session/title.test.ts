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
    expect(buildFallbackSessionTitle({ text: "帮我把这个文件保存下来" })).toBe("保存文件")
    expect(buildFallbackSessionTitle({ text: "帮我把这个文件下载下来" })).toBe("下载文件")
  })

  it("cleans model output before storing it", () => {
    expect(
      sanitizeGeneratedSessionTitle('{"title":"查找 1688 商品图片"}', {
        text: "https://detail.example.com/offer/123.html",
      }),
    ).toEqual({ title: "查找 1688 商品图片", usedFallback: false })
  })

  it("parses fenced JSON model output", () => {
    expect(
      sanitizeGeneratedSessionTitle('```json\n{"title":"Gmail 三日报告"}\n```', {
        text: "分析最近三天 Gmail 信息",
      }),
    ).toEqual({ title: "Gmail 三日报告", usedFallback: false })
  })

  it("falls back for malformed generated JSON", () => {
    expect(
      sanitizeGeneratedSessionTitle('{"title":123}', {
        text: "分析最近三天 Gmail 信息",
      }),
    ).toEqual({ title: "分析最近三天 Gmail 信息", usedFallback: true })
  })

  it("keeps model-generated titles without local length scoring", () => {
    expect(
      sanitizeGeneratedSessionTitle('{"title":"PostHog 近 3 天注册来源分析报告"}', {
        text: "你 PostHog 看一下近三天的数据，帮我看一下他们注册主要是来自于哪里？",
      }),
    ).toEqual({ title: "PostHog 近 3 天注册来源分析报告", usedFallback: false })
  })

  it("falls back when the model returns a URL", () => {
    expect(
      sanitizeGeneratedSessionTitle("https://detail.example.com/offer/123.html", {
        text: "https://detail.example.com/offer/123.html",
      }),
    ).toEqual({ title: "detail.example.com", usedFallback: true })
  })

  it("only auto-refreshes placeholders and obviously generated titles", () => {
    expect(shouldAutoRefreshSessionTitle("新会话", true)).toBe(true)
    expect(shouldAutoRefreshSessionTitle("New session - 2026-06-13T14:16:14.494Z", true)).toBe(true)
    expect(shouldAutoRefreshSessionTitle("https://detail.example.com/offe...", false)).toBe(true)
    expect(shouldAutoRefreshSessionTitle("查找 1688 商品图片", false)).toBe(false)
  })
})
