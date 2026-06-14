import assert from "node:assert/strict"
import { describe, test } from "vitest"
import { formatSessionAbsoluteTime, formatSessionRelativeTime } from "./session-time.ts"

describe("formatSessionRelativeTime", () => {
  const now = 1_700_000_000_000

  test("formats recent sessions", () => {
    assert.equal(formatSessionRelativeTime(now - 20_000, now, "zh-CN"), "刚刚")
    assert.equal(formatSessionRelativeTime(now - 20_000, now, "en"), "now")
  })

  test("formats compact zh-CN relative units", () => {
    assert.equal(formatSessionRelativeTime(now - 5 * 60_000, now, "zh-CN"), "5分钟前")
    assert.equal(formatSessionRelativeTime(now - 19 * 60 * 60_000, now, "zh-CN"), "19小时前")
    assert.equal(formatSessionRelativeTime(now - 9 * 24 * 60 * 60_000, now, "zh-CN"), "9天前")
    assert.equal(formatSessionRelativeTime(now - 32 * 24 * 60 * 60_000, now, "zh-CN"), "1个月前")
    assert.equal(formatSessionRelativeTime(now - 400 * 24 * 60 * 60_000, now, "zh-CN"), "1年前")
  })

  test("formats compact English relative units", () => {
    assert.equal(formatSessionRelativeTime(now - 5 * 60_000, now, "en"), "5m ago")
    assert.equal(formatSessionRelativeTime(now - 19 * 60 * 60_000, now, "en"), "19h ago")
    assert.equal(formatSessionRelativeTime(now - 9 * 24 * 60 * 60_000, now, "en"), "9d ago")
    assert.equal(formatSessionRelativeTime(now - 32 * 24 * 60 * 60_000, now, "en"), "1mo ago")
    assert.equal(formatSessionRelativeTime(now - 400 * 24 * 60 * 60_000, now, "en"), "1y ago")
  })

  test("guards invalid and future values", () => {
    assert.equal(formatSessionRelativeTime(0, now, "zh-CN"), "")
    assert.equal(formatSessionRelativeTime(Number.NaN, now, "zh-CN"), "")
    assert.equal(formatSessionRelativeTime(now + 60_000, now, "zh-CN"), "刚刚")
  })
})

describe("formatSessionAbsoluteTime", () => {
  test("returns an empty label for invalid values", () => {
    assert.equal(formatSessionAbsoluteTime(0, "zh-CN"), "")
    assert.equal(formatSessionAbsoluteTime(Number.NaN, "en"), "")
  })

  test("uses the application locale", () => {
    const updatedAt = Date.UTC(2026, 0, 2, 3, 4, 5)
    assert.equal(formatSessionAbsoluteTime(updatedAt, "en"), new Date(updatedAt).toLocaleString("en"))
    assert.equal(formatSessionAbsoluteTime(updatedAt, "zh-CN"), new Date(updatedAt).toLocaleString("zh-CN"))
  })
})
